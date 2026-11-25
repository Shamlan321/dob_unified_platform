package com.kakaonotilistener.kakaodump

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.kakaonotilistener.kakaodump.relay.ChatRelayConfig
import com.kakaonotilistener.kakaodump.ui.theme.KakaoDumpTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            KakaoDumpTheme {
                KakaoDumpScreen()
            }
        }
    }
}

// ─── Colour tokens ────────────────────────────────────────────────────────────

private val BgDark      = Color(0xFF0D0F14)
private val Surface1    = Color(0xFF161A22)
private val Surface2    = Color(0xFF1E2430)
private val Accent      = Color(0xFFFFCD00)   // KakaoTalk yellow
private val AccentDim   = Color(0xFF8F7200)
private val TextPrimary = Color(0xFFE8EAF0)
private val TextSecond  = Color(0xFF8892A4)
private val Green       = Color(0xFF4CAF50)
private val Red         = Color(0xFFEF5350)
private val Mono        = FontFamily.Monospace

// ─── Screen ───────────────────────────────────────────────────────────────────

@Composable
fun KakaoDumpScreen(vm: MainViewModel = viewModel()) {
    val state by vm.uiState.collectAsState()
    val outerScroll = rememberScrollState(0)

    Box(
        Modifier
            .fillMaxSize()
            .background(BgDark)
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(outerScroll)
                .systemBarsPadding()
                .padding(horizontal = 16.dp)
        ) {
            // ── Header ────────────────────────────────────────────────────────
            Spacer(Modifier.height(16.dp))
            Text(
                text = "KakaoDump",
                color = Accent,
                fontSize = 26.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.sp
            )
            Text(
                text = "v1 · on-device DB extract & decrypt",
                color = TextSecond,
                fontSize = 12.sp
            )
            Spacer(Modifier.height(20.dp))

            // ── Inputs ────────────────────────────────────────────────────────
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                DumpTextField(
                    label = "User ID (Long)",
                    value = state.userId,
                    onValueChange = vm::onUserIdChange,
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.weight(2f)
                )
                DumpTextField(
                    label = "Default Enc Type",
                    value = state.defaultEncType,
                    onValueChange = vm::onEncTypeChange,
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.weight(1f)
                )
            }

            Spacer(Modifier.height(16.dp))

            // ── Root check ────────────────────────────────────────────────────
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Button(
                    onClick = vm::checkRoot,
                    enabled = !state.isCheckingRoot,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Surface2,
                        contentColor = TextPrimary,
                        disabledContainerColor = Surface2.copy(alpha = 0.5f)
                    ),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    if (state.isCheckingRoot) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = Accent
                        )
                        Spacer(Modifier.width(8.dp))
                    }
                    Text("Check Root Access")
                }

                RootBadge(state.rootStatus)
            }

            Spacer(Modifier.height(12.dp))

            // ── Dump button ───────────────────────────────────────────────────
            Button(
                onClick = vm::dumpAndDecrypt,
                enabled = state.rootStatus == RootStatus.GRANTED && !state.isDumping,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Accent,
                    contentColor = Color.Black,
                    disabledContainerColor = AccentDim.copy(alpha = 0.4f),
                    disabledContentColor = Color.Black.copy(alpha = 0.4f)
                ),
                shape = RoundedCornerShape(8.dp)
            ) {
                if (state.isDumping) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.5.dp,
                        color = Color.Black
                    )
                    Spacer(Modifier.width(10.dp))
                }
                Text(
                    if (state.isDumping) "Dumping…" else "Dump & Decrypt Database",
                    fontWeight = FontWeight.Bold
                )
            }

            Spacer(Modifier.height(16.dp))

            // ── Auto-refresh / auto-relay toggles ────────────────────────
            HorizontalDivider(color = Surface2, thickness = 1.dp)
            Spacer(Modifier.height(14.dp))
            SectionHeader("Auto Refresh & Relay")
            Spacer(Modifier.height(8.dp))

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(Surface1)
                    .border(1.dp, Surface2, RoundedCornerShape(8.dp))
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("Auto Dump every 5s", color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        Text(
                            "Automatically extract & decrypt KakaoTalk DB every 5 seconds. Requires Root granted + User ID set.",
                            color = TextSecond, fontSize = 11.sp, lineHeight = 14.sp
                        )
                    }
                    Switch(
                        checked = state.autoRefreshEnabled,
                        onCheckedChange = vm::setAutoRefreshEnabled,
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = Accent,
                            checkedTrackColor = Accent.copy(alpha = 0.3f),
                            uncheckedThumbColor = TextSecond,
                            uncheckedTrackColor = Surface2
                        )
                    )
                }

                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("Auto Relay New Msgs", color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        Text(
                            "After each dump, send only new messages from enabled chats to the web server (tracked by row id).",
                            color = TextSecond, fontSize = 11.sp, lineHeight = 14.sp
                        )
                    }
                    Switch(
                        checked = state.autoRelayEnabled,
                        onCheckedChange = vm::setAutoRelayEnabled,
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = Green,
                            checkedTrackColor = Green.copy(alpha = 0.3f),
                            uncheckedThumbColor = TextSecond,
                            uncheckedTrackColor = Surface2
                        )
                    )
                }

                if (state.lastRefreshAt > 0L) {
                    var refreshTick by remember(state.lastRefreshAt) { mutableLongStateOf(0L) }
                    LaunchedEffect(state.lastRefreshAt) {
                        while (true) {
                            refreshTick = System.currentTimeMillis()
                            delay(1000L)
                        }
                    }
                    val diffSec = (refreshTick - state.lastRefreshAt) / 1000
                    Text(
                        "Last refresh: ${diffSec}s ago",
                        color = TextSecond,
                        fontSize = 11.sp,
                        fontFamily = Mono
                    )
                }
            }

            Spacer(Modifier.height(16.dp))

            // ── Relay Config ────────────────────────────────────────────────
            HorizontalDivider(color = Surface2, thickness = 1.dp)
            Spacer(Modifier.height(14.dp))
            SectionHeader("Relay Config — route chats to BIC Pulse webhooks")
            Spacer(Modifier.height(8.dp))

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                DumpTextField(
                    label = "Web Server Base URL",
                    value = state.baseUrl,
                    onValueChange = vm::onBaseUrlChange,
                    keyboardType = KeyboardType.Uri,
                    modifier = Modifier.weight(2f)
                )
                DumpTextField(
                    label = "Ingest Secret (optional)",
                    value = state.ingestSecret,
                    onValueChange = vm::onIngestSecretChange,
                    keyboardType = KeyboardType.Password,
                    modifier = Modifier.weight(1.3f)
                )
            }

            Spacer(Modifier.height(10.dp))

            // Chat-level relay list
            val chatConfigs = state.chatRelayConfigs.values.toList().sortedBy { it.chatId }
            val latestByChat = remember(state.messages) {
                state.messages
                    .groupBy { it.chatId }
                    .mapValues { (_, rows) -> rows.firstOrNull() }
            }
            if (chatConfigs.isEmpty()) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Surface1)
                        .border(1.dp, Surface2, RoundedCornerShape(8.dp))
                        .padding(16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        "No chats known yet — run Dump & Decrypt first to see chat IDs here.",
                        color = TextSecond, fontSize = 12.sp
                    )
                }
            } else {
                Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Surface1)
                        .border(1.dp, Surface2, RoundedCornerShape(8.dp))
                        .padding(10.dp)
                ) {
                    chatConfigs.forEach { cfg ->
                        ChatRelayRow(
                            cfg = cfg,
                            messageCount = state.messages.count { it.chatId == cfg.chatId },
                            latestMessage = latestByChat[cfg.chatId],
                            chatName = state.chatNames[cfg.chatId],
                            lastRelayedRowId = state.lastRelayedRowIds[cfg.chatId] ?: 0L,
                            onEnabledChange = { vm.setChatEnabled(cfg.chatId, it) },
                            onDeptChange = { vm.setChatDepartment(cfg.chatId, it) }
                        )
                    }
                }
            }

            Spacer(Modifier.height(10.dp))

            // Relay action buttons
            val anyEnabled = chatConfigs.any { it.enabled }
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Button(
                    onClick = vm::relayNewMessagesOnly,
                    enabled = anyEnabled && !state.isRelaying && !state.isDumping,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF1565C0),
                        contentColor = Color.White,
                        disabledContainerColor = Color(0xFF0D2F52),
                        disabledContentColor = Color(0xFF4A6A8A)
                    ),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(
                        "Relay New Only",
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp
                    )
                }

                Button(
                    onClick = vm::relayEnabledMessages,
                    enabled = anyEnabled && !state.isRelaying && !state.isDumping,
                    modifier = Modifier.weight(1.4f),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF2E7D32),
                        contentColor = Color.White,
                        disabledContainerColor = Color(0xFF1B3A1D),
                        disabledContentColor = Color(0xFF6B8B6D)
                    ),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    if (state.isRelaying) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.5.dp,
                            color = Color.White
                        )
                        Spacer(Modifier.width(10.dp))
                    }
                    Text(
                        if (state.isRelaying) "Relaying…" else "Relay All Enabled (Full)",
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            // Last relay results summary
            if (state.lastRelayResults.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xFF0A0C10))
                        .border(1.dp, Surface2, RoundedCornerShape(6.dp))
                        .padding(10.dp)
                ) {
                    Text(
                        "Last relay run:",
                        color = TextPrimary,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(Modifier.height(4.dp))
                    state.lastRelayResults.forEach { r ->
                        val color = if (r.success) Green else Red
                        val icon  = if (r.success) "✓" else "✗"
                        Text(
                            "$icon chat=${r.chatId} → ${r.department}: ${r.count} msgs, inserted=${r.inserted}, dups=${r.duplicates}",
                            color = color, fontSize = 11.sp, fontFamily = Mono,
                            lineHeight = 16.sp
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            // ── Two-pane scrollable area ──────────────────────────────────────
            // Uses explicit heights now that the outer Column is vertically
            // scrollable (weight() is not allowed inside a parent with
            // infinite height). Each pane is still independently scrollable
            // via LazyColumn / verticalScroll.
            Column {
                // Messages list
                SectionHeader("Messages (${state.messages.size})")
                Spacer(Modifier.height(6.dp))
                LazyColumn(
                    modifier = Modifier
                        .heightIn(min = 260.dp, max = 480.dp)
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Surface1)
                        .border(1.dp, Surface2, RoundedCornerShape(8.dp)),
                    contentPadding = PaddingValues(8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    if (state.messages.isEmpty() && !state.isDumping) {
                        item {
                            Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                                Text("No messages yet — tap Dump & Decrypt", color = TextSecond, fontSize = 13.sp)
                            }
                        }
                    }
                    items(state.messages) { msg ->
                        MessageCard(msg)
                    }
                }

                Spacer(Modifier.height(12.dp))

                // Log area
                SectionHeader("Log")
                Spacer(Modifier.height(6.dp))
                val logScrollState = rememberScrollState(0)
                LaunchedEffect(state.logLines.size) {
                    logScrollState.animateScrollTo(logScrollState.maxValue)
                }
                Column(
                    modifier = Modifier
                        .heightIn(min = 180.dp, max = 320.dp)
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color(0xFF0A0C10))
                        .border(1.dp, Surface2, RoundedCornerShape(8.dp))
                        .verticalScroll(logScrollState)
                        .padding(10.dp)
                ) {
                    if (state.logLines.isEmpty()) {
                        Text("Waiting…", color = TextSecond, fontFamily = Mono, fontSize = 12.sp)
                    }
                    state.logLines.forEach { line ->
                        val color = when {
                            line.startsWith("ERROR") -> Red
                            line.startsWith("Done")  -> Green
                            else                     -> TextSecond
                        }
                        Text(line, color = color, fontFamily = Mono, fontSize = 12.sp, lineHeight = 18.sp)
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

// ─── Sub-composables ──────────────────────────────────────────────────────────

@Composable
private fun DumpTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    keyboardType: KeyboardType,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label, fontSize = 11.sp) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        colors = OutlinedTextFieldDefaults.colors(
            focusedTextColor = TextPrimary,
            unfocusedTextColor = TextPrimary,
            focusedBorderColor = Accent,
            unfocusedBorderColor = Surface2,
            focusedLabelColor = Accent,
            unfocusedLabelColor = TextSecond,
            cursorColor = Accent,
            focusedContainerColor = Surface1,
            unfocusedContainerColor = Surface1
        ),
        textStyle = LocalTextStyle.current.copy(fontFamily = Mono, fontSize = 14.sp),
        modifier = modifier
    )
}

@Composable
private fun RootBadge(status: RootStatus) {
    val (text, color) = when (status) {
        RootStatus.GRANTED -> "Root: granted ✓" to Green
        RootStatus.DENIED  -> "Root: denied ✗"  to Red
        RootStatus.UNKNOWN -> "Root: unknown (tap to check)" to TextSecond
    }
    Text(text, color = color, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
}

@Composable
private fun SectionHeader(title: String) {
    Text(title, color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
}

@Composable
private fun MessageCard(msg: MessageRow) {
    val bg = when {
        msg.decryptFailed -> Color(0xFF2A1515)
        msg.rawOnly       -> Color(0xFF1A1A24)
        else              -> Surface2
    }
    val borderColor = when {
        msg.decryptFailed -> Red.copy(alpha = 0.6f)
        msg.rawOnly       -> Color(0xFF3A3A55).copy(alpha = 0.6f)
        else              -> Surface1
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .border(1.dp, borderColor, RoundedCornerShape(6.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        // Header row: IDs + timestamp
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MetaChip("chat ${msg.chatId}")
                MetaChip("user ${msg.userId}")
                MetaChip("#${msg.rowId}")
            }
            Text(msg.timestamp, color = TextSecond, fontSize = 10.sp, fontFamily = Mono)
        }

        Spacer(Modifier.height(4.dp))

        when {
            msg.decryptFailed -> {
                // Decrypt was attempted but threw — wrong user_id or corrupted data
                Surface(color = Red, shape = RoundedCornerShape(3.dp)) {
                    Text(
                        "DECRYPT FAILED",
                        color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 5.dp, vertical = 2.dp)
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    msg.rawCiphertext,
                    color = Red.copy(alpha = 0.7f), fontFamily = Mono,
                    fontSize = 11.sp, maxLines = 3, overflow = TextOverflow.Ellipsis
                )
            }
            msg.rawOnly -> {
                // enc_type was null in both enc column and v JSON — kept as-is per Python reference
                Surface(color = Color(0xFF3A3A6A), shape = RoundedCornerShape(3.dp)) {
                    Text(
                        "NO ENC",
                        color = Color(0xFFAAABDD), fontSize = 9.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 5.dp, vertical = 2.dp)
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    msg.text,
                    color = TextSecond, fontSize = 12.sp, lineHeight = 17.sp,
                    maxLines = 4, overflow = TextOverflow.Ellipsis
                )
            }
            else -> {
                // Successfully decrypted
                Text(msg.text, color = TextPrimary, fontSize = 13.sp, lineHeight = 18.sp)
            }
        }
    }
}

@Composable
private fun MetaChip(text: String) {
    Surface(
        color = Surface1,
        shape = RoundedCornerShape(3.dp)
    ) {
        Text(
            text,
            color = TextSecond,
            fontSize = 10.sp,
            fontFamily = Mono,
            modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)
        )
    }
}

// ─── Chat relay row ──────────────────────────────────────────────────────────

@Composable
private fun ChatRelayRow(
    cfg: ChatRelayConfig,
    messageCount: Int,
    latestMessage: MessageRow?,
    chatName: String?,
    lastRelayedRowId: Long,
    onEnabledChange: (Boolean) -> Unit,
    onDeptChange: (String) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .background(if (cfg.enabled) Color(0xFF132015) else Surface2)
            .border(
                1.dp,
                if (cfg.enabled) Green.copy(alpha = 0.35f) else Surface1,
                RoundedCornerShape(6.dp)
            )
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Switch(
            checked = cfg.enabled,
            onCheckedChange = onEnabledChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Green,
                checkedTrackColor = Green.copy(alpha = 0.3f),
                uncheckedThumbColor = TextSecond,
                uncheckedTrackColor = Surface1
            ),
            modifier = Modifier.padding(top = 2.dp)
        )

        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            // Row 1: chat name (if known) + chips
            if (!chatName.isNullOrBlank()) {
                Text(
                    text = chatName,
                    color = TextPrimary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                MetaChip("chat ${cfg.chatId}")
                MetaChip("$messageCount msgs")
                if (lastRelayedRowId > 0L) {
                    MetaChip("last sent #$lastRelayedRowId")
                }
                if (cfg.enabled) {
                    MetaChip("→ ${cfg.department}")
                }
            }

            // Row 2: latest message preview
            if (latestMessage != null) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (cfg.enabled) Color(0xFF0E1A10) else Color(0xFF12161E))
                        .border(
                            0.5.dp,
                            if (latestMessage.decryptFailed) Red.copy(alpha = 0.3f)
                            else if (latestMessage.rawOnly) Color(0xFF3A3A55).copy(alpha = 0.3f)
                            else Surface1,
                            RoundedCornerShape(4.dp)
                        )
                        .padding(horizontal = 8.dp, vertical = 6.dp)
                ) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            MetaChip("#${latestMessage.rowId}")
                            MetaChip("u${latestMessage.userId}")
                            if (latestMessage.decryptFailed) {
                                Surface(color = Red, shape = RoundedCornerShape(2.dp)) {
                                    Text(
                                        "DECRYPT FAIL",
                                        color = Color.White,
                                        fontSize = 8.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier.padding(horizontal = 3.dp, vertical = 1.dp)
                                    )
                                }
                            } else if (latestMessage.rawOnly) {
                                Surface(color = Color(0xFF3A3A6A), shape = RoundedCornerShape(2.dp)) {
                                    Text(
                                        "RAW",
                                        color = Color(0xFFAAABDD),
                                        fontSize = 8.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier.padding(horizontal = 3.dp, vertical = 1.dp)
                                    )
                                }
                            }
                        }
                        Text(
                            latestMessage.timestamp,
                            color = TextSecond,
                            fontSize = 9.sp,
                            fontFamily = Mono
                        )
                    }
                    Spacer(Modifier.height(3.dp))
                    val previewText = when {
                        latestMessage.decryptFailed -> latestMessage.rawCiphertext
                        latestMessage.text.isBlank() -> "(empty message)"
                        else -> latestMessage.text
                    }
                    Text(
                        text = previewText,
                        color = when {
                            latestMessage.decryptFailed -> Red.copy(alpha = 0.85f)
                            latestMessage.rawOnly -> TextSecond
                            else -> TextPrimary
                        },
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            } else {
                Text(
                    "(no messages yet in this chat)",
                    color = TextSecond,
                    fontSize = 11.sp
                )
            }

            // Row 3: dept field
            OutlinedTextField(
                value = cfg.department,
                onValueChange = onDeptChange,
                label = { Text("Department (webhook slug)", fontSize = 10.sp) },
                singleLine = true,
                placeholder = { Text("e.g. demo_dep", fontSize = 11.sp, color = TextSecond) },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = TextPrimary,
                    unfocusedTextColor = TextPrimary,
                    focusedBorderColor = Accent,
                    unfocusedBorderColor = Surface1,
                    focusedLabelColor = Accent,
                    unfocusedLabelColor = TextSecond,
                    cursorColor = Accent,
                    focusedContainerColor = Color(0xFF0D0F14),
                    unfocusedContainerColor = Color(0xFF0D0F14)
                ),
                textStyle = LocalTextStyle.current.copy(fontFamily = Mono, fontSize = 12.sp),
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}