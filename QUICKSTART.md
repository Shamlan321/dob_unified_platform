# ⚡ BIC Pulse — Quick Start Guide

Welcome to **BIC Pulse**, the unified campus knowledge and assistant platform for Tongmyong University.

This guide provides everything you need to get the entire ecosystem (Web App, BIC AI, Notice Scraper, and KakaoTalk Relay) up and running.

---

## 🏗️ Architecture & How It Works

BIC Pulse connects three distinct information streams into a single source of truth:

```
[University Website]            [Department KakaoTalk]          [University Handbook]
        │                                 │                               │
  python-scrapper/                   KakaoDump2/                      tu_data.md
(Scrape & Push API)              (Decrypt & Webhook)           (Standing Campus Facts)
        │                                 │                               │
        ▼                                 ▼                               ▼
  POST /api/ingest/notices        POST /api/ingest/kakao/[dept]           │
        └───────────────┬─────────────────┘                               │
                        ▼                                                 ▼
             SQLite (data/bic_pulse.db) ──────────────────────────► tu_rag/ (Python)
                        │                                          (LlamaIndex + Gemini)
                        │                                                 ▲
                        ▼                                                 │ Subprocess Bridge
             Next.js Student Web App & Admin Dashboard ───────────────────┘
```

### 💡 Do you need to run an independent Python server for BIC AI?
**No.** The Next.js app is directly connected to the Python RAG backend via an internal Node.js child process bridge (`src/lib/ai.ts`). Whenever a question is submitted in the chat, Next.js executes `tu_rag/rag.py` as a subprocess. 

You do **not** need to run or maintain a separate FastAPI, Flask, or background Python web server. Running `npm run dev` starts the entire service.

---

## 📋 Prerequisites

1. **Node.js**: v18 or later (v20+ recommended).
2. **Python**: 3.10 or later.
3. **Google Gemini API Key**: [Get a Gemini API key](https://aistudio.google.com/app/apikey).

---

## 🚀 One-Time Setup (5 Minutes)

### Step 1: Install Node.js Dependencies
In the root directory of `bic-pulse`:
```bash
npm install
```

### Step 2: Install Global Python Packages
Install the required packages globally (no virtual environment needed):
```bash
pip install -r tu_rag/requirements.txt beautifulsoup4 requests python-dotenv
```

### Step 3: Configure Environment Variables

1. In `tu_rag/`, create a `.env` file (or copy `.env.example`):
   ```ini
   GOOGLE_API_KEY=your_gemini_api_key_here
   ```

2. *(Optional)* In the root directory, create `.env.local`:
   ```ini
   GOOGLE_API_KEY=your_gemini_api_key_here
   # Optional secret to protect ingest endpoints from unauthorized calls:
   # INGEST_SECRET=my_shared_secret
   ```

---

## 🌐 Running the Application

### 1. Start the Next.js Web App
From the root directory:
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

- **Student App**: Browse official notices, view department announcements, and chat with **BIC AI**.
- **Admin Dashboard**: Open **[http://localhost:3000/admin](http://localhost:3000/admin)** or click the **⚙️ Admin** button in the sidebar.

---

## 🤖 Initializing BIC AI (Vector Knowledge Base)

By default, BIC AI automatically synchronizes the handbook (`tu_data.md`) and database notices on the first query. To make chat responses fast immediately without cold-start indexing:

**Option A (Via Admin Dashboard)**:
1. Go to `http://localhost:3000/admin`.
2. Click the **🤖 BIC AI Index** tab.
3. Click **🔄 Rebuild / Sync Vector Index**.

**Option B (Via Terminal)**:
```bash
python tu_rag/rag.py build
```

---

## 🕷️ Notice Scraper: How to Ingest Official Notices

The scraper automatically visits `tu.ac.kr`, extracts notice lists, cleans the body text, downloads attachment URLs, and pushes them into the web app database.

### Automated Scheduling (Admin Dashboard)
1. Open `http://localhost:3000/admin` and click **🕷️ Notice Scraper**.
2. Toggle **Automatic Scraping** to `Enabled`.
3. Set your desired interval (e.g. `24` hours).
4. Click **💾 Save Schedule Settings**. The server will automatically trigger scraper cycles.

### Immediate Scraper Execution
Click **⚡ Run Scraper Now** in the Admin Dashboard to trigger an immediate scrape run with real-time log output streaming directly in your browser.

### Manual Terminal Run (Alternative)
```bash
python python-scrapper/run_pipeline.py
```
To run the scraper as a persistent standalone background daemon:
```bash
python python-scrapper/run_pipeline.py --daemon --interval-hours 24
```

---

## 💬 KakaoTalk Relay: Ingesting Department Messages

To relay department notices from KakaoTalk chats:

### 1. Create a Department Webhook
1. In the Admin Dashboard (`/admin`), click **💬 Kakao Webhooks**.
2. Under **Create New Department Webhook**, enter the department name (e.g. `Artificial Intelligence`).
3. Click **Create Department Channel**.
4. Click **📋 Copy Webhook URL** next to the newly created department:
   ```
   http://<your-pc-ip>:3000/api/ingest/kakao/artificial_intelligence
   ```

### 2. Configure KakaoDump2 (Android App)
1. Install and open the **KakaoDump2** app on your Android device/emulator.
2. Under **Relay Config**:
   - Set **Web Server Base URL**: 
     - Android Emulator: `http://10.0.2.2:3000`
     - Physical Phone on same Wi-Fi: `http://<YOUR_PC_LAN_IP>:3000`
   - In the chat list, set the department slug (e.g. `artificial_intelligence`) for the target chat.
   - Switch the toggle **ON** (turns green).
3. Tap **Relay Enabled Chats to Server**.

### 3. Testing Kakao Ingest Without a Phone
You can send test messages directly via curl or PowerShell:
```bash
curl -X POST http://localhost:3000/api/ingest/kakao/demo_dep \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "row_id": 101,
        "chat_id": 999,
        "sender_user_id": 888,
        "text": "Reminder: Midterm exam project submission is due this Friday by 5 PM.",
        "timestamp": "2026-09-12 14:00:00"
      }
    ]
  }'
```

---

## 🗂️ Content Management: Deleting Notices & Announcements

Need to remove outdated notices or incorrect Kakao messages?
1. Open the Admin Dashboard at `http://localhost:3000/admin`.
2. Click **🗂️ Content Manager**.
3. Filter by **University Notices** or **Kakao Announcements**, or search by keyword.
4. Click **🗑️ Delete** on any item to permanently remove it.
5. Deleted items are automatically excluded from BIC AI retrieval on the next query or re-sync.

---

## 🛠️ Verification & Sanity Checks

Run the project build and linter to confirm all TypeScript and Next.js routes compile cleanly:

```bash
npm run lint
npm run build
```

---

## ❓ FAQ & Troubleshooting

- **Q: "AI service is temporarily unavailable" appears in chat.**
  - Check that `GOOGLE_API_KEY` is present in `tu_rag/.env`.
  - Ensure global Python packages are installed: `pip install -r tu_rag/requirements.txt`.
  - Check the console or click **🤖 BIC AI Index** in the Admin Dashboard to inspect build logs.

- **Q: Kakao messages aren't showing up for a signed-in student.**
  - Students only see announcements for their selected department. Check that the student's department in their Profile matches the department slug/name where messages were ingested.

- **Q: Scraper says `notices.db not found`.**
  - Running `python-scrapper/run_pipeline.py` or clicking **Run Scraper Now** in the Admin Dashboard automatically creates `notices.db` and runs all stages in order.
