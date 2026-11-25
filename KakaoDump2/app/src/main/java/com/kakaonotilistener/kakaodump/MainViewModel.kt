package com.kakaonotilistener.kakaodump

import android.app.Application
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.kakaonotilistener.kakaodump.crypto.KakaoDecrypt
import com.kakaonotilistener.kakaodump.relay.ChatRelayConfig
import com.kakaonotilistener.kakaodump.relay.RelaySendResult
import com.kakaonotilistener.kakaodump.relay.WebhookRelay
import com.topjohnwu.superuser.Shell
import com.topjohnwu.superuser.io.SuFileInputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.isActive
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import org.json.JSONException
import org.json.JSONObject

enum class RootStatus { UNKNOWN, GRANTED, DENIED }

data class MessageRow(
    val rowId: Long,
    val chatId: Long,
    val userId: Long,
    val text: String,
    val timestamp: String,
    val decryptFailed: Boolean,
    val rawOnly: Boolean,
    val rawCiphertext: String
)

data class UiState(
    val userId: String = "",
    val defaultEncType: String = "22",
    val rootStatus: RootStatus = RootStatus.UNKNOWN,
    val isCheckingRoot: Boolean = false,
    val isDumping: Boolean = false,
    val isRelaying: Boolean = false,
    val messages: List<MessageRow> = emptyList(),
    val logLines: List<String> = emptyList(),
    val chatNames: Map<Long, String> = emptyMap(),
    // ── Relay settings ──────────────────────────────────────────────────
    val baseUrl: String = WebhookRelay.DEFAULT_BASE_URL,
    val ingestSecret: String = "",
    val chatRelayConfigs: Map<Long, ChatRelayConfig> = emptyMap(),
    val lastRelayResults: List<RelaySendResult> = emptyList(),
    // ── Auto-refresh & auto-relay ──────────────────────────────────────
    val autoRefreshEnabled: Boolean = false,
    val autoRelayEnabled: Boolean = false,
    val lastRefreshAt: Long = 0L,
    val lastRelayedRowIds: Map<Long, Long> = emptyMap()
)

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val _uiState = MutableStateFlow(UiState())
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    private val tag = "KakaoDump"
    private val tsFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
    private val relay = WebhookRelay(getApplication())
    private val autoRefreshIntervalMs = 5000L
    private var autoRefreshJob: Job? = null

    init {
        val s = relay.loadSettings()
        _uiState.update {
            it.copy(
                baseUrl = s.baseUrl,
                ingestSecret = s.ingestSecret,
                chatRelayConfigs = s.chatConfigs
            )
        }
    }

    // ─── Auto-refresh & auto-relay toggles ──────────────────────────────────

    fun setAutoRefreshEnabled(enabled: Boolean) {
        _uiState.update { it.copy(autoRefreshEnabled = enabled) }
        if (enabled) {
            startAutoRefreshLoop()
            log("Auto-refresh: ENABLED (every 5s)")
        } else {
            stopAutoRefreshLoop()
            log("Auto-refresh: disabled")
        }
    }

    fun setAutoRelayEnabled(enabled: Boolean) {
        _uiState.update { it.copy(autoRelayEnabled = enabled) }
        log("Auto-relay: " + if (enabled) "ENABLED" else "disabled")
    }

    private fun startAutoRefreshLoop() {
        if (autoRefreshJob?.isActive == true) return
        autoRefreshJob = viewModelScope.launch(Dispatchers.Default) {
            while (isActive) {
                delay(autoRefreshIntervalMs)
                val s = _uiState.value
                if (s.rootStatus != RootStatus.GRANTED) continue
                if (s.isDumping || s.isRelaying) continue
                if (s.userId.isBlank()) continue
                log("[Auto] tick — refreshing dump…")
                dumpAndDecryptInternal(autoTriggered = true)
            }
        }
    }

    private fun stopAutoRefreshLoop() {
        autoRefreshJob?.cancel()
        autoRefreshJob = null
    }

    override fun onCleared() {
        super.onCleared()
        stopAutoRefreshLoop()
    }

    private fun persistSettings() {
        val s = _uiState.value
        relay.saveSettings(
            com.kakaonotilistener.kakaodump.relay.RelaySettings(
                baseUrl = s.baseUrl,
                ingestSecret = s.ingestSecret,
                chatConfigs = s.chatRelayConfigs
            )
        )
    }

    /**
     * Extract `enc` from the `v` JSON column, matching the Python reference:
     *   try: enc_type = v_data['enc']
     *   except KeyError: enc_type = None
     * Returns null when v is null/invalid JSON or has no 'enc' key.
     */
    private fun parseEncFromV(vJson: String?): Int? {
        if (vJson == null) return null
        return try {
            val obj = JSONObject(vJson)
            if (obj.has("enc")) obj.getInt("enc") else null
        } catch (_: JSONException) { null }
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    private fun log(msg: String) {
        Log.d(tag, msg)
        _uiState.update { it.copy(logLines = it.logLines + msg) }
    }

    fun onUserIdChange(v: String) = _uiState.update { it.copy(userId = v) }
    fun onEncTypeChange(v: String) = _uiState.update { it.copy(defaultEncType = v) }

    // ─── Relay setters ──────────────────────────────────────────────────────

    fun onBaseUrlChange(v: String) {
        _uiState.update { it.copy(baseUrl = v) }
        persistSettings()
    }
    fun onIngestSecretChange(v: String) {
        _uiState.update { it.copy(ingestSecret = v) }
        persistSettings()
    }

    fun setChatEnabled(chatId: Long, enabled: Boolean) {
        _uiState.update { s ->
            val existing = s.chatRelayConfigs[chatId]
                ?: ChatRelayConfig(chatId, WebhookRelay.DEFAULT_DEPT)
            val updated = s.chatRelayConfigs + (chatId to existing.copy(enabled = enabled))
            s.copy(chatRelayConfigs = updated)
        }
        persistSettings()
    }

    fun setChatDepartment(chatId: Long, dept: String) {
        _uiState.update { s ->
            val existing = s.chatRelayConfigs[chatId]
                ?: ChatRelayConfig(chatId, dept, enabled = false)
            val updated = s.chatRelayConfigs + (chatId to existing.copy(department = dept))
            s.copy(chatRelayConfigs = updated)
        }
        persistSettings()
    }

    /** Merge any newly-discovered chat IDs into the config map (disabled by default). */
    private fun ensureChatConfigs(chatIds: Set<Long>) {
        _uiState.update { s ->
            var changed = false
            val newMap = s.chatRelayConfigs.toMutableMap()
            for (cid in chatIds) {
                if (!newMap.containsKey(cid)) {
                    newMap[cid] = ChatRelayConfig(cid, WebhookRelay.DEFAULT_DEPT, enabled = false)
                    changed = true
                }
            }
            if (changed) s.copy(chatRelayConfigs = newMap) else s
        }
        persistSettings()
    }

    // ─── Relay send ─────────────────────────────────────────────────────────

    fun relayEnabledMessages() {
        val state = _uiState.value
        if (state.messages.isEmpty()) {
            log("Relay: no messages — run Dump & Decrypt first.")
            return
        }
        val enabled = state.chatRelayConfigs.values.filter { it.enabled }
        if (enabled.isEmpty()) {
            log("Relay: no chats have relay enabled. Enable some in the Relay Config panel.")
            return
        }
        if (state.baseUrl.isBlank()) {
            log("Relay: base URL is empty.")
            return
        }

        viewModelScope.launch(Dispatchers.IO) {
            _uiState.update { it.copy(isRelaying = true, lastRelayResults = emptyList()) }
            try {
                val results = mutableListOf<RelaySendResult>()
                val updatedLastIds = state.lastRelayedRowIds.toMutableMap()
                for (cfg in enabled) {
                    val msgs = state.messages.filter {
                        it.chatId == cfg.chatId && !it.decryptFailed
                    }
                    if (msgs.isEmpty()) {
                        results.add(RelaySendResult(
                            department = cfg.department,
                            chatId = cfg.chatId,
                            count = 0, success = true,
                            response = "no decrypted messages in this chat",
                        ))
                        continue
                    }
                    log("Relay chat=${cfg.chatId} → dept=${cfg.department} (${msgs.size} msgs)…")
                    val r = relay.sendMessages(
                        baseUrl = state.baseUrl,
                        ingestSecret = state.ingestSecret,
                        department = cfg.department,
                        chatId = cfg.chatId,
                        messages = msgs
                    )
                    results.add(r)
                    if (r.success) {
                        val maxId = msgs.maxOfOrNull { it.rowId } ?: 0L
                        updatedLastIds[cfg.chatId] = maxId
                        log("  ✓ OK: inserted=${r.inserted}, duplicates=${r.duplicates}, watermark row=$maxId")
                    } else {
                        log("  ✗ FAIL: ${r.response}")
                    }
                }
                _uiState.update {
                    it.copy(
                        lastRelayResults = results,
                        lastRelayedRowIds = updatedLastIds
                    )
                }
                val ok = results.count { it.success }
                val total = results.sumOf { it.count }
                log("Relay done: $ok/${results.size} chats succeeded, $total messages processed.")
            } catch (e: Exception) {
                log("Relay exception: ${e.message}")
            } finally {
                _uiState.update { it.copy(isRelaying = false) }
            }
        }
    }

    // ─── Root check ─────────────────────────────────────────────────────────────

    fun checkRoot() {
        viewModelScope.launch(Dispatchers.IO) {
            _uiState.update { it.copy(isCheckingRoot = true) }
            try {
                // Shell.getShell() blocks until root shell is ready or fails
                val shell = Shell.getShell()
                val granted = shell.isRoot
                val status = if (granted) RootStatus.GRANTED else RootStatus.DENIED
                _uiState.update { it.copy(rootStatus = status) }
                log(if (granted) "Root: granted ✓" else "Root: denied ✗")
            } catch (e: Exception) {
                _uiState.update { it.copy(rootStatus = RootStatus.DENIED) }
                log("Root check exception: ${e.message}")
            } finally {
                _uiState.update { it.copy(isCheckingRoot = false) }
            }
        }
    }

    // ─── Dump & decrypt ─────────────────────────────────────────────────────────

    fun dumpAndDecrypt() {
        dumpAndDecryptInternal(autoTriggered = false)
    }

    private fun dumpAndDecryptInternal(autoTriggered: Boolean) {
        val state = _uiState.value
        val userId = state.userId.trim().toLongOrNull() ?: run {
            if (!autoTriggered) log("ERROR: User ID must be a valid Long integer.")
            return
        }
        val defaultEncType = state.defaultEncType.trim().toIntOrNull() ?: run {
            if (!autoTriggered) log("ERROR: Default Enc Type must be a valid integer.")
            return
        }

        viewModelScope.launch(Dispatchers.Default) {
            if (!autoTriggered) {
                _uiState.update { it.copy(isDumping = true, messages = emptyList(), logLines = emptyList()) }
            } else {
                _uiState.update { it.copy(isDumping = true) }
            }

            val filesDir = getApplication<Application>().filesDir
            val localDb  = File(filesDir, "KakaoTalk.db")

            // Temp staging area — visible from both the init namespace and the app namespace
            val tmpDb  = File("/data/local/tmp/kakaodump_KakaoTalk.db")
            val tmpWal = File("/data/local/tmp/kakaodump_KakaoTalk.db-wal")
            val tmpShm = File("/data/local/tmp/kakaodump_KakaoTalk.db-shm")

            try {
                // ─────────────────────────────────────────────────────────────
                // WHY nsenter?
                //
                // Android 9+ assigns every app its own mount namespace. A root
                // shell spawned inside an app (via libsu/Termux su) inherits that
                // restricted namespace where /data/data and /data/user/0 are NOT
                // mounted — even though the process is uid 0.
                //
                // `adb shell` works because it starts in the *init* (PID 1) mount
                // namespace, which has the full /data tree mounted.
                //
                // Solution: `nsenter --mount=/proc/1/ns/mnt` switches into PID 1's
                // mount namespace for the duration of one command, giving us the
                // same view `adb shell` has. We stage the file to /data/local/tmp
                // (world-writable, visible in both namespaces), then stream it into
                // the app's own filesDir using SuFileInputStream.
                // ─────────────────────────────────────────────────────────────

                val NS = "nsenter --mount=/proc/1/ns/mnt --"
                val kakaoPackage = "com.kakao.talk"

                // Candidate paths in priority order
                val candidateBases = listOf(
                    "/data/user/0/$kakaoPackage/databases/KakaoTalk.db",
                    "/data/data/$kakaoPackage/databases/KakaoTalk.db"
                )

                // ── Step 1: Locate file inside the init namespace ───────────
                log("Entering init mount namespace to locate KakaoTalk.db…")
                val srcBase = candidateBases.firstOrNull { path ->
                    Shell.cmd("$NS ls \"$path\" > /dev/null 2>&1").exec().isSuccess
                } ?: run {
                    log("ERROR: KakaoTalk.db not found in init namespace at any known path:")
                    candidateBases.forEach { log("  ✗ $it") }
                    log("Hint: the path might differ on your ROM — check with `adb shell ls /data/user/0/`")
                    return@launch
                }
                log("Found: $srcBase")

                // ── Step 2: Stage to /data/local/tmp via nsenter ───────────
                // /data/local/tmp is world-writable and visible from both namespaces.
                log("Staging KakaoTalk.db to /data/local/tmp…")

                val stageResult = Shell.cmd(
                    "$NS cp \"$srcBase\" \"${tmpDb.absolutePath}\" && chmod 644 \"${tmpDb.absolutePath}\""
                ).exec()
                if (!stageResult.isSuccess) {
                    val out = (stageResult.out + stageResult.err).joinToString("\n")
                    log("ERROR staging KakaoTalk.db:\n$out")
                    return@launch
                }
                log("Staged KakaoTalk.db (${tmpDb.length() / 1024} KB).")

                // WAL / SHM — optional, non-fatal
                for ((src, dst) in listOf(
                    "$srcBase-wal" to tmpWal,
                    "$srcBase-shm" to tmpShm
                )) {
                    val r = Shell.cmd(
                        "$NS cp \"$src\" \"${dst.absolutePath}\" && chmod 644 \"${dst.absolutePath}\""
                    ).exec()
                    log(if (r.isSuccess) "${dst.name} staged." else "(${dst.name} not present — this is normal)")
                }

                // ── Step 3: Stream staged files into app's filesDir ─────────
                // Now we're back in the app's namespace, but /data/local/tmp IS
                // visible here, so SuFileInputStream can read the staged files.
                log("Copying staged files into app storage…")
                try {
                    SuFileInputStream.open(tmpDb.absolutePath).use { input ->
                        localDb.outputStream().use { output -> input.copyTo(output) }
                    }
                    log("KakaoTalk.db ready (${localDb.length() / 1024} KB).")
                } catch (e: Exception) {
                    log("ERROR streaming staged DB: ${e.message}")
                    return@launch
                }
                for ((tmp, dst) in listOf(tmpWal to File("${localDb.absolutePath}-wal"),
                                          tmpShm to File("${localDb.absolutePath}-shm"))) {
                    if (tmp.exists()) {
                        try {
                            SuFileInputStream.open(tmp.absolutePath).use { i ->
                                dst.outputStream().use { o -> i.copyTo(o) }
                            }
                        } catch (_: Exception) {}
                    }
                }

                // ── Step 4: Open SQLite ─────────────────────────────────────
                log("Opening SQLite database…")
                val db = try {
                    SQLiteDatabase.openDatabase(
                        localDb.absolutePath, null, SQLiteDatabase.OPEN_READONLY
                    )
                } catch (e: Exception) {
                    log("ERROR opening SQLite: ${e.message}")
                    return@launch
                }

                // ── Step 4b: Load chat room names ───────────────────────────
                // KakaoTalk typically stores room metadata in `chat_rooms` with
                // an _id (== chat_id in chat_logs) and name/title columns. The
                // exact schema varies across versions, so probe for common
                // column names and use the best one.
                val chatNames = mutableMapOf<Long, String>()
                try {
                    val roomTables = listOf("chat_rooms", "chat_room", "rooms", "open_chat")
                    val existingTables = mutableSetOf<String>()
                    db.rawQuery(
                        "SELECT name FROM sqlite_master WHERE type='table'", null
                    ).use { tc ->
                        while (tc.moveToNext()) existingTables += tc.getString(0)
                    }
                    val roomTable = roomTables.firstOrNull { it in existingTables }

                    if (roomTable != null) {
                        val roomCols = mutableSetOf<String>()
                        db.rawQuery("PRAGMA table_info($roomTable)", null).use { pr ->
                            while (pr.moveToNext()) roomCols += pr.getString(1)
                        }
                        log("$roomTable columns: ${roomCols.sorted().joinToString()}")

                        val idCol = listOf("_id", "id", "chat_id", "room_id")
                            .firstOrNull { it in roomCols }
                        val nameCol = listOf("name", "title", "room_name", "chat_name",
                                             "display_name", "nick_name")
                            .firstOrNull { it in roomCols }
                        if (idCol != null && nameCol != null) {
                            db.rawQuery(
                                "SELECT $idCol, $nameCol FROM $roomTable", null
                            ).use { rc ->
                                while (rc.moveToNext()) {
                                    val cid = rc.getLong(0)
                                    val n = rc.getString(1)
                                    if (!n.isNullOrBlank()) chatNames[cid] = n
                                }
                            }
                            log("Loaded ${chatNames.size} chat names from $roomTable.")
                        } else {
                            log("$roomTable exists but no recognizable id/name columns " +
                                "(id=$idCol, name=$nameCol) — skipping names.")
                        }
                    } else {
                        log("No known chat room table found (tried: ${roomTables.joinToString()})")
                    }
                } catch (e: Exception) {
                    Log.w(tag, "Loading chat names failed: ${e.message}")
                    log("Chat name lookup failed (non-fatal): ${e.message}")
                }
                _uiState.update { it.copy(chatNames = chatNames) }

                // ── Step 5: Query & decrypt chat_logs ──────────────────────
                log("Querying chat_logs (latest 200 rows)…")
                val rows = mutableListOf<MessageRow>()
                var failCount = 0

                try {
                    // Probe actual columns — KakaoTalk schema varies by version.
                    // Some builds have no `enc` column; the query must be built
                    // from what really exists or SQLite returns SQLITE_ERROR.
                    val existingColumns = mutableSetOf<String>()
                    db.rawQuery("PRAGMA table_info(chat_logs)", null).use { pragma ->
                        while (pragma.moveToNext()) {
                            existingColumns += pragma.getString(1) // column 1 = name
                        }
                    }
                    log("chat_logs columns: ${existingColumns.sorted().joinToString()}")

                    val hasEnc = "enc" in existingColumns
                    val hasV   = "v"   in existingColumns

                    // enc_type resolution order (mirrors Python reference):
                    //   1. `enc` column directly
                    //   2. JSON field `enc` inside the `v` column
                    //   3. null → skip decryption for that row
                    // Note: defaultEncType from the UI is NOT used for chat_logs;
                    // the Python always uses the row's own user_id and enc from v.
                    val encSel = when {
                        hasEnc -> ", enc"
                        hasV   -> ", v"
                        else   -> ""
                    }
                    if (!hasEnc && hasV)  log("(no `enc` column — will parse enc from `v` JSON per row)")
                    if (!hasEnc && !hasV) log("(no `enc` or `v` column — all rows will be kept raw)")

                    val cursor = db.rawQuery(
                        "SELECT _id, chat_id, user_id, message, created_at$encSel " +
                        "FROM chat_logs ORDER BY _id DESC LIMIT 200",
                        null
                    )
                    val total = cursor.count
                    log("Found $total rows. Decrypting…")

                    var idx = 0; var skipped = 0
                    cursor.use { c ->
                        while (c.moveToNext()) {
                            idx++
                            val rowId     = c.getLong(0)
                            val chatId    = c.getLong(1)
                            // Use the row's own sender user_id for decryption — matches Python:
                            //   if profile_id is None: user_id = row[col_defs['user_id']]
                            val rowUser   = c.getLong(2)
                            val message   = c.getString(3) ?: ""
                            val createdAt = c.getLong(4)
                            val ts        = tsFormat.format(Date(createdAt))

                            // Resolve enc_type from the appropriate column
                            val encType: Int? = when {
                                hasEnc -> if (!c.isNull(5)) c.getInt(5) else null
                                hasV   -> parseEncFromV(if (c.isNull(5)) null else c.getString(5))
                                else   -> null
                            }

                            if (idx % 20 == 0 || idx == total) log("Decrypting row $idx/$total…")

                            if (encType == null) {
                                // Python: if contents is not None and enc_type is not None → else keep raw
                                skipped++
                                rows += MessageRow(rowId, chatId, rowUser, message, ts,
                                                   decryptFailed = false, rawOnly = true,
                                                   rawCiphertext = message)
                            } else {
                                try {
                                    val plain = KakaoDecrypt.decrypt(rowUser, encType, message)
                                    rows += MessageRow(rowId, chatId, rowUser, plain, ts,
                                                       decryptFailed = false, rawOnly = false,
                                                       rawCiphertext = message)
                                } catch (e: Exception) {
                                    failCount++
                                    Log.w(tag, "Row _id=$rowId enc=$encType user=$rowUser decrypt failed: ${e.message}")
                                    rows += MessageRow(rowId, chatId, rowUser, "", ts,
                                                       decryptFailed = true, rawOnly = false,
                                                       rawCiphertext = message)
                                }
                            }
                        }
                    }
                    if (skipped > 0) log("$skipped rows had null enc_type — kept as raw text.")
                } catch (e: Exception) {
                    log("ERROR querying chat_logs: ${e.message}")
                    db.close()
                    return@launch
                }

                db.close()
                val rawCount = rows.count { it.rawOnly }
                log("Done: ${rows.size} rows — ${rows.size - failCount - rawCount} decrypted, $rawCount raw (null enc), $failCount failed.")
                ensureChatConfigs(rows.map { it.chatId }.toSet())
                _uiState.update { it.copy(messages = rows, lastRefreshAt = System.currentTimeMillis()) }

                // ── Auto-relay new messages if enabled ────────────────────────
                val s2 = _uiState.value
                if (s2.autoRelayEnabled) {
                    log("[Auto] relay: checking for new messages in enabled chats…")
                    relayNewMessagesOnlyInternal()
                }

            } finally {
                // Clean up staging area regardless of success/failure
                Shell.cmd(
                    "rm -f \"${tmpDb.absolutePath}\" \"${tmpWal.absolutePath}\" \"${tmpShm.absolutePath}\""
                ).exec()
                _uiState.update { it.copy(isDumping = false) }
            }
        }
    }

    // ─── Relay only NEW (unsent) messages ─────────────────────────────────────

    /**
     * Public entry point — relays only messages with rowId > lastRelayedRowIds
     * for each enabled chat. Called by the "Relay New Only" UI button and
     * by the auto-refresh loop.
     */
    fun relayNewMessagesOnly() {
        viewModelScope.launch(Dispatchers.IO) {
            relayNewMessagesOnlyInternal()
        }
    }

    /**
     * Internal — runs in the current coroutine context (caller must be on IO).
     * Finds enabled chats, filters messages newer than lastRelayedRowIds[chatId],
     * sends them, then updates lastRelayedRowIds so those are not re-sent.
     */
    private suspend fun relayNewMessagesOnlyInternal() {
        val state = _uiState.value
        if (state.messages.isEmpty()) {
            if (!state.autoRefreshEnabled) log("Relay: no messages — run Dump & Decrypt first.")
            return
        }
        val enabled = state.chatRelayConfigs.values.filter { it.enabled }
        if (enabled.isEmpty()) {
            if (!state.autoRefreshEnabled) log("Relay: no chats have relay enabled. Enable some in the Relay Config panel.")
            return
        }
        if (state.baseUrl.isBlank()) {
            log("Relay: base URL is empty.")
            return
        }

        _uiState.update { it.copy(isRelaying = true) }
        try {
            val results = mutableListOf<RelaySendResult>()
            val updatedLastIds = state.lastRelayedRowIds.toMutableMap()
            var anySent = false

            for (cfg in enabled) {
                val lastSentId = state.lastRelayedRowIds[cfg.chatId] ?: 0L
                val msgs = state.messages.filter {
                    it.chatId == cfg.chatId && !it.decryptFailed && it.rowId > lastSentId
                }
                if (msgs.isEmpty()) {
                    continue
                }
                anySent = true
                log("[Auto] chat=${cfg.chatId} → dept=${cfg.department}: ${msgs.size} new msg(s) (last sent row=$lastSentId)…")
                val r = relay.sendMessages(
                    baseUrl = state.baseUrl,
                    ingestSecret = state.ingestSecret,
                    department = cfg.department,
                    chatId = cfg.chatId,
                    messages = msgs
                )
                results.add(r)
                if (r.success) {
                    val maxId = msgs.maxOfOrNull { it.rowId } ?: 0L
                    updatedLastIds[cfg.chatId] = maxId
                    log("  ✓ OK: inserted=${r.inserted}, duplicates=${r.duplicates}, new watermark row=$maxId")
                } else {
                    log("  ✗ FAIL: ${r.response}")
                }
            }

            if (!anySent) {
                // Nothing new to send — silent success (log only if not auto, to avoid noise)
                if (!state.autoRefreshEnabled) {
                    log("Relay: no new messages to send (all caught up).")
                }
            } else {
                _uiState.update {
                    it.copy(
                        lastRelayResults = results,
                        lastRelayedRowIds = updatedLastIds
                    )
                }
                val ok = results.count { it.success }
                val total = results.sumOf { it.count }
                log("Auto-relay done: $ok/${results.size} chats succeeded, $total new messages processed.")
            }
        } catch (e: Exception) {
            log("Relay exception: ${e.message}")
        } finally {
            _uiState.update { it.copy(isRelaying = false) }
        }
    }
}
