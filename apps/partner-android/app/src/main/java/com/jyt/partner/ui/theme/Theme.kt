package com.jyt.partner.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Black and white: ink on paper, greys for everything quiet. Status badges
// keep their own colours (Components.kt) — they carry meaning, not brand.
private val Ink = Color(0xFF111111)
private val Paper = Color(0xFFFFFFFF)

private val LightColors = lightColorScheme(
    primary = Ink,
    onPrimary = Paper,
    primaryContainer = Color(0xFFE6E6E6),
    onPrimaryContainer = Ink,
    secondary = Color(0xFF444444),
    onSecondary = Paper,
    secondaryContainer = Color(0xFFEAEAEA),
    onSecondaryContainer = Ink,
    tertiary = Color(0xFF444444),
    onTertiary = Paper,
    background = Paper,
    onBackground = Ink,
    surface = Paper,
    onSurface = Ink,
    surfaceVariant = Color(0xFFF2F2F2),
    onSurfaceVariant = Color(0xFF5C5C5C),
    surfaceContainerLowest = Paper,
    surfaceContainerLow = Color(0xFFF7F7F7),
    surfaceContainer = Color(0xFFF2F2F2),
    surfaceContainerHigh = Color(0xFFECECEC),
    surfaceContainerHighest = Color(0xFFE6E6E6),
    outline = Color(0xFF8A8A8A),
    outlineVariant = Color(0xFFD6D6D6),
)

private val DarkColors = darkColorScheme(
    primary = Paper,
    onPrimary = Ink,
    primaryContainer = Color(0xFF2E2E2E),
    onPrimaryContainer = Paper,
    secondary = Color(0xFFBDBDBD),
    onSecondary = Ink,
    secondaryContainer = Color(0xFF2A2A2A),
    onSecondaryContainer = Paper,
    tertiary = Color(0xFFBDBDBD),
    onTertiary = Ink,
    background = Color(0xFF000000),
    onBackground = Paper,
    surface = Color(0xFF000000),
    onSurface = Paper,
    surfaceVariant = Color(0xFF1C1C1C),
    onSurfaceVariant = Color(0xFFADADAD),
    surfaceContainerLowest = Color(0xFF000000),
    surfaceContainerLow = Color(0xFF111111),
    surfaceContainer = Color(0xFF161616),
    surfaceContainerHigh = Color(0xFF1E1E1E),
    surfaceContainerHighest = Color(0xFF262626),
    outline = Color(0xFF7A7A7A),
    outlineVariant = Color(0xFF333333),
)

@Composable
fun JytPartnerTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        content = content,
    )
}
