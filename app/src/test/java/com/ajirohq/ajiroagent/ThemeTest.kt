package com.ajirohq.ajiroagent

import com.ajirohq.ajiroagent.ui.theme.AquaPrimary
import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Test

class ThemeTest {

    @Test
    fun testAquaPrimaryColor() {
        assertEquals(Color(0xFF00E5FF), AquaPrimary)
    }
}
