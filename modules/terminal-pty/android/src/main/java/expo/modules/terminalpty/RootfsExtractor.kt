package expo.modules.terminalpty

import android.system.Os
import android.util.Log
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.FilterInputStream
import java.io.InputStream
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import org.tukaani.xz.XZInputStream

private const val TAG = "TerminalPty"

/**
 * Offline rootfs extractor: `.tar.xz` (primary), `.tar.gz`/`.tgz`, or plain
 * `.tar` → app-private destination directory.
 *
 * Pure-Java/Kotlin (commons-compress + Tukaani XZ, no extra NDK code), so it
 * works on stock Android 10+ without root:
 * - path-traversal guard (canonical-path containment),
 * - symlinks/hardlinks recreated via Os.symlink/Os.link (critical: Debian
 *   rootfs trees are full of them),
 * - executable bits preserved from tar modes,
 * - non-materializable entries (char/block devices, fifos, sockets) skipped
 *   and counted honestly instead of aborting the whole extraction,
 * - byte progress over the compressed stream (monotonic; nonlinear across
 *   the xz block boundary, which is inherent to the format).
 */
object RootfsExtractor {
  data class Result(
    val extractedFiles: Int,
    val extractedDirs: Int,
    val extractedLinks: Int,
    val skippedEntries: Int,
  )

  private const val XZ_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024
  private const val COPY_BUFFER_BYTES = 64 * 1024

  private class CountingInputStream(wrapped: InputStream) : FilterInputStream(wrapped) {
    var count: Long = 0L
      private set

    override fun read(): Int {
      val byte = super.read()
      if (byte >= 0) count++
      return byte
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
      val read = super.read(buffer, offset, length)
      if (read > 0) count += read
      return read
    }
  }

  fun extract(
    archive: File,
    dest: File,
    stripComponents: Int = 0,
    onProgress: (bytesRead: Long, totalBytes: Long) -> Unit,
  ): Result {
    require(archive.isFile) { "archive missing: ${archive.absolutePath}" }
    dest.mkdirs()
    require(dest.isDirectory) { "cannot create destination: ${dest.absolutePath}" }
    val destCanonical = dest.canonicalPath
    val totalBytes = archive.length()

    val counted = CountingInputStream(BufferedInputStream(FileInputStream(archive), 128 * 1024))
    val decompressed: InputStream = when {
      archive.name.endsWith(".tar.xz", ignoreCase = true) ||
        archive.name.endsWith(".txz", ignoreCase = true) ->
        XZInputStream(counted, XZ_MEMORY_LIMIT_BYTES)
      archive.name.endsWith(".tar.gz", ignoreCase = true) ||
        archive.name.endsWith(".tgz", ignoreCase = true) ->
        GzipCompressorInputStream(counted)
      else -> counted
    }

    var files = 0
    var dirs = 0
    var links = 0
    var skipped = 0
    var lastEmitMs = 0L

    fun emit(force: Boolean = false) {
      val now = android.os.SystemClock.elapsedRealtime()
      if (force || now - lastEmitMs >= 250) {
        lastEmitMs = now
        onProgress(counted.count, totalBytes)
      }
    }

    TarArchiveInputStream(decompressed).use { tar ->
      var entry: TarArchiveEntry? = tar.nextEntry
      while (entry != null) {
        val current = entry
        try {
          // Strip leading components (proot-distro tarballs nest the
          // filesystem one directory deep); entries that vanish are skipped.
          val strippedName = stripLeading(current.name, stripComponents)
          if (strippedName == null) {
            skipped++
          } else {
            val out = File(dest, strippedName)
            extractOne(tar, current, out, destCanonical)?.let { outcome ->
              when (outcome) {
                Outcome.FILE -> files++
                Outcome.DIR -> dirs++
                Outcome.LINK -> links++
                Outcome.SKIPPED -> skipped++
              }
            } ?: run { skipped++ }
          }
        } catch (e: Exception) {
          Log.w(TAG, "Skipping unreadable entry ${current.name}: ${e.message}")
          skipped++
        }
        emit()
        entry = tar.nextEntry
      }
    }
    emit(force = true)
    return Result(files, dirs, links, skipped)
  }

  private enum class Outcome { FILE, DIR, LINK, SKIPPED }

  /** Returns the stripped relative name, or null when nothing remains. */
  private fun stripLeading(name: String, strip: Int): String? {
    if (strip <= 0) return name.trimStart('/')
    val segments = name.trimStart('/').split('/').filter { it.isNotEmpty() }
    if (segments.size <= strip) return null
    return segments.drop(strip).joinToString("/")
  }

  private fun extractOne(
    tar: TarArchiveInputStream,
    entry: TarArchiveEntry,
    out: File,
    destCanonical: String,
  ): Outcome? {
    if (!out.canonicalPath.startsWith(destCanonical + File.separator)) {
      Log.w(TAG, "Skipping path-traversal entry: ${entry.name}")
      return Outcome.SKIPPED
    }
    return when {
      entry.isDirectory -> {
        out.mkdirs()
        Outcome.DIR
      }
      entry.isSymbolicLink -> {
        out.parentFile?.mkdirs()
        if (out.exists() || isDanglingLink(out)) out.delete()
        Os.symlink(entry.linkName, out.absolutePath)
        Outcome.LINK
      }
      entry.isLink -> {
        // Hard link: target is archive-relative like a symlink target.
        out.parentFile?.mkdirs()
        if (out.exists()) out.delete()
        val target = File(destCanonical, entry.linkName)
        Os.link(target.absolutePath, out.absolutePath)
        Outcome.LINK
      }
      entry.isFile -> {
        out.parentFile?.mkdirs()
        copyStream(tar, out, entry.size)
        applyMode(out, entry.mode)
        Outcome.FILE
      }
      else -> {
        // Character/block devices, fifos, sockets: cannot materialize in
        // app-private storage; PRoot provides /dev itself.
        Outcome.SKIPPED
      }
    }
  }

  private fun copyStream(tar: TarArchiveInputStream, out: File, size: Long) {
    val copyBuffer = ByteArray(COPY_BUFFER_BYTES)
    FileOutputStream(out).use { fos ->
      var remaining = size
      while (remaining > 0) {
        val want = minOf(copyBuffer.size.toLong(), remaining).toInt()
        val read = tar.read(copyBuffer, 0, want)
        if (read < 0) break
        fos.write(copyBuffer, 0, read)
        remaining -= read
      }
    }
  }

  private fun isDanglingLink(file: File): Boolean {
    return try {
      // A symlink to a missing target reports exists()==false but is still
      // an entry that Os.symlink/delete must handle explicitly.
      file.canonicalPath != file.absolutePath && !file.exists()
    } catch (_: Exception) {
      false
    }
  }

  private fun applyMode(file: File, mode: Int) {
    val executable = (mode and 0b001001001) != 0
    try {
      file.setReadable(true, false)
      file.setWritable(true, true)
      file.setExecutable(executable, false)
    } catch (e: Exception) {
      Log.w(TAG, "chmod fallback failed for ${file.absolutePath}: ${e.message}")
    }
  }
}
