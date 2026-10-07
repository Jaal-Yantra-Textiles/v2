package com.jyt.partner.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// Loading states, one vocabulary for every screen:
//   first load        → a skeleton shaped like the content (never a lone spinner)
//   refresh / re-read → the content stays put, a thin bar runs along the top
//   pull down         → PullToRefresh on every list and detail page

/** A grey block that breathes while content is on its way. */
@Composable
fun SkeletonBox(
    modifier: Modifier = Modifier,
    height: Dp = 14.dp,
    shape: Shape = RoundedCornerShape(6.dp),
) {
    val pulse by rememberInfiniteTransition(label = "skeleton").animateFloat(
        initialValue = 0.45f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(800), RepeatMode.Reverse),
        label = "skeleton-alpha",
    )
    Box(
        modifier
            .height(height)
            .alpha(pulse)
            .background(MaterialTheme.colorScheme.surfaceVariant, shape),
    )
}

/** Rows shaped like the list rows: picture, title, a line of detail. */
@Composable
fun ListSkeleton(rows: Int = 6, thumb: Boolean = true) {
    Column(Modifier.fillMaxWidth().padding(top = 4.dp)) {
        repeat(rows) {
            Card(
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 5.dp),
            ) {
                Row(
                    Modifier.padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (thumb) SkeletonBox(Modifier.size(44.dp), height = 44.dp, shape = RoundedCornerShape(8.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        SkeletonBox(Modifier.fillMaxWidth(0.6f), height = 14.dp)
                        SkeletonBox(Modifier.fillMaxWidth(0.85f), height = 10.dp)
                    }
                }
            }
        }
    }
}

/** A detail page's outline: the lead card, then a few sections. */
@Composable
fun DetailSkeleton(sections: Int = 3) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        repeat(sections) { i ->
            Card(
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    SkeletonBox(Modifier.fillMaxWidth(0.4f), height = 16.dp)
                    repeat(if (i == 0) 2 else 3) {
                        SkeletonBox(Modifier.fillMaxWidth(if (it % 2 == 0) 0.9f else 0.7f), height = 12.dp)
                    }
                }
            }
        }
    }
}

/** The thin bar for a refresh: content stays where it is. */
@Composable
fun RefreshBar(visible: Boolean) {
    if (visible) LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp))
}

/** Pull down to re-read. The bar shows while [refreshing]. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Refreshable(
    refreshing: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = onRefresh,
        modifier = modifier.fillMaxSize(),
        content = content,
    )
}
