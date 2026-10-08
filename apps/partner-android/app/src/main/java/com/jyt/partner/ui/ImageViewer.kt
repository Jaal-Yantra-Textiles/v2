package com.jyt.partner.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateOffsetAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import coil.compose.SubcomposeAsyncImage

private const val MAX_ZOOM = 5f
private const val DOUBLE_TAP_ZOOM = 2.5f

private val VIDEO_EXTENSIONS = setOf("mp4", "mov", "m4v", "webm", "3gp", "mkv")

/** A media URL that points at a video — the viewer offers to play it instead
 *  of trying to decode it as a picture. */
fun isVideoUrl(url: String): Boolean =
    url.substringBefore('?').substringAfterLast('.', "").lowercase() in VIDEO_EXTENSIONS

/**
 * Photos full screen: swipe between them, pinch or double-tap to zoom, drag
 * to look around a zoomed photo, tap to hide the bar. The DesignDetailView
 * zoom counterpart, shared by the moodboard and every media row.
 */
@Composable
fun ImageViewer(
    urls: List<String>,
    startIndex: Int,
    onDismiss: () -> Unit,
) {
    if (urls.isEmpty()) return
    val pager = rememberPagerState(initialPage = startIndex.coerceIn(0, urls.lastIndex)) { urls.size }
    // A zoomed photo owns the drag; the pager only swipes at 1x.
    var zoomed by remember { mutableStateOf(false) }
    var showChrome by remember { mutableStateOf(true) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(
                state = pager,
                userScrollEnabled = !zoomed,
                key = { urls[it] },
                modifier = Modifier.fillMaxSize(),
            ) { page ->
                val url = urls[page]
                if (isVideoUrl(url)) {
                    VideoPage(url)
                } else {
                    ZoomableImage(
                        url = url,
                        onZoomChange = { if (page == pager.currentPage) zoomed = it },
                        onTap = { showChrome = !showChrome },
                    )
                }
            }

            if (showChrome) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color.Black.copy(alpha = 0.45f))
                        .statusBarsPadding()
                        .padding(horizontal = 4.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Filled.Close, contentDescription = "Close", tint = Color.White)
                    }
                    if (urls.size > 1) {
                        Text(
                            "${pager.currentPage + 1} / ${urls.size}",
                            color = Color.White,
                            fontSize = 14.sp,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ZoomableImage(
    url: String,
    onZoomChange: (Boolean) -> Unit,
    onTap: () -> Unit,
) {
    var size by remember { mutableStateOf(IntSize.Zero) }
    var scale by remember { mutableStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    // Only the double-tap animates; pinch follows the fingers directly.
    var animate by remember { mutableStateOf(false) }
    val shownScale by animateFloatAsState(
        targetValue = scale,
        label = "zoom",
        finishedListener = { animate = false },
    )
    val shownOffset by animateOffsetAsState(targetValue = offset, label = "pan")

    // Keep the photo's edges on screen: at scale s the picture overhangs
    // the frame by (s - 1) / 2 of its size on each side.
    fun clamp(o: Offset, s: Float): Offset {
        val maxX = size.width * (s - 1f) / 2f
        val maxY = size.height * (s - 1f) / 2f
        return Offset(o.x.coerceIn(-maxX, maxX), o.y.coerceIn(-maxY, maxY))
    }

    fun setZoom(s: Float, o: Offset) {
        scale = s
        offset = clamp(o, s)
        onZoomChange(s > 1.01f)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .onSizeChanged { size = it }
            .pointerInput(url) {
                detectTapGestures(
                    onTap = { onTap() },
                    onDoubleTap = { tap ->
                        animate = true
                        if (scale > 1.01f) {
                            setZoom(1f, Offset.Zero)
                        } else {
                            // Zoom in about the tapped point.
                            val center = Offset(size.width / 2f, size.height / 2f)
                            setZoom(DOUBLE_TAP_ZOOM, (center - tap) * (DOUBLE_TAP_ZOOM - 1f))
                        }
                    },
                )
            }
            .pointerInput(url) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        val fingers = event.changes.count { it.pressed }
                        // One finger at 1x is a pager swipe — leave it alone.
                        if (fingers > 1 || scale > 1.01f) {
                            animate = false
                            val zoom = event.calculateZoom()
                            val newScale = (scale * zoom).coerceIn(1f, MAX_ZOOM)
                            // Scale about the fingers' centre so the pinched
                            // spot stays under them.
                            val centroid = event.calculateCentroid(useCurrent = true)
                            val center = Offset(size.width / 2f, size.height / 2f)
                            val anchor = if (centroid == Offset.Unspecified) center else centroid
                            val k = newScale / scale
                            val newOffset = (offset + center - anchor) * k - (center - anchor) +
                                event.calculatePan()
                            setZoom(newScale, if (newScale <= 1f) Offset.Zero else newOffset)
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    } while (event.changes.any { it.pressed })
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        SubcomposeAsyncImage(
            model = url,
            contentDescription = "Photo",
            contentScale = ContentScale.Fit,
            loading = { CircularProgressIndicator(color = Color.White, modifier = Modifier.size(32.dp)) },
            error = { Text("Couldn't load this photo.", color = Color.White, fontSize = 13.sp) },
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    val s = if (animate) shownScale else scale
                    scaleX = s
                    scaleY = s
                    val o = if (animate) shownOffset else offset
                    translationX = o.x
                    translationY = o.y
                },
        )
    }
}

/** A video can't be zoomed — hand it to the phone's player. */
@Composable
private fun VideoPage(url: String) {
    val context = LocalContext.current
    var failed by remember { mutableStateOf(false) }
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Filled.PlayCircle,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(72.dp),
        )
        TextButton(onClick = {
            try {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(url), "video/*"),
                )
            } catch (_: ActivityNotFoundException) {
                failed = true
            }
        }) { Text("Play video", color = Color.White) }
        if (failed) Text("No app on this phone can play it.", color = Color.White, fontSize = 12.sp)
    }
}

/** A media-row square that opens the viewer; a video gets a play badge
 *  (Coil can't draw a frame of it, so the square would be blank). */
@Composable
fun MediaThumb(
    url: String,
    size: Dp,
    corner: Dp,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(corner))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (isVideoUrl(url)) {
            Icon(
                Icons.Filled.PlayCircle,
                contentDescription = "Video",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(size / 2),
            )
        } else {
            AsyncImage(
                model = url,
                contentDescription = "Photo",
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(size),
            )
        }
    }
}
