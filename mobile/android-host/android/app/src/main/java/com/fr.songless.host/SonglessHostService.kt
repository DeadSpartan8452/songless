package fr.songless.host

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Arguments
import com.janeasystems.rn_nodejs_mobile.RNNodeJsMobileModule

class SonglessHostService : Service() {
  companion object {
    private const val CHANNEL_ID = "songless_host"
    private const val NOTIFICATION_ID = 4101
  }

  override fun onCreate() {
    super.onCreate()
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          getString(R.string.host_notification_channel),
          NotificationManager.IMPORTANCE_LOW,
        ),
      )
    }

    val openSongless = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      openSongless,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(getString(R.string.host_notification_title))
      .setContentText(getString(R.string.host_notification_text))
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .build()
    startForeground(NOTIFICATION_ID, notification)
    startSonglessEngine()
  }

  private fun startSonglessEngine() {
    val songlessApplication = application as? MainApplication ?: return
    songlessApplication.withReactContext { context ->
      try {
        val module = context.getNativeModule(RNNodeJsMobileModule::class.java)
        if (module == null) {
          Log.e("SonglessHost", "Node Mobile module unavailable")
          return@withReactContext
        }
        val options = Arguments.createMap().apply {
          putBoolean("redirectOutputToLogcat", true)
        }
        module.startNodeProject("main.js", options)
      } catch (error: Exception) {
        Log.e("SonglessHost", "Unable to start Songless engine", error)
      }
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

  override fun onBind(intent: Intent?): IBinder? = null
}
