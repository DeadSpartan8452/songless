package fr.songless.host

import android.app.Activity
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.DocumentsContract
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

class SonglessFolderModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val REQUEST_FOLDER = 4817
    private const val MAX_FILES = 5000
    private const val MAX_BYTES = 32L * 1024L * 1024L * 1024L
    private val AUDIO_EXTENSIONS = setOf("mp3", "wav", "ogg", "m4a", "mp4", "aac", "flac", "opus")
  }

  private val worker = Executors.newSingleThreadExecutor()
  private var pendingPromise: Promise? = null

  private val activityListener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQUEST_FOLDER) return
      val promise = pendingPromise ?: return
      pendingPromise = null
      val tree = data?.data
      if (resultCode != Activity.RESULT_OK || tree == null) {
        promise.resolve(Arguments.createMap().apply { putBoolean("cancelled", true) })
        return
      }

      try {
        reactContext.contentResolver.takePersistableUriPermission(
          tree,
          data.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        )
      } catch (_: SecurityException) {
        // La permission de la sélection courante suffit encore pour cette copie.
      }

      worker.execute {
        try {
          promise.resolve(copyTree(tree))
        } catch (error: Exception) {
          promise.reject("SONGLESS_FOLDER_IMPORT", error.message ?: "Lecture du dossier impossible.", error)
        }
      }
    }
  }

  init {
    reactContext.addActivityEventListener(activityListener)
  }

  override fun getName(): String = "SonglessFolderPicker"

  @ReactMethod
  fun pickFolder(promise: Promise) {
    if (pendingPromise != null) {
      promise.reject("SONGLESS_FOLDER_BUSY", "Un choix de dossier est déjà ouvert.")
      return
    }
    val activity = currentActivity
    if (activity == null) {
      promise.reject("SONGLESS_NO_ACTIVITY", "L’écran Android n’est pas disponible.")
      return
    }
    pendingPromise = promise
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
    }
    activity.startActivityForResult(intent, REQUEST_FOLDER)
  }

  private fun copyTree(tree: Uri) = Arguments.createMap().apply {
    val batchId = UUID.randomUUID().toString()
    val batch = File(reactContext.filesDir, "Songless-Data/inbox/$batchId")
    if (!batch.mkdirs()) throw IllegalStateException("Le dossier temporaire Android n’a pas pu être créé.")
    val state = CopyState()
    try {
      val rootId = DocumentsContract.getTreeDocumentId(tree)
      copyChildren(tree, rootId, batch, state)
      if (state.files == 0) throw IllegalArgumentException("Ce dossier ne contient aucun fichier audio compatible.")
      putBoolean("cancelled", false)
      putString("batchId", batchId)
      putInt("files", state.files)
      putDouble("bytes", state.bytes.toDouble())
    } catch (error: Exception) {
      batch.deleteRecursively()
      throw error
    }
  }

  private data class CopyState(var files: Int = 0, var bytes: Long = 0)

  private fun copyChildren(tree: Uri, parentId: String, batch: File, state: CopyState) {
    val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
    val columns = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
    )
    reactContext.contentResolver.query(children, columns, null, null, null)?.use { cursor ->
      while (cursor.moveToNext()) copyEntry(tree, cursor, batch, state)
    }
  }

  private fun copyEntry(tree: Uri, cursor: Cursor, batch: File, state: CopyState) {
    val documentId = cursor.getString(0)
    val displayName = cursor.getString(1) ?: "sans-titre"
    val mime = cursor.getString(2)
    if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
      copyChildren(tree, documentId, batch, state)
      return
    }
    val extension = displayName.substringAfterLast('.', "").lowercase()
    if (extension !in AUDIO_EXTENSIONS) return
    if (state.files >= MAX_FILES) throw IllegalArgumentException("Ce dossier dépasse la limite de $MAX_FILES musiques.")

    val source = DocumentsContract.buildDocumentUriUsingTree(tree, documentId)
    val destination = uniqueDestination(batch, safeName(displayName))
    val partial = File(batch, "${destination.name}.partial")
    var written = 0L
    reactContext.contentResolver.openInputStream(source)?.use { input ->
      partial.outputStream().use { output ->
        val buffer = ByteArray(128 * 1024)
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          written += count
          if (state.bytes + written > MAX_BYTES) {
            throw IllegalArgumentException("Ce dossier dépasse la limite totale de 32 Go.")
          }
          output.write(buffer, 0, count)
        }
      }
    } ?: throw IllegalStateException("Android refuse la lecture de $displayName.")
    if (!partial.renameTo(destination)) {
      partial.delete()
      throw IllegalStateException("La copie de $displayName n’a pas pu être finalisée.")
    }
    state.files += 1
    state.bytes += written
  }

  private fun safeName(value: String): String {
    val cleaned = value.replace(Regex("[\\u0000-\\u001f<>:\"/\\\\|?*]"), " ")
      .replace(Regex("\\s+"), " ")
      .trim(' ', '.')
    return cleaned.take(150).ifBlank { "sans-titre.mp3" }
  }

  private fun uniqueDestination(directory: File, requested: String): File {
    val dot = requested.lastIndexOf('.')
    val base = if (dot > 0) requested.substring(0, dot) else requested
    val extension = if (dot > 0) requested.substring(dot) else ""
    var candidate = File(directory, requested)
    var suffix = 2
    while (candidate.exists() || File(directory, "${candidate.name}.partial").exists()) {
      candidate = File(directory, "$base ($suffix)$extension")
      suffix += 1
    }
    return candidate
  }
}
