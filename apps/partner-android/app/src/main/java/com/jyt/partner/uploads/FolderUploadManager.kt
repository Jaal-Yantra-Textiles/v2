package com.jyt.partner.uploads

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import com.jyt.partner.JytPartnerApp
import com.jyt.partner.api.PartnerApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicLong

/**
 * The shared-folder upload queue — files picked (or shot) anywhere land
 * here and upload one at a time, in the background. The queue lives at
 * app scope, so leaving the folder — or the whole screen — never cancels
 * an in-flight upload: the same property the partner-ui has, where the
 * drop-zone keeps uploading while you browse elsewhere.
 *
 * Each file goes through the multipart presigned media API
 * (/partners/medias/uploads/initiate, /parts, /complete) exactly like the
 * web: initiate → presigned part URLs → PUT to S3 → complete → register
 * on the folder. Files run sequentially; parts within a file upload in
 * parallel.
 */
object FolderUploadManager {

    enum class State { PENDING, UPLOADING, DONE, FAILED }

    data class Upload(
        val id: Long,
        val folderId: String,
        val folderName: String,
        val fileName: String,
        val mimeType: String,
        val size: Long,
        val progress: Int = 0,
        val state: State = State.PENDING,
        val error: String? = null,
    )

    /** A queue item: the upload as shown to the UI + the stream factory
     *  the multipart flow reopens for every part. */
    private class Entry(
        val upload: Upload,
        val open: () -> java.io.InputStream,
    )

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Any()
    private val nextId = AtomicLong(1)
    private val queue = ArrayDeque<Entry>()
    private val failedEntries = mutableMapOf<Long, Entry>()

    @Volatile
    private var working = false

    private val _uploads = MutableStateFlow<List<Upload>>(emptyList())
    val uploads: StateFlow<List<Upload>> = _uploads.asStateFlow()

    /** Queue one picked or shot file. Safe to call from the UI thread. */
    fun enqueue(context: Context, folderId: String, folderName: String, uri: Uri) {
        // The app context's resolver, not the activity's — entries outlive
        // the screen that created them.
        val resolver = context.applicationContext.contentResolver
        // Photo-picker grants die with the activity; take the persistable
        // read so the background worker can still open the file later.
        runCatching {
            resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val mime = resolver.getType(uri) ?: "image/jpeg"
        val name = runCatching {
            resolver.query(uri, null, null, null, null)?.use { c ->
                c.moveToFirst()
                c.getString(c.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME))
            }
        }.getOrNull() ?: "upload.jpg"
        val size = runCatching {
            resolver.openAssetFileDescriptor(uri, "r")?.use { it.length }
        }.getOrNull() ?: runCatching {
            resolver.query(uri, null, null, null, null)?.use { c ->
                c.moveToFirst()
                c.getLong(c.getColumnIndexOrThrow(OpenableColumns.SIZE))
            }
        }.getOrNull() ?: 0L

        val upload = Upload(
            id = nextId.getAndIncrement(),
            folderId = folderId,
            folderName = folderName,
            fileName = name,
            mimeType = mime,
            size = size,
        )
        val entry = Entry(upload) {
            resolver.openInputStream(uri)
                ?: throw IllegalStateException("Couldn't read $name")
        }
        synchronized(lock) {
            _uploads.value = _uploads.value + upload
            queue.addLast(entry)
        }
        pump()
    }

    /** Give a failed upload another go. */
    fun retry(id: Long) {
        synchronized(lock) {
            val entry = failedEntries.remove(id) ?: return
            _uploads.value = _uploads.value.map {
                if (it.id == id) it.copy(state = State.PENDING, progress = 0, error = null) else it
            }
            queue.addLast(entry)
        }
        pump()
    }

    /** Drop an entry from the list (a finished one, or a failed one). */
    fun remove(id: Long) {
        synchronized(lock) {
            failedEntries.remove(id)
            _uploads.value = _uploads.value.filterNot { it.id == id }
        }
    }

    /** Clear finished/failed entries for one folder — the screen's "got it". */
    fun clear(folderId: String, vararg states: State) {
        synchronized(lock) {
            failedEntries.entries.removeAll { it.value.upload.folderId == folderId && it.value.upload.state in states }
            _uploads.value = _uploads.value
                .filterNot { it.folderId == folderId && it.state in states }
        }
    }

    /** Kick the worker if it isn't already running. Recursive wake at the
     *  end of each file keeps the queue draining without a busy loop. */
    private fun pump() {
        if (working) return
        val entry = synchronized(lock) { queue.removeFirstOrNull() } ?: return
        working = true
        scope.launch {
            try {
                val appContext = JytPartnerApp.instance
                    ?: throw IllegalStateException("Application context unavailable")
                mutate(entry.upload.id) { it.copy(state = State.UPLOADING, progress = 0) }
                PartnerApi.get(appContext).uploadToSharedFolder(
                    entry.upload.folderId,
                    PartnerApi.FolderUploadInput(
                        name = entry.upload.fileName,
                        mimeType = entry.upload.mimeType,
                        size = entry.upload.size,
                        open = entry.open,
                    ),
                ) { percent ->
                    mutate(entry.upload.id) { it.copy(progress = percent) }
                }
                mutate(entry.upload.id) { it.copy(state = State.DONE, progress = 100) }
            } catch (e: Exception) {
                synchronized(lock) { failedEntries[entry.upload.id] = entry }
                mutate(entry.upload.id) {
                    it.copy(state = State.FAILED, error = e.message ?: "Upload failed")
                }
            } finally {
                working = false
                pump()
            }
        }
    }

    private fun mutate(id: Long, transform: (Upload) -> Upload) {
        synchronized(lock) {
            _uploads.value = _uploads.value.map { if (it.id == id) transform(it) else it }
        }
    }
}
