# KakaoTalk Announcement Relay — System Guide

Two projects, one data flow (Source 2 of 3).

```
KakaoDump2/                            →         bic-pulse/
(Android: DB extract → decrypt →       POST JSON   (Next.js: webhook → DB →
 relay to webhook per chat)                         bare announcement pages)
```

---

## 1. Architecture Overview

The system routes *decrypted* KakaoTalk group-chat messages from a rooted Android
device into the BIC Pulse web app's **unified `content_items` table**, keyed by
department. The department is chosen per-chat in the Android app, and the
webhook URL encodes the department slug so no extra body field is required.

Every message receives:

```
source        = 'kakao_announcement'
is_gated      = 1                            (department-gated, per the project spec)
department    = <slug from per-chat config>
source_url    = 'kakao://<chat_id>/<row_id>' (UNIQUE dedup key — re-imports are safe)
```

The title is the first ~80 chars of the message (Kakao messages have no subject
line). Extras are stored in the `extra` JSON blob:

```json
{
  "chat_id": 12345,
  "row_id": 678,
  "sender_user_id": 901,
  "original_ts": "2026-09-09 14:22:10"
}
```

---

## 2. Web App Endpoints

| Method | URL | Purpose |
|---|---|---|
| `POST` | `/api/ingest/kakao/<department>` | **Webhook ingest.** Receives a batch of decrypted messages for one department. |
| `GET`  | `/api/announcements/<department>?page=1&limit=20` | JSON list of announcements for a department. |
| `GET`  | `/announcements` | Landing page listing every known department channel (starts with `demo_dep`). |
| `GET`  | `/announcements/<department>` | Bare list page for a single department channel (walking skeleton UI). |

### Webhook Payload

```
POST /api/ingest/kakao/demo_dep
Content-Type: application/json
x-ingest-secret: <INGEST_SECRET from .env.local>  (optional, enabled when env is set)
```

```json
{
  "upsert": false,
  "messages": [
    {
      "row_id": 9981,
      "chat_id": 100234,
      "sender_user_id": 550123,
      "text": "4학년 졸업작품 발표 일정은 11월 14일입니다.",
      "timestamp": "2026-09-09 13:40:02"
    }
  ]
}
```

Response mirrors the notices ingest format:

```json
{
  "total": 1,
  "inserted": 1,
  "duplicates": 0,
  "results": [{ "url": "kakao://100234/9981", "status": "created" }]
}
```

Auth works the same as `/api/ingest/notices`: if `INGEST_SECRET` is set in the
web app's `.env.local`, the caller must send it as the `x-ingest-secret` header,
otherwise the endpoint returns HTTP 401.

---

## 3. Android App (KakaoDump2) Usage

New **Relay Config** panel sits between the Dump button and the Messages/Log
panes. Use it like this:

1. Enter credentials, tap **Check Root Access**, then **Dump & Decrypt Database**
   exactly as before.
2. After decryption, every unique `chat_id` found in the latest 200 rows auto-
   appears as a row in **Relay Config**.
3. For each chat you want to relay:
   - Set **Department (webhook slug)** (e.g. `demo_dep` for now — this becomes
     the department in the web app DB and appears in the URL path).
   - Flip the **Switch** ON (row goes green → enabled).
4. Enter **Web Server Base URL**:
   - Android emulator → `http://10.0.2.2:3000`  (the built-in alias to `localhost:3000` on your dev machine)
   - Real device (same Wi-Fi) → `http://<your-pc-lan-ip>:3000`
   - Deployed → `https://your-domain.com`
5. Paste the **Ingest Secret** only if you set `INGEST_SECRET` on the server.
6. Tap **Relay Enabled Chats to Server**.
7. A per-chat result line appears below with inserted/duplicate counts; check
   the Log pane for detail.

All settings (base URL, secret, per-chat enabled toggle + department) are
auto-saved to `SharedPreferences` keyed `kakaodump_relay` — they persist across
app restarts so you only set them up once.

---

## 4. "Mock Data" Test Without Real Kakao Data

You don't need a rooted phone with real KakaoTalk installed to exercise the
pipeline. POST test data to the webhook directly:

```bash
curl -X POST http://localhost:3000/api/ingest/kakao/demo_dep \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "row_id": 1,
        "chat_id": 4242,
        "sender_user_id": 7000,
        "text": "[demo_dep] Hello from Kakao! 첫 공지사항입니다. 과제 제출 기한은 금요일까지입니다.",
        "timestamp": "2026-09-09 09:00:00"
      },
      {
        "row_id": 2,
        "chat_id": 4242,
        "sender_user_id": 7001,
        "text": "Reminder — department workshop at 3pm in room B308.",
        "timestamp": "2026-09-09 10:15:22"
      }
    ]
  }'
```

Then visit:
- <http://localhost:3000/announcements> → list of departments (should show `demo_dep` with 2 messages)
- <http://localhost:3000/announcements/demo_dep> → paginated list of the two test messages

---

## 5. Where the Data Lives

| Location | What |
|---|---|
| `data/bic_pulse.db` table `content_items` | All ingested content — both `bic_notices` rows (Source 1) and `kakao_announcement` rows (Source 2). Filter by `source` + `department`. |
| Android `SharedPreferences` (`kakaodump_relay`) | Relay settings: base URL, ingest secret, and per-chat enabled/department. |
| Android internal files `KakaoTalk.db` | Staging copy of the KakaoTalk SQLite DB used only during a dump-decrypt run. The app never relays the raw DB — only the decrypted plaintext after it passes through `KakaoDecrypt`. |

---

## 6. Files Touched (Reference)

### Web app (`bic-pulse/`)
- `src/lib/schema.ts` — added `IngestKakaoMessage`, `IngestKakaoBatch`, `AnnouncementsListResponse`
- `src/lib/db.ts` — no changes (existing `content_items` schema already supports `kakao_announcement` source + `department` + `is_gated`)
- `src/app/api/ingest/kakao/[department]/route.ts` — **new** webhook endpoint
- `src/app/api/announcements/[department]/route.ts` — **new** JSON API list endpoint
- `src/app/announcements/page.tsx` — **new** department-channel index page
- `src/app/announcements/[department]/page.tsx` — **new** per-department listing
- `src/components/AnnouncementCard.tsx` — **new** card component (walking skeleton)
- `src/app/layout.tsx` — Announcements nav link enabled
- `src/app/page.tsx` — home-page Announcements card links to `/announcements`

### Android app (`KakaoDump2/`)
- `app/src/main/AndroidManifest.xml` — `INTERNET` + `ACCESS_NETWORK_STATE` permissions + `usesCleartextTraffic` for `http://10.0.2.2:3000`
- `app/src/main/java/.../relay/WebhookRelay.kt` — **new** HTTP POST helper + SharedPreferences persistence
- `app/src/main/java/.../MainViewModel.kt` — extended `UiState` (relay fields), init load/save, `ensureChatConfigs`, `relayEnabledMessages`
- `app/src/main/java/.../MainActivity.kt` — added Relay Config panel (URL/secret inputs, per-chat rows with switch+dept, relay action button, last-run results), new `ChatRelayRow` composable
