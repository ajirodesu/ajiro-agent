package expo.modules.terminalpty

import android.content.Context
import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

private const val TAG = "TerminalPty"

/**
 * Canonical native PTY module (`TerminalPty`, Android-only).
 *
 * - Interactive sessions: JNI forkpty → PRoot → Debian bash. Output pumps
 *   emit `onTerminalData`; process exit emits `onTerminalExit`.
 * - Headless execution: short-lived PTY-less `proot /bin/bash -lc` capture
 *   returning { stdout, stderr, exitCode } for the agent.
 * - Holds [TerminalPtyService] (foreground + wake lock) while ≥1 session is
 *   alive; releases it when the last session ends.
 */
class TerminalPtyModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val headlessPool = Executors.newCachedThreadPool()
  private val liveSessions = ConcurrentHashMap.newKeySet<String>()

  override fun definition() = ModuleDefinition {
    Name("TerminalPty")

    OnCreate {
      try {
        System.loadLibrary("pty_bridge")
      } catch (e: UnsatisfiedLinkError) {
        Log.e(TAG, "libpty_bridge.so missing — did CMake build run?", e)
      }
      // A fresh module instance owns no sessions yet: anything still
      // registered belongs to a dead JS runtime (full reload) and would
      // otherwise leak a PTY + process pair nobody can reach.
      try {
        nativeKillAll()
      } catch (e: Exception) {
        Log.w(TAG, "stale session reap failed", e)
      }
    }

    AsyncFunction("spawnSession") { id: String, initialCmd: String, cols: Int, rows: Int ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      require(id.isNotBlank()) { "session id must not be blank" }
      val safeCols = cols.coerceIn(20, 400)
      val safeRows = rows.coerceIn(5, 200)
      val proot = ensureProotExecutable(context)
      val rootfs = File(context.filesDir, "rootfs")
      require(rootfs.isDirectory) { "rootfs missing at ${rootfs.absolutePath}" }
      val code = nativeSpawn(id, proot.absolutePath, rootfs.absolutePath, initialCmd, safeCols, safeRows)
      if (code != 0) {
        throw IllegalStateException("nativeSpawn failed for session $id (code=$code)")
      }
      liveSessions.add(id)
      TerminalPtyService.acquire(context)
    }

    AsyncFunction("write") { id: String, data: String ->
      if (!liveSessions.contains(id)) return@AsyncFunction Unit
      nativeWrite(id, data)
      Unit
    }

    AsyncFunction("resize") { id: String, cols: Int, rows: Int ->
      if (!liveSessions.contains(id)) return@AsyncFunction Unit
      nativeResize(id, cols.coerceIn(20, 400), rows.coerceIn(5, 200))
      Unit
    }

    AsyncFunction("killSession") { id: String ->
      nativeKill(id)
      onSessionEnded(id)
      Unit
    }

    AsyncFunction("executeHeadless") { cmd: String, timeoutMs: Double? ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      require(cmd.isNotBlank()) { "command must not be blank" }
      val timeout = (timeoutMs?.toLong() ?: 60_000L).coerceIn(1_000L, 300_000L)
      // AsyncFunction bodies already run on a background thread; the pool
      // only bounds concurrency, and get() bounds total wall time.
      val future = headlessPool.submit<Map<String, Any>> {
        runHeadless(context, cmd, timeout)
      }
      try {
        future.get(timeout + 5_000L, java.util.concurrent.TimeUnit.MILLISECONDS)
      } catch (e: Exception) {
        future.cancel(true)
        throw IllegalStateException("Headless execution failed: ${e.message}", e)
      }
    }

    AsyncFunction("sessionCount") {
      liveSessions.size
    }

    AsyncFunction("extractRootfs") { archivePath: String, destPath: String, stripComponents: Int? ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val archive = File(archivePath)
      val dest = File(destPath)
      require(archive.isFile) { "rootfs archive missing: $archivePath" }
      val strip = (stripComponents ?: 0).coerceIn(0, 8)
      // Hold the foreground service + wake lock across the (multi-minute)
      // extraction so backgrounding cannot interrupt it halfway.
      // (AsyncFunction bodies run on a background thread; no withContext.)
      TerminalPtyService.acquire(context)
      try {
        val result = RootfsExtractor.extract(archive, dest, strip) { read, total ->
          scope.launch(Dispatchers.Main) {
            sendEvent(
              "onRootfsProgress",
              mapOf("bytesTransferred" to read, "totalBytes" to total),
            )
          }
        }
        mapOf(
          "extractedFiles" to result.extractedFiles,
          "extractedDirs" to result.extractedDirs,
          "extractedLinks" to result.extractedLinks,
          "skippedEntries" to result.skippedEntries,
        )
      } finally {
        TerminalPtyService.release(context)
      }
    }

    OnDestroy {
      for (id in liveSessions.toList()) {
        try { nativeKill(id) } catch (_: Exception) {}
      }
      liveSessions.clear()
      headlessPool.shutdownNow()
    }
  }

  // Called from JNI (reader thread) via DeviceEventEmitter-safe bridge.
  @Suppress("unused")
  fun onSessionData(id: String, chunk: ByteArray) {
    if (chunk.isEmpty()) return
    val text = chunk.toString(Charsets.UTF_8)
    scope.launch(Dispatchers.Main) {
      sendEvent("onTerminalData", mapOf("sessionId" to id, "data" to text))
    }
  }

  @Suppress("unused")
  fun onSessionExit(id: String, exitCode: Int) {
    onSessionEnded(id)
    scope.launch(Dispatchers.Main) {
      sendEvent("onTerminalExit", mapOf("sessionId" to id, "exitCode" to exitCode))
    }
  }

  private fun onSessionEnded(id: String) {
    liveSessions.remove(id)
    val context = appContext.reactContext ?: return
    if (liveSessions.isEmpty()) {
      TerminalPtyService.release(context)
    }
  }

  private fun runHeadless(context: Context, cmd: String, timeoutMs: Long): Map<String, Any> {
    val proot = ensureProotExecutable(context)
    val rootfs = File(context.filesDir, "rootfs")
    require(rootfs.isDirectory) { "rootfs missing at ${rootfs.absolutePath}" }
    return nativeExecuteHeadless(proot.absolutePath, rootfs.absolutePath, cmd, timeoutMs)
  }

  /**
   * Resolve an executable `proot` copy in app-private storage.
   * Candidates: filesDir/bin/proot (installed copy), then
   * nativeLibraryDir/libproot.so shipped via jniLibs (copied + chmod 700).
   */
  private fun ensureProotExecutable(context: Context): File {
    val binDir = File(context.filesDir, "bin").apply { mkdirs() }
    val installed = File(binDir, "proot")
    if (installed.canExecute()) return installed
    val libSuffixed = File(context.applicationInfo.nativeLibraryDir, "libproot.so")
    if (libSuffixed.exists()) {
      libSuffixed.copyTo(installed, overwrite = true)
      installed.setExecutable(true, true)
      if (installed.canExecute()) return installed
    }
    throw IllegalStateException(
      "proot binary missing. Ship an arm64-v8a static proot via " +
        "modules/terminal-pty/android/src/main/jniLibs/arm64-v8a/ " +
        "(see README there) and reinstall."
    )
  }

  // ---- JNI ----
  private external fun nativeSpawn(
    id: String,
    prootPath: String,
    rootfsPath: String,
    initialCmd: String,
    cols: Int,
    rows: Int,
  ): Int

  private external fun nativeWrite(id: String, data: String)
  private external fun nativeResize(id: String, cols: Int, rows: Int)
  private external fun nativeKill(id: String)
  private external fun nativeKillAll()
  private external fun nativeExecuteHeadless(
    prootPath: String,
    rootfsPath: String,
    cmd: String,
    timeoutMs: Long,
  ): Map<String, Any>
}
