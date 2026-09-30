package fr.songless.host

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

class SonglessUpdaterModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val REPOSITORY_PATH = "/DeadSpartan8452/songless/releases/download/"
    private const val MAX_APK_BYTES = 1024L * 1024L * 1024L
  }

  private val worker = Executors.newSingleThreadExecutor()

  override fun getName(): String = "SonglessUpdater"

  @ReactMethod
  fun getVersion(promise: Promise) {
    promise.resolve(BuildConfig.VERSION_NAME)
  }

  @ReactMethod
  fun installUpdate(urlValue: String, expectedSha256: String, version: String, promise: Promise) {
    worker.execute {
      var partial: File? = null
      try {
        val source = URL(urlValue)
        if (source.protocol != "https" || source.host != "github.com" ||
          !source.path.startsWith(REPOSITORY_PATH) ||
          !source.path.endsWith("/Songless-Android.apk")) {
          throw IllegalArgumentException("Le lien APK ne vient pas des Releases Songless officielles.")
        }
        if (!expectedSha256.matches(Regex("(?i)[a-f0-9]{64}"))) {
          throw IllegalArgumentException("L’empreinte SHA-256 de l’APK est invalide.")
        }
        if (!version.matches(Regex("v?[0-9]+\\.[0-9]+\\.[0-9]+"))) {
          throw IllegalArgumentException("Le numéro de version Android est invalide.")
        }

        val updateDirectory = File(reactContext.cacheDir, "songless-updates")
        if (!updateDirectory.exists() && !updateDirectory.mkdirs()) {
          throw IllegalStateException("Le dossier temporaire de mise à jour est indisponible.")
        }
        partial = File(updateDirectory, "Songless-Android.apk.partial")
        val destination = File(updateDirectory, "Songless-Android.apk")
        val connection = source.openConnection() as HttpsURLConnection
        connection.connectTimeout = 20000
        connection.readTimeout = 60000
        connection.instanceFollowRedirects = true
        connection.setRequestProperty("User-Agent", "Songless-Android-Updater")
        try {
          connection.connect()
          val finalHost = connection.url.host.lowercase()
          if (finalHost !in setOf(
              "github.com",
              "release-assets.githubusercontent.com",
              "objects.githubusercontent.com",
            )) {
            throw IllegalStateException("GitHub a redirigé le téléchargement vers un domaine refusé.")
          }
          if (connection.responseCode != HttpsURLConnection.HTTP_OK) {
            throw IllegalStateException("GitHub a répondu HTTP ${connection.responseCode}.")
          }
          if (connection.contentLengthLong > MAX_APK_BYTES) {
            throw IllegalStateException("L’APK dépasse la taille maximale autorisée.")
          }
          val available = reactContext.cacheDir.usableSpace
          if (connection.contentLengthLong > 0 &&
            available < connection.contentLengthLong + 16L * 1024L * 1024L) {
            throw IllegalStateException("Libère de l’espace sur le téléphone avant la mise à jour.")
          }
          val digest = MessageDigest.getInstance("SHA-256")
          var total = 0L
          connection.inputStream.use { input ->
            partial.outputStream().buffered().use { output ->
              val buffer = ByteArray(128 * 1024)
              while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                if (total > MAX_APK_BYTES) {
                  throw IllegalStateException("L’APK dépasse la taille maximale autorisée.")
                }
                digest.update(buffer, 0, count)
                output.write(buffer, 0, count)
              }
            }
          }
          val actual = digest.digest().joinToString("") { "%02x".format(it) }
          if (!actual.equals(expectedSha256, ignoreCase = true)) {
            throw IllegalStateException("L’empreinte de l’APK téléchargé ne correspond pas.")
          }
          if (destination.exists() && !destination.delete()) {
            throw IllegalStateException("L’ancien téléchargement temporaire ne peut pas être remplacé.")
          }
          if (!partial.renameTo(destination)) {
            throw IllegalStateException("L’APK téléchargé ne peut pas être préparé pour Android.")
          }

          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !reactContext.packageManager.canRequestPackageInstalls()) {
            val settings = Intent(
              Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
              Uri.parse("package:${reactContext.packageName}"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(settings)
            promise.reject(
              "SONGLESS_INSTALL_PERMISSION",
              "Autorise l’installation de Songless depuis cette application, puis relance la mise à jour.",
            )
            return@execute
          }

          val uri = FileProvider.getUriForFile(
            reactContext,
            "${reactContext.packageName}.fileprovider",
            destination,
          )
          val install = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          reactContext.startActivity(install)
          promise.resolve("Android affiche la confirmation pour installer $version.")
        } finally {
          connection.disconnect()
        }
      } catch (error: Exception) {
        partial?.delete()
        promise.reject("SONGLESS_UPDATE_FAILED", error.message, error)
      }
    }
  }
}
