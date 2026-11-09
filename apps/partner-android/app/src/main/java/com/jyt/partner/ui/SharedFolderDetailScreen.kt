package com.jyt.partner.ui

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.ApiDate
import com.jyt.partner.models.FolderMediaComment
import com.jyt.partner.models.SharedFolder
import com.jyt.partner.models.SharedFolderMediaFile
import com.jyt.partner.models.formatDate
import com.jyt.partner.uploads.FolderUploadManager
import kotlinx.coroutines.launch

/** One shared folder: its files and the upload that adds to them — the
 *  mobile counterpart of the partner-ui's folder detail. Photos and videos
 *  come from the camera or a multi-select gallery trip and go straight to
 *  S3 through the same multipart presigned flow the web uses. Uploads run
 *  in the background queue (FolderUploadManager), so picking more — or
 *  leaving the folder — never cancels what's in flight. A comment thread
 *  sits under every file. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SharedFolderDetailScreen(folderId: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var folder by remember { mutableStateOf<SharedFolder?>(null) }
    var loading by remember { mutableStateOf(true) }
    var refreshing by remember { mutableStateOf(false) }
    var errorText by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }

    var showMediaSource by remember { mutableStateOf(false) }

    // The background queue: enqueue everything picked/shot, watch it drain.
    val allUploads by FolderUploadManager.uploads.collectAsState()
    val mine = allUploads.filter { it.folderId == folderId }
    val activeUploads = mine.filter { it.state == FolderUploadManager.State.PENDING || it.state == FolderUploadManager.State.UPLOADING }
    val doneUploads = mine.filter { it.state == FolderUploadManager.State.DONE }
    val failedUploads = mine.filter { it.state == FolderUploadManager.State.FAILED }

    // View + comments
    var viewer by remember { mutableStateOf<Pair<List<String>, Int>?>(null) }
    var commentsFor by remember { mutableStateOf<SharedFolderMediaFile?>(null) }

    fun enqueue(uriString: String) {
        val target = folder ?: return
        FolderUploadManager.enqueue(context, target.id, target.name, Uri.parse(uriString))
    }

    val mediaCapture = rememberMediaCapture(
        onMedia = { enqueue(it.toString()) },
        onError = { actionError = it },
        onMultiple = { uris -> uris.forEach { enqueue(it.toString()) } },
    )

    suspend fun load() {
        loading = folder == null
        try {
            folder = PartnerApi.get(context).sharedFolder(folderId)
            errorText = null
        } catch (e: Exception) {
            if (folder == null) errorText = e.message ?: "Something went wrong."
        }
        loading = false
    }

    LaunchedEffect(folderId) { load() }

    // A file landed → the folder's file list is stale. Reload on every new
    // DONE (and on FAILED, so a partial upload doesn't leave stale state).
    var finishedSeen by remember { mutableStateOf(-1) }
    val finishedCount = doneUploads.size + failedUploads.size
    LaunchedEffect(finishedCount) {
        if (finishedSeen >= 0 && finishedCount > finishedSeen) {
            load()
        }
        finishedSeen = finishedCount
    }

    val current = folder
    val mediaFiles = current?.mediaFiles.orEmpty()
    val viewable = mediaFiles.filter { !it.filePath.isNullOrBlank() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(current?.name ?: "Folder") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                loading -> DetailSkeleton(sections = 3)
                current == null -> Box(Modifier.fillMaxSize().padding(24.dp)) {
                    ErrorState("Couldn't load this folder", errorText ?: "") {
                        scope.launch { load() }
                    }
                }
                else -> Refreshable(
                    refreshing = refreshing,
                    onRefresh = {
                        scope.launch {
                            refreshing = true
                            load()
                            refreshing = false
                        }
                    },
                ) {
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(3),
                        modifier = Modifier.fillMaxSize(),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                        contentPadding = PaddingValues(
                            start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp,
                        ),
                    ) {
                        // Folder summary + upload — full width.
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            Column(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(bottom = 8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(
                                    text = "${mediaFiles.size} file${if (mediaFiles.size == 1) "" else "s"} · ${if (current.isPublic) "Public" else "Private"}",
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                OutlinedButton(
                                    onClick = { showMediaSource = true },
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Icon(Icons.Filled.AddPhotoAlternate, contentDescription = null)
                                    Spacer(Modifier.width(8.dp))
                                    Text(if (activeUploads.isEmpty()) "Upload photos or videos" else "Add more")
                                }
                            }
                        }

                        // The queue: in-flight first, then failures, then
                        // finished files until cleared — all full width.
                        if (mine.isNotEmpty()) {
                            item(span = { GridItemSpan(maxLineSpan) }) {
                                Column(
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(bottom = 8.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    activeUploads.forEach { upload ->
                                        Column(
                                            verticalArrangement = Arrangement.spacedBy(4.dp),
                                            modifier = Modifier.fillMaxWidth(),
                                        ) {
                                            Row(verticalAlignment = Alignment.CenterVertically) {
                                                Text(
                                                    upload.fileName,
                                                    fontSize = 13.sp,
                                                    fontWeight = FontWeight.Medium,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis,
                                                    modifier = Modifier.weight(1f, fill = false),
                                                )
                                                Spacer(Modifier.weight(1f))
                                                Text(
                                                    if (upload.state == FolderUploadManager.State.UPLOADING) "Uploading… ${upload.progress}%" else "Waiting",
                                                    fontSize = 12.sp,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                )
                                            }
                                            LinearProgressIndicator(
                                                progress = { upload.progress / 100f },
                                                modifier = Modifier.fillMaxWidth(),
                                            )
                                        }
                                    }
                                    failedUploads.forEach { upload ->
                                        Column(
                                            verticalArrangement = Arrangement.spacedBy(2.dp),
                                            modifier = Modifier.fillMaxWidth(),
                                        ) {
                                            Text(upload.fileName, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                            Text(
                                                upload.error ?: "Upload failed",
                                                fontSize = 12.sp,
                                                color = MaterialTheme.colorScheme.error,
                                            )
                                            Row {
                                                TextButton(onClick = { FolderUploadManager.retry(upload.id) }) {
                                                    Text("Retry")
                                                }
                                                TextButton(onClick = { FolderUploadManager.remove(upload.id) }) {
                                                    Text("Remove")
                                                }
                                            }
                                        }
                                    }
                                    if (doneUploads.isNotEmpty()) {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                                        ) {
                                            Icon(
                                                Icons.Filled.CheckCircle,
                                                contentDescription = null,
                                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                                modifier = Modifier.size(16.dp),
                                            )
                                            Text(
                                                "${doneUploads.size} uploaded",
                                                fontSize = 12.sp,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                modifier = Modifier.weight(1f),
                                            )
                                            IconButton(
                                                onClick = { FolderUploadManager.clear(folderId, FolderUploadManager.State.DONE) },
                                                modifier = Modifier.size(24.dp),
                                            ) {
                                                Icon(
                                                    Icons.Filled.Close,
                                                    contentDescription = "Clear",
                                                    modifier = Modifier.size(14.dp),
                                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        if (mediaFiles.isEmpty() && activeUploads.isEmpty()) {
                            item(span = { GridItemSpan(maxLineSpan) }) {
                                EmptyState(
                                    icon = Icons.Filled.FolderOpen,
                                    title = "No files yet",
                                    subtitle = "Add photos or videos for the JYT team with the button above.",
                                )
                            }
                        } else if (mediaFiles.isNotEmpty()) {
                            itemsIndexed(mediaFiles, key = { _, m -> m.id }) { _, media ->
                                MediaTile(
                                    media = media,
                                    onOpen = {
                                        media.filePath?.let { path ->
                                            val index = viewable.indexOfFirst { it.filePath == path }
                                            if (index >= 0) {
                                                viewer = viewable.mapNotNull { it.filePath } to index
                                            }
                                        }
                                    },
                                    onComments = { commentsFor = media },
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (showMediaSource) {
        MediaSourceSheet(capture = mediaCapture, onDismiss = { showMediaSource = false }, multiple = true)
    }

    viewer?.let { (urls, index) ->
        ImageViewer(urls = urls, startIndex = index, onDismiss = { viewer = null })
    }

    commentsFor?.let { media ->
        MediaCommentsSheet(
            folderId = folderId,
            media = media,
            onDismiss = { commentsFor = null },
        )
    }

    if (actionError != null) {
        AlertDialog(
            onDismissRequest = { actionError = null },
            title = { Text("Couldn't do that") },
            text = { Text(actionError ?: "") },
            confirmButton = { TextButton(onClick = { actionError = null }) { Text("OK") } },
        )
    }
}

/** One grid tile: the preview (a play badge over videos), a comment bubble
 *  in the corner over a scrim so it reads on any picture. */
@Composable
private fun MediaTile(
    media: SharedFolderMediaFile,
    onOpen: () -> Unit,
    onComments: () -> Unit,
) {
    Box(modifier = Modifier.size(110.dp)) {
        val path = media.filePath
        if (path != null) {
            MediaThumb(
                url = path,
                size = 110.dp,
                corner = 10.dp,
                onClick = onOpen,
            )
        } else {
            Box(
                modifier = Modifier
                    .size(110.dp)
                    .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = (media.originalName ?: media.fileName ?: "File").substringAfterLast('.', "File"),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        IconButton(
            onClick = onComments,
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(4.dp)
                .size(24.dp)
                .background(
                    MaterialTheme.colorScheme.scrim.copy(alpha = 0.45f),
                    androidx.compose.foundation.shape.CircleShape,
                ),
        ) {
            Icon(
                Icons.Filled.ChatBubble,
                contentDescription = "Comments",
                tint = Color.White,
                modifier = Modifier.size(14.dp),
            )
        }
    }
}

/** The per-file comment thread — list + add box, mirroring the partner-ui's
 *  media detail panel. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MediaCommentsSheet(
    folderId: String,
    media: SharedFolderMediaFile,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var comments by remember { mutableStateOf<List<FolderMediaComment>?>(null) }
    var newComment by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }

    LaunchedEffect(media.id) {
        comments = runCatching {
            PartnerApi.get(context).folderMediaComments(folderId, media.id).comments
        }.getOrDefault(emptyList())
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                media.originalName ?: media.fileName ?: "File",
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            when (val thread = comments) {
                null -> Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 20.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }
                else -> if (thread.isEmpty()) {
                    Text(
                        "No comments yet.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        thread.forEach { comment ->
                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Row {
                                    Text(
                                        when (comment.authorType) {
                                            "admin" -> "JYT"
                                            "partner" -> "You"
                                            else -> comment.authorName ?: "Someone"
                                        },
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    Spacer(Modifier.weight(1f))
                                    comment.createdAt?.let {
                                        Text(
                                            formatDate(ApiDate.parse(it)),
                                            fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                                Text(comment.content ?: "", fontSize = 13.sp)
                            }
                        }
                    }
                }
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = newComment,
                    onValueChange = { newComment = it },
                    placeholder = { Text("Add a comment") },
                    modifier = Modifier.weight(1f),
                    maxLines = 3,
                )
                IconButton(
                    onClick = {
                        val text = newComment.trim()
                        if (text.isEmpty()) return@IconButton
                        sending = true
                        scope.launch {
                            try {
                                PartnerApi.get(context).addFolderMediaComment(folderId, media.id, text)
                                comments = runCatching {
                                    PartnerApi.get(context)
                                        .folderMediaComments(folderId, media.id).comments
                                }.getOrDefault(emptyList())
                                newComment = ""
                            } catch (e: Exception) {
                                // Keep the text; the user retries.
                            } finally {
                                sending = false
                            }
                        }
                    },
                    enabled = newComment.isNotBlank() && !sending,
                ) {
                    if (sending) {
                        CircularProgressIndicator(Modifier.size(20.dp))
                    } else {
                        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send")
                    }
                }
            }
        }
    }
}
