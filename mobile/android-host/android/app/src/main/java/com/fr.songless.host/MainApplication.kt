package fr.songless.host

import android.app.Application
import android.os.Build
import android.system.Os
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import java.io.File
import java.io.InputStream

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              add(SonglessFolderPackage())
            }

        override fun getJSMainModuleName(): String = "index"

        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    prepareClamAvRuntime()
    SoLoader.init(this, OpenSourceMergedSoMapping)
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // If you opted-in for the New Architecture, we load the native entry point for this app.
      load()
    }
  }

  private fun prepareClamAvRuntime() {
    val nativeDir = File(applicationInfo.nativeLibraryDir)
    val executable = File(nativeDir, "libclamscan_exec.so")
    if (!executable.isFile) return

    val root = File(filesDir, "Songless-Data/clamav")
    val database = File(root, "db")
    val certificates = File(root, "certs")
    database.mkdirs()
    certificates.mkdirs()
    val certificate = File(certificates, "clamav.crt")
    assets.open("clamav/certs/clamav.crt").use { input ->
      certificate.outputStream().use { output -> input.copyTo(output) }
    }
    copyBundledDatabase("main.cvd", database)
    copyBundledDatabase("daily.cvd", database)

    Os.setenv("SONGLESS_CLAMSCAN", executable.absolutePath, true)
    Os.setenv("SONGLESS_NATIVE_LIB_DIR", nativeDir.absolutePath, true)
    Os.setenv("SONGLESS_CLAMAV_DB", database.absolutePath, true)
    Os.setenv("SONGLESS_CLAMAV_CERTS", certificates.absolutePath, true)
    Os.setenv("SONGLESS_ANDROID_ABI", Build.SUPPORTED_ABIS.firstOrNull() ?: "arm64-v8a", true)
  }

  private fun cvdVersion(input: InputStream): Int {
    val header = ByteArray(512)
    val count = input.read(header)
    if (count <= 0) return -1
    val fields = String(header, 0, count, Charsets.US_ASCII).split(':')
    return fields.getOrNull(2)?.trim()?.toIntOrNull() ?: -1
  }

  private fun cvdVersion(file: File): Int {
    if (!file.isFile) return -1
    return file.inputStream().use { cvdVersion(it) }
  }

  private fun copyBundledDatabase(name: String, database: File) {
    val assetPath = "clamav/db/$name"
    val bundledVersion = assets.open(assetPath).use { cvdVersion(it) }
    val destination = File(database, name)
    if (bundledVersion <= cvdVersion(destination)) return
    val partial = File(database, "$name.partial")
    assets.open(assetPath).use { input ->
      partial.outputStream().use { output -> input.copyTo(output) }
    }
    if (destination.exists()) destination.delete()
    if (!partial.renameTo(destination)) {
      partial.delete()
      throw IllegalStateException("Base antivirus impossible à installer : $name")
    }
  }
}
