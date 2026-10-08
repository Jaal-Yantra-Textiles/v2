package com.jyt.partner.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import java.io.File

/** Where a partner's photo comes from: the camera, or the phone's gallery. */
class MediaCapture internal constructor(
    val takePhoto: () -> Unit,
    val pickFromLibrary: () -> Unit,
)

/**
 * The camera + gallery launchers behind one handle (the MediaPickerView
 * counterpart). [onMedia] gets a content Uri either way, so the caller's
 * upload code reads both the same.
 *
 * The camera goes through the phone's own camera app (ACTION_IMAGE_CAPTURE),
 * which needs no CAMERA permission as long as the manifest doesn't declare
 * one. The photo lands in our cache dir, shared through the FileProvider.
 */
@Composable
fun rememberMediaCapture(
    onMedia: (Uri) -> Unit,
    onError: (String) -> Unit,
): MediaCapture {
    val context = LocalContext.current
    // Saveable: a low-memory phone can kill the app while the camera is open,
    // and the result must still find the file it was written to.
    var pendingPhoto by rememberSaveable { mutableStateOf<String?>(null) }

    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        val uri = pendingPhoto?.let(Uri::parse)
        pendingPhoto = null
        if (uri == null) return@rememberLauncherForActivityResult
        if (saved) onMedia(uri) else context.contentResolver.delete(uri, null, null)
    }
    val library = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) onMedia(uri)
    }

    return remember(camera, library) {
        MediaCapture(
            takePhoto = {
                val uri = newCameraFile(context)
                pendingPhoto = uri.toString()
                try {
                    camera.launch(uri)
                } catch (_: ActivityNotFoundException) {
                    pendingPhoto = null
                    onError("No camera app found on this phone.")
                } catch (_: SecurityException) {
                    pendingPhoto = null
                    onError("The camera isn't allowed for this app.")
                }
            },
            pickFromLibrary = {
                library.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
            },
        )
    }
}

/** A fresh file for the camera to write into. Earlier captures have been
 *  uploaded (or abandoned) by now, so they're cleared first. */
private fun newCameraFile(context: Context): Uri {
    val dir = File(context.cacheDir, "camera").apply { mkdirs() }
    dir.listFiles()?.forEach { it.delete() }
    val file = File(dir, "IMG_${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
}

/** Take photo / Choose from gallery — shown before an upload. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MediaSourceSheet(
    capture: MediaCapture,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.navigationBarsPadding().padding(bottom = 16.dp)) {
            ListItem(
                headlineContent = { Text("Take photo") },
                leadingContent = { Icon(Icons.Filled.PhotoCamera, contentDescription = null) },
                modifier = Modifier.clickable {
                    onDismiss()
                    capture.takePhoto()
                },
            )
            ListItem(
                headlineContent = { Text("Choose from gallery") },
                supportingContent = { Text("Photos or videos") },
                leadingContent = { Icon(Icons.Filled.PhotoLibrary, contentDescription = null) },
                modifier = Modifier.clickable {
                    onDismiss()
                    capture.pickFromLibrary()
                },
            )
        }
    }
}
