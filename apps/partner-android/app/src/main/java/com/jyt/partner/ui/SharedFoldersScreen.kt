package com.jyt.partner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.SharedFolder
import com.jyt.partner.uploads.FolderUploadManager
import kotlinx.coroutines.launch

/** The media folders assigned to this partner — the individual persona's
 *  media surface. Same list as the partner-ui's Shared Folders page; each
 *  folder opens for browsing and uploading. */
@Composable
fun SharedFoldersScreen(onOpenFolder: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var folders by remember { mutableStateOf<List<SharedFolder>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var refreshing by remember { mutableStateOf(false) }
    var errorText by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        loading = folders.isEmpty()
        try {
            folders = PartnerApi.get(context).sharedFolders().sharedFolders
            errorText = null
        } catch (e: Exception) {
            if (folders.isEmpty()) errorText = e.message ?: "Something went wrong."
        }
        loading = false
    }

    LaunchedEffect(Unit) { load() }

    // Background uploads stay visible from the list: leave a folder while
    // its files upload and the badge keeps counting here.
    val allUploads by FolderUploadManager.uploads.collectAsState()
    val activeByFolder = allUploads
        .filter { it.state == FolderUploadManager.State.PENDING || it.state == FolderUploadManager.State.UPLOADING }
        .groupingBy { it.folderId }
        .eachCount()

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp),
        ) {
            Text("Folders", fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            if (folders.isNotEmpty()) {
                Text(
                    "${folders.size} folder${if (folders.size == 1) "" else "s"}",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        if (errorText != null) {
            Box(Modifier.fillMaxSize()) {
                ErrorState("Couldn't load folders", errorText ?: "") { scope.launch { load() } }
            }
        } else if (loading) {
            ListSkeleton(rows = 4, thumb = false)
        } else if (folders.isEmpty()) {
            Box(Modifier.fillMaxSize()) {
                EmptyState(
                    icon = Icons.Filled.FolderOpen,
                    title = "No folders",
                    subtitle = "Media folders the JYT team shares with you show up here.",
                )
            }
        } else {
            Refreshable(
                refreshing = refreshing,
                onRefresh = {
                    scope.launch {
                        refreshing = true
                        load()
                        refreshing = false
                    }
                },
            ) {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(folders, key = { it.id }) { folder ->
                        FolderRow(folder, activeUploads = activeByFolder[folder.id] ?: 0) {
                            onOpenFolder(folder.id)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FolderRow(folder: SharedFolder, activeUploads: Int, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 5.dp),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = folder.name,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.weight(1f))
                if (activeUploads > 0) {
                    StatusBadge("Uploading $activeUploads", BadgeTone.ACTIVE)
                    Spacer(Modifier.width(8.dp))
                }
                StatusBadge(
                    "${folder.mediaFiles.size} file${if (folder.mediaFiles.size == 1) "" else "s"}",
                    if (folder.mediaFiles.isEmpty()) BadgeTone.MUTED else BadgeTone.DONE,
                )
            }
            folder.description?.takeIf { it.isNotBlank() }?.let {
                Text(
                    text = it,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
