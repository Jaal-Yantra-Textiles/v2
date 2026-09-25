package com.jyt.partner.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Saffron = Color(0xFFC9A227)
private val Indigo = Color(0xFF4C53A8)
private val LightColors = lightColorScheme(
    primary = Saffron,
    secondary = Indigo,
)
private val DarkColors = darkColorScheme(
    primary = Color(0xFFD8B54A),
    secondary = Color(0xFF8E94C8),
)

@Composable
fun JytPartnerTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        content = content,
    )
}
