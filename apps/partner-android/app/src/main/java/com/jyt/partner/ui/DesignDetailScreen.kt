package com.jyt.partner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.jyt.partner.api.PartnerApi
import com.jyt.partner.models.ApiDate
import com.jyt.partner.models.formatDate
import com.jyt.partner.models.DesignDetail
import com.jyt.partner.models.ProductionRun
import kotlinx.coroutines.launch

/** A design — the DesignDetailView counterpart: overview, media gallery,
 *  moodboard images, colors, sizes, the matching production runs. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DesignDetailScreen(
    designId: String,
    onOpenRun: (String) -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var design by remember { mutableStateOf<DesignDetail?>(null) }
    var runs by remember { mutableStateOf<List<ProductionRun>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var errorText by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        loading = design == null
        try {
            design = PartnerApi.get(context).design(designId)
            errorText = null
            runs = runCatching {
                PartnerApi.get(context).productionRuns(designId = designId).productionRuns
            }.getOrDefault(emptyList())
        } catch (e: Exception) {
            errorText = e.message
        }
        loading = false
    }

    LaunchedEffect(Unit) { load() }

    Column(modifier = Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(design?.name ?: "Design") },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
            },
        )

        val current = design
        when {
            loading -> Box(Modifier.fillMaxSize()) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
            }
            current == null -> Box(Modifier.fillMaxSize().padding(24.dp)) {
                ErrorState("Couldn't load this design", errorText ?: "") {
                    scope.launch { load() }
                }
            }
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item {
                    SectionCard("Overview") {
                        current.status?.let { StatRow("Status", it) }
                        current.designType?.let { StatRow("Design type", it) }
                        current.productType?.let { StatRow("Product type", it) }
                        current.conceptTheme?.let { StatRow("Concept", it) }
                        current.partnerInfo?.partnerStatus?.let {
                            StatRow("Your status", it.replace('_', ' '))
                        }
                        StatRow("Created", formatDate(ApiDate.parse(current.createdAt)))
                        current.estimatedCost?.value?.let {
                            StatRow(
                                "Estimated cost",
                                formatCurrency(it, current.costCurrency),
                            )
                        }
                        current.aestheticKeywords?.takeIf { it.isNotEmpty() }?.let {
                            Text(
                                "Keywords: ${it.joinToString(", ")}",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        current.description?.let {
                            Text(it, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                        }
                        current.designerNotes?.let {
                            Text(
                                it,
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(top = 4.dp),
                            )
                        }
                    }
                }

                item {
                    SectionCard("Media") {
                        val files = current.mediaFiles.orEmpty()
                        if (files.isEmpty()) {
                            Text(
                                "No media yet.",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        } else {
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                items(files, key = { it.url }) { file ->
                                    AsyncImage(
                                        model = file.url,
                                        contentDescription = null,
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier.size(96.dp).clip(RoundedCornerShape(10.dp)),
                                    )
                                }
                            }
                        }
                    }
                }

                // Moodboard images — embedded data URLs, no geometry read.
                current.moodboard?.takeIf { it.imageDataUrls.isNotEmpty() }?.let { board ->
                    item {
                        SectionCard("Moodboard") {
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                items(board.imageDataUrls, key = { it.first }) { (_, data) ->
                                    AsyncImage(
                                        model = data,
                                        contentDescription = null,
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier.size(96.dp).clip(RoundedCornerShape(10.dp)),
                                    )
                                }
                            }
                        }
                    }
                }

                current.colors?.takeIf { it.isNotEmpty() }?.let { colors ->
                    item {
                        SectionCard("Colors") {
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                colors.forEach { color ->
                                    Column(
                                        horizontalAlignment = Alignment.CenterHorizontally,
                                        verticalArrangement = Arrangement.spacedBy(4.dp),
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .size(40.dp)
                                                .clip(CircleShape)
                                                .background(
                                                    runCatching { Color(android.graphics.Color.parseColor(color.hexCode)) }
                                                        .getOrDefault(MaterialTheme.colorScheme.primary)
                                                ),
                                        )
                                        Text(color.name, fontSize = 11.sp)
                                    }
                                }
                            }
                        }
                    }
                }

                current.sizeSets?.takeIf { it.isNotEmpty() }?.let { sizes ->
                    item {
                        SectionCard("Sizes") {
                            sizes.forEach { size ->
                                Text("${size.sizeLabel}:", fontWeight = FontWeight.Medium)
                                size.measurements?.forEach { (point, value) ->
                                    Text(
                                        "  $point: ${value.value ?: "—"}",
                                        fontSize = 12.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }

                if (runs.isNotEmpty()) {
                    item {
                        SectionCard("Production runs") {
                            runs.forEach { run ->
                                ClickableRow(onClick = { onOpenRun(run.id) }) {
                                    RunStatusBadge(run.status ?: "")
                                    Spacer(Modifier.size(12.dp))
                                    Text(run.runType?.replaceFirstChar { it.uppercase() } ?: "Run")
                                    Spacer(Modifier.weight(1f))
                                    Icon(
                                        Icons.AutoMirrored.Filled.ArrowForward,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
