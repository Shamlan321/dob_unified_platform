# BIC Pulse: Unified University Intelligence Platform
## Technical Architecture & Executive Pitch Document

---

## 1. Executive Summary: The University Information Fragmentation Problem

In contemporary higher education—particularly international colleges like the **Busan International College (BIC) at Tongmyong University**—critical student information is fractured across three isolated silos that do not talk to each other:

1. **The Static Web Portal (`tu.ac.kr`)**: Contains standing institutional facts (dormitory regulations, visa guidelines, academic graduation credits, college contacts). This information updates infrequently but forms the institutional baseline.
2. **The Dynamic Notice Board**: Contains time-sensitive official posts (course registration windows, scholarship applications, tuition deadlines, grade revision schedules). Crucial details (like PDF guides or date grids) are often buried in attachments.
3. **Department KakaoTalk Chatrooms**: Where real-time university life actually happens. Department chairs, teaching assistants, and student reps communicate urgent schedule modifications, room changes, and department-specific announcements via closed KakaoTalk group chats that have no public RSS or web feed.

### The Consequences
* Students miss urgent deadlines due to notification fatigue and lost chat history.
* International students struggle with language barriers across dense Korean notices and unstructured Kakao chats.
* Traditional AI assistants (like ChatGPT) fail because they lack access to internal closed chats, real-time notices, and university-specific regulations.

### The BIC Pulse Solution
**BIC Pulse** solves this by unifying all three channels into a **single, secure, real-time intelligence platform**. It combines automated web scraping, mobile chat decryption relays, an in-memory high-speed Retrieval-Augmented Generation (RAG) engine (**BIC AI**), and an administrative control plane.

```
┌─────────────────────────┐   ┌───────────────────────────┐   ┌────────────────────────────┐
│   Static Handbook       │   │  Official Web Scraper     │   │  KakaoDump2 Android Relay  │
│   (tu_data.md)          │   │  (Python + BeautifulSoup) │   │  (Rooted SQLite Decrypt)   │
│   Standing TU Facts     │   │  Public Notices & Files   │   │  Gated Dept Chat Messages  │
└────────────┬────────────┘   └─────────────┬─────────────┘   └─────────────┬──────────────┘
             │                              │                               │
             ▼                              ▼                               ▼
    [ Markdown Parser ]             [ Webhook Ingestion ]           [ Dept-Scoped Webhook ]
             │                              │                               │
             └──────────────────────┬───────┴───────────────────────────────┘
                                    ▼
                 ┌─────────────────────────────────────┐
                 │    Unified SQLite Knowledge Store   │
                 │   (content_items + departments)     │
                 └──────────────────┬──────────────────┘
                                    │
                     ┌──────────────┴──────────────┐
                     ▼                             ▼
        ┌─────────────────────────┐   ┌─────────────────────────┐
        │   FastAPI Vector Store  │   │   Next.js Web Portal    │
        │   In-Memory RAG Engine  │   │   Neo-Brutalist UI      │
        │   (Gemini + LlamaIndex) │   │   (Desktop & Mobile)    │
        └────────────┬────────────┘   └────────────┬────────────┘
                     │                             │
                     └──────────────┬──────────────┘
                                    ▼
                         ┌──────────────────────┐
                         │   Student & Staff    │
                         │   Query & Insights   │
                         └──────────────────────┘
```

---

## 2. Core Pillars & How Each Challenge Is Solved

### Pillar 1: Automated Web Scraper Pipeline (`python-scrapper`)
* **The Challenge**: The university notice board has no open REST API. It publishes notices with server-side pagination, embedded tables, and downloadable PDF/HWP attachments. Manual monitoring is error-prone.
* **The Solution**: A fault-tolerant 3-stage scraping pipeline engineered in Python:
  1. **Stage 1 (`scrape_notice.py`)**: Crawls the notice list pages via `requests` and `BeautifulSoup4`. Extracts notice IDs, titles, dates, view counts, and URLs.
  2. **Stage 2 (`scrape_details.py`)**: Traverses each individual notice URL to scrape full body content, embedded image references, and crucially, **all file attachment metadata** (names and direct download links).
  3. **Stage 3 (`push_to_api.py`)**: Batches the extracted data and pushes it to `/api/ingest/notices` with SHA-256/Secret header authentication.
* **Idempotency & Deduplication**: Every notice is keyed by its canonical `source_url`. The database uses `INSERT OR IGNORE`, ensuring zero duplicate records or redundant vector re-embeddings.
* **Autonomous Scheduling**: Fully controllable from the Admin Dashboard. Can run as an autonomous background daemon on a configurable interval (e.g., every 6 hours) or triggered on-demand with live real-time console streaming.

---

### Pillar 2: KakaoDump2 — Closed Mobile Chat Extraction
* **The Challenge**: KakaoTalk is a closed, proprietary messaging ecosystem. Department announcements are distributed across private group chats with no public webhooks or export APIs.
* **The Solution**: A dedicated native Android utility (**KakaoDump2**) operating on an administrative Android device with root access:
  1. **SQLite Database Access**: Leverages root permissions to access KakaoTalk's protected app sandbox (`/data/data/com.kakao.talk/databases/KakaoTalk.db`).
  2. **Cryptographic Decryption**: Messages in KakaoTalk's local SQLite store are encrypted. KakaoDump2 uses `KakaoDecrypt` (AES-128-CBC with device-specific key derivation) to decrypt message payloads in memory.
  3. **Per-Chat Department Mapping**: The app's **Relay Config UI** displays active group chats. An admin maps each chat ID to a specific university department slug (e.g., `computer_engineering`, `business_admin`).
  4. **Webhook Relay**: Enabled chats are batched and dispatched via HTTP POST to `/api/ingest/kakao/<department_slug>`.
* **Privacy & Access Control (Gating)**:
  * Messages ingested from KakaoTalk are flagged with `is_gated = 1`.
  * The web portal and BIC AI enforce strict department isolation: a student in Business Administration can never see or search Computer Engineering Kakao messages.

---

### Pillar 3: BIC AI — High-Speed, In-Memory RAG Architecture
* **The Challenge**: Traditional RAG prototypes execute Python CLI scripts on every user query. Cold-starting Python, importing PyTorch, `llama_index`, and Gemini SDKs, and loading hundreds of SQLite documents took **14+ seconds per question**—unacceptable for student UX. Furthermore, LLMs frequently hallucinate outdated schedules.
* **The Solution**: A persistent, hot in-memory FastAPI server (`tu_rag/server.py`) with hybrid context synchronization:
  1. **Sub-4-Second Response Time**: The FastAPI daemon runs on `127.0.0.1:8001`, keeping the `VectorStoreIndex`, Google Gemini client, and embedding models hot in RAM. Per-query processing dropped from **14.45s to 3.59s**.
  2. **Fail-Safe Self-Healing Bridge**: Next.js (`src/lib/ai.ts`) queries the persistent HTTP server first. If the daemon is stopped, Next.js auto-spawns it in the background while transparently servicing the immediate request via a fallback CLI bridge.

#### How BIC AI Handles Multi-Layered Context
BIC AI synthesizes three distinct knowledge tiers using a purpose-built hierarchy:

| Priority | Layer | Source | Update Frequency | Purpose |
|:---:|:---|:---|:---|:---|
| **P1 (Highest)** | **Live Notices & Attachments** | Scraped SQLite (`bic_notices`) | Real-time / Daily | Deadlines, registration schedules, official forms |
| **P2 (Gated)** | **Department Chats** | Kakao SQLite (`kakao_announcement`) | Real-time / Hourly | Urgent class changes, room updates, professor memos |
| **P3 (Baseline)** | **University Handbook** | Markdown (`tu_data.md`) | Static / Semester | Degree requirements, office contacts, campus rules |

* **Context Injection of Attachments**: Scraped notices frequently state: *"Check the attached manual for course dates."* In BIC Pulse, the vector node includes attachment names and links in its metadata. The AI assistant extracts these and renders **direct PDF download buttons** directly in the chat interface.
* **Conflict Resolution**: If the static handbook and a recent notice disagree on a deadline, the RAG prompt instructs Gemini to trust the newer notice, cite the publication date, and provide the official source URL.

---

### Pillar 4: The Web Application & Admin Control Plane
* **Frontend Architecture**: Built on **Next.js 16 (Turbopack)**, **React 19**, and **TypeScript**.
* **Neo-Brutalist Visual Identity**: Designed for high clarity and functional utility. Uses thick high-contrast borders (`2.5px solid #111`), tactile drop shadows (`4px 4px 0 #111`), high-visibility status tags (yellow for notices, blue for departments), and strict typographic scale (Space Grotesk + Noto Sans KR).
* **Responsive Multi-Form Factor**:
  * **Desktop**: Full navigation sidebar, quick AI jumpbar, split-pane dashboard, and detailed citation panels.
  * **Mobile**: Bottom tab bar navigation, touch-optimized cards, safe-area keyboard handling, and responsive conversational view.
* **Centralized Admin Dashboard (`/admin`)**:
  * **System Telemetry**: Real-time KPI cards tracking notices, announcements, departments, vector index documents, and scraper health.
  * **Scraper Controls**: Automation toggles, interval sliders, manual trigger with streaming terminal logs.
  * **Kakao Webhook Hub**: Add new department slugs, generate copy-ready webhook endpoints for KakaoDump2, and monitor message intake.
  * **Content Management**: Global search and 1-click deletion of notices and announcements with automatic vector sync.
  * **Vector Store Sync**: Re-index or synchronize new content on-demand without server restarts.

---

## 3. Technology Stack Breakdown

| Component | Technology | Rationale & Architectural Advantage |
|:---|:---|:---|
| **Web Frontend** | **Next.js 16 (App Router)** + **React 19** | Ultra-fast Turbopack compilation, React Server Components for SEO, server-side data fetching. |
| **Styling** | **Vanilla CSS Neo-Brutalism** | Zero bundle overhead, crisp aesthetic, immediate visual hierarchy, native CSS variables. |
| **Database** | **SQLite3** via `better-sqlite3` | Zero-latency embedded database, synchronous high-speed reads/writes, zero external container bloat. |
| **Mobile Scraper/Relay** | **Kotlin / Android SDK (Rooted)** | Direct OS-level access to KakaoTalk sandbox, AES cryptographic decryption, autonomous webhook forwarding. |
| **Web Scraper** | **Python 3.12**, `BeautifulSoup4`, `requests` | Robust HTML DOM parsing, resilient error backoff, lightweight headless execution. |
| **AI Vector Store** | **LlamaIndex** + **Gemini Embeddings** | Advanced document chunking (`MarkdownNodeParser`), similarity top-k retrieval, native metadata filtering. |
| **Large Language Model** | **Google Gemini 2.5 Flash** | Industry-leading context window, high reasoning speed, native multilingual (Korean/English) fluency. |
| **Persistent AI Server** | **FastAPI** + **Uvicorn** | In-memory index caching, non-blocking asynchronous event loop, sub-4s question answering. |

---

## 4. End-to-End Data Flow: A Real-World Example

```
Scenario: "When is the Course Registration period for Fall 2026?"
```

```
1. Student Enters Prompt:
   Student asks: "When is the course registration period?" via the BIC AI chat bar.
   │
2. Next.js API Layer (/api/ai/chat):
   Passes question + student's department ("computer_engineering") to the in-memory AI server.
   │
3. In-Memory Vector Search (tu_rag/server.py):
   • Embeds question via text-embedding-004.
   • Scans in-memory vector index (102 docs, 126 nodes).
   • Retrieves top matching nodes:
     - Notice #146077: "[Important Notice] Course Registration Guide 2026-1st Semester"
     - Attached files: ["수강신청 장바구니 매뉴얼.pdf", "how to register for courses_manual.pdf"]
     - Gated Kakao message: "Prof. Kim: CE registration opens at 10 AM on Monday."
   │
4. Prompt Assembly & Gemini Synthesis:
   • Combines context with strict instructions: prioritize newest notice, mention attachments.
   • Gemini 2.5 Flash generates a concise answer with citation markers in ~2.8 seconds.
   │
5. Rich UI Rendering:
   • Chat displays the answer with a word-drip streaming animation.
   • Renders prominent Direct PDF Download Pills with one-click download URLs.
   • Displays collapsible "📚 Sources (3)" toggle with links to the official tu.ac.kr notice.
   • Latency badge confirms: "⚡ 3.6s".
```

---

## 5. Security, Privacy & Data Integrity

1. **Department Isolation**:
   * KakaoTalk messages are private to department members.
   * Ingestion assigns a strict `department` slug and sets `is_gated = 1`.
   * Unauthenticated or out-of-department users cannot query or view gated announcements.
2. **Deterministic Deduplication**:
   * Scraped notices use canonical HTTP URLs as unique keys.
   * Kakao messages use `kakao://<chat_id>/<row_id>` as unique keys.
   * Running scrapers or dumps repeatedly is 100% idempotent—zero data corruption.
3. **Graceful Degradation**:
   * If the in-memory AI server stops, Next.js falls back to CLI execution automatically.
   * If the Gemini API hits a rate limit, exponential backoff (15s–60s) prevents crashing.
   * When notices or announcements are deleted in Admin, the vector index automatically removes them on next sync.

---

## 6. Presentation Slide Guide: The 60-Second Elevator Pitch

Use these five bullet points for a slide deck or executive overview:

1. **The Problem**: Campus information is fragmented across static websites, dynamic notice boards, and closed KakaoTalk group chats, leading to missed deadlines and confused students.
2. **The Innovation**: BIC Pulse unifies all three sources into one intelligent repository using automated web scrapers and a proprietary Android KakaoTalk decryption relay.
3. **The AI Assistant (BIC AI)**: Powered by Google Gemini 2.5 Flash and LlamaIndex, answering complex questions in under 4 seconds with direct PDF manual download links and verifiable sources.
4. **The User Experience**: A high-contrast Neo-Brutalist web and mobile portal providing real-time notice feeds, department-gated announcements, and conversational search.
5. **Administrative Power**: A single centralized dashboard to schedule scrapers, generate department webhooks, manage content, and sync the AI knowledge base.

---
*Document prepared for BIC Pulse Stakeholders, Faculty Evaluation & Technical Review.*
