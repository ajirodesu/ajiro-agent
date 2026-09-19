package com.ajirohq.ajiroagent.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val DarkColorScheme = darkColorScheme(
    primary = AquaPrimary,
    background = BackgroundDark,
    surface = SurfaceDark,
    onPrimary = TextDark,
    onBackground = TextDark,
    onSurface = TextDark
)

private val LightColorScheme = lightColorScheme(
    primary = AquaPrimary,
    background = BackgroundLight,
    surface = SurfaceLight,
    onPrimary = TextLight,
    onBackground = TextLight,
    onSurface = TextLight
)

@Composable
fun AjiroAgentTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}
