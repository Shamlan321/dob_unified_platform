package com.kakaonotilistener.kakaodump.relay

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// ─── Data models ──────────────────────────────────────────────────────────────

data class ChatRelayConfig(
    val chatId: Long,
    val department: String,
    val enabled: Boolean = false
)

data class RelaySettings(
    val baseUrl: String,
    val ingestSecret: String,
    val chatConfigs: Map<Long, ChatRelayConfig>
)

data class RelaySendResult(
    val department: String,
    val chatId: Long,
    val count: Int,
    val success: Boolean,
    val response: String,
    val inserted: Int = 0,
    val duplicates: Int = 0
)

// ─── HTTP / JSON helpers ─────────────────────────────────────────────────────

class WebhookRelay(private val context: Context) {

    private val tag = "KakaoDumpRelay"
    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    companion object {
        private const val PREFS_NAME = "kakaodump_relay"
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_INGEST_SECRET = "ingest_secret"
        private const val KEY_CHAT_CONFIGS = "chat_configs"
        const val DEFAULT_DEPT = "demo_dep"
        const val DEFAULT_BASE_URL = "http://10.0.2.2:3000"
    }

    // ─── Persistence ─────────────────────────────────────────────────────────

    fun loadSettings(): RelaySettings {
        val baseUrl = prefs.getString(KEY_BASE_URL, DEFAULT_BASE_URL) ?: DEFAULT_BASE_URL
        val secret  = prefs.getString(KEY_INGEST_SECRET, "") ?: ""
        val configsJson = prefs.getString(KEY_CHAT_CONFIGS, "{}") ?: "{}"

        val configs = mutableMapOf<Long, ChatRelayConfig>()
        try {
            val obj = JSONObject(configsJson)
            val keys = obj.keys()
            while (keys.hasNext()) {
                val chatIdStr = keys.next()
                val inner = obj.getJSONObject(chatIdStr)
                val chatId = chatIdStr.toLongOrNull() ?: continue
                configs[chatId] = ChatRelayConfig(
                    chatId = chatId,
                    department = inner.optString("department", DEFAULT_DEPT) ?: DEFAULT_DEPT,
                    enabled = inner.optBoolean("enabled", false)
                )
            }
        } catch (_: Exception) {}

        return RelaySettings(baseUrl, secret, configs)
    }

    fun saveSettings(settings: RelaySettings) {
        val editor = prefs.edit()
        editor.putString(KEY_BASE_URL, settings.baseUrl)
        editor.putString(KEY_INGEST_SECRET, settings.ingestSecret)

        val obj = JSONObject()
        for ((chatId, cfg) in settings.chatConfigs) {
            val inner = JSONObject()
            inner.put("department", cfg.department)
            inner.put("enabled", cfg.enabled)
            obj.put(chatId.toString(), inner)
        }
        editor.putString(KEY_CHAT_CONFIGS, obj.toString())
        editor.apply()
    }

    // ─── HTTP send ──────────────────────────────────────────────────────────

    /**
     * POST one chat's decrypted messages to
     *   <baseUrl>/api/ingest/kakao/<department>
     *
     * Returns a result summary (JSON parsed when possible).
     */
    fun sendMessages(
        baseUrl: String,
        ingestSecret: String,
        department: String,
        chatId: Long,
        messages: List<com.kakaonotilistener.kakaodump.MessageRow>
    ): RelaySendResult {
        if (messages.isEmpty()) {
            return RelaySendResult(department, chatId, 0, true, "no messages")
        }

        val cleanBase = baseUrl.trimEnd('/')
        val endpoint = "$cleanBase/api/ingest/kakao/${java.net.URLEncoder.encode(department, "UTF-8")}"

        val payloadArr = JSONArray()
        for (m in messages) {
            val obj = JSONObject()
            obj.put("row_id", m.rowId)
            obj.put("chat_id", m.chatId)
            obj.put("sender_user_id", m.userId)
            obj.put("text", m.text)
            obj.put("timestamp", m.timestamp)
            payloadArr.put(obj)
        }
        val bodyObj = JSONObject()
        bodyObj.put("messages", payloadArr)
        val bodyStr = bodyObj.toString()

        var conn: HttpURLConnection? = null
        return try {
            val url = URL(endpoint)
            conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.setRequestProperty("Accept", "application/json")
            if (ingestSecret.isNotBlank()) {
                conn.setRequestProperty("x-ingest-secret", ingestSecret)
            }
            conn.connectTimeout = 10_000
            conn.readTimeout = 30_000
            conn.doOutput = true

            conn.outputStream.use { os -> os.write(bodyStr.toByteArray(Charsets.UTF_8)) }

            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""

            var inserted = 0
            var duplicates = 0
            try {
                val resp = JSONObject(text)
                inserted = resp.optInt("inserted", 0)
                duplicates = resp.optInt("duplicates", 0)
            } catch (_: Exception) {}

            Log.d(tag, "send chat=$chatId dept=$department n=${messages.size} code=$code inserted=$inserted dups=$duplicates")

            RelaySendResult(
                department = department,
                chatId = chatId,
                count = messages.size,
                success = code in 200..299,
                response = text.ifBlank { "HTTP $code" },
                inserted = inserted,
                duplicates = duplicates
            )
        } catch (e: Exception) {
            Log.e(tag, "send chat=$chatId failed: ${e.message}", e)
            RelaySendResult(
                department = department,
                chatId = chatId,
                count = messages.size,
                success = false,
                response = e.message ?: "Unknown error"
            )
        } finally {
            try { conn?.disconnect() } catch (_: Exception) {}
        }
    }
}
