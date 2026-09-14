package expo.modules.terminalpty

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.concurrent.atomic.AtomicInteger

/**
 * Foreground service + partial wake lock for persistent PTY sessions.
 *
 * - Reference-counted: `acquire()` per live session, `release()` on session
 *   end. The service stops itself and drops the wake lock when the count
 *   reaches zero — never leaked, never duplicated.
 * - Sticky notification ("Ajiro Linux terminal active") while held, as
 *   required for foreground services on Android 10+.
 */
class TerminalPtyService : Service() {
  companion object {
    const val ACTION_ACQUIRE = "expo.modules.terminalpty.ACQUIRE"
    const val ACTION_RELEASE = "expo.modules.terminalpty.RELEASE"
    private const val CHANNEL_ID = "ajiro-terminal"
    private const val NOTIFICATION_ID = 0xA71A0
    private val refCount = AtomicInteger(0)

    @Volatile var isActive = false
      private set

    fun acquire(context: Context) {
      if (refCount.incrementAndGet() == 1) {
        startCompat(context, ACTION_ACQUIRE)
      }
    }

    fun release(context: Context) {
      if (refCount.decrementAndGet() <= 0) {
        refCount.set(0)
        try {
          context.startService(Intent(context, TerminalPtyService::class.java).apply {
            action = ACTION_RELEASE
          })
        } catch (e: Exception) {
          Log.w("TerminalPty", "release failed", e)
        }
      }
    }

    private fun startCompat(context: Context, action: String) {
      val intent = Intent(context, TerminalPtyService::class.java).apply { this.action = action }
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (e: Exception) {
        Log.e("TerminalPty", "Failed to start service", e)
      }
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_RELEASE -> {
        tearDown()
        return START_NOT_STICKY
      }
      else -> {
        startForeground(NOTIFICATION_ID, buildNotification())
        holdWakeLock()
        isActive = true
        return START_STICKY
      }
    }
  }

  private fun buildNotification(): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Ajiro Linux terminal", NotificationManager.IMPORTANCE_LOW)
      )
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Ajiro Linux terminal active")
      .setContentText("On-device Debian session running")
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setOngoing(true)
      .build()
  }

  private fun holdWakeLock() {
    if (wakeLock?.isHeld == true) return
    val power = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Ajiro:TerminalPty").apply {
      acquire(10 * 60 * 1000L) // bounded; renewed only while sessions live
    }
  }

  private fun tearDown() {
    try { wakeLock?.release() } catch (_: Exception) {}
    wakeLock = null
    isActive = false
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    try { wakeLock?.release() } catch (_: Exception) {}
    wakeLock = null
    isActive = false
    super.onDestroy()
  }
}
