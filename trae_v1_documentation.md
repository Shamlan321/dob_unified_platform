Main Next.js App Architecture
The app lives at c:\Users\l\Documents\Dev\bic-pulse\ and uses Next.js 16.3.4 App Router with React 19, TypeScript, and better-sqlite3 for the database.

Tech Stack
package.json — Dependencies: next:16.3.4, react:19.2.8, better-sqlite3:^13.0.3, nanoid:^6.0.1
No ORM — raw SQL via better-sqlite3
No user auth backend — client-side localStorage only (explicitly out of scope per spec)
Directory Structure



src/
├── app/
│   ├── layout.tsx              # Root layout: Google Fonts (Space Grotesk + Noto Sans KR), metadata
│   ├── globals.css             # ✅ Full neo-brutalist design system (Task 3 done)
│   ├── page.tsx                # ✅ Main app: Landing + App shell + Signup (Tasks 4,5,6 done)
│   ├── notices/page.tsx        # (legacy walking skeleton page — page.tsx now handles it)
│   ├── announcements/page.tsx  # (legacy dept index page)
│   └── api/
│       ├── notices/route.ts              # GET paginated bic_notices list
│       ├── notices/[id]/route.ts         # GET single notice
│       ├── announcements/[dept]/route.ts  # GET kakao_announcements by dept
│       ├── ingest/notices/route.ts        # POST scraped notices (from python-scrapper/)
│       ├── ingest/kakao/[dept]/route.ts   # POST Kakao messages (from KakaoDump2 Android app)
│       └── ai/chat/route.ts               # ✅ POST → Python RAG bridge (Task 2 done)
├── components/
│   ├── NoticeCard.tsx          # ✅ Neo-brutalist styled (Task 7 done)
│   └── AnnouncementCard.tsx    # ✅ Neo-brutalist styled (Task 7 done)
└── lib/
    ├── db.ts        # SQLite singleton + content_items table schema
    ├── schema.ts    # TypeScript types: ContentItem, Ingest* payloads, API responses
    └── ai.ts        # ✅ Python subprocess bridge: runRagJson() (Task 2 done)

data/bic_pulse.db    # SQLite DB with unified content_items table
python-scrapper/     # Standalone scraper (scrape_notice.py, scrape_details.py) → feeds /api/ingest/notices
KakaoDump2/          # Android Kotlin app → decrypts Kakao DB → POSTs to /api/ingest/kakao/[dept]
tu_rag/              # Standalone LlamaIndex + Gemini RAG system (Python venv)
bic-pulse-app.html   # Design reference HTML (neo-brutalist visual system)
tu_data.md           # Markdown source for RAG (university info)
Unified Database Schema
All content (notices + Kakao announcements) lives in one table in db.ts:

Column	Purpose
id	nanoid PK
source	'bic_notices' | 'kakao_announcement' | 'university_info'
is_gated	0=public, 1=dept-gated (Kakao)
department	Only for kakao_announcement (e.g. demo_dep, Computer Engineering)
title / raw_text	Content
source_url	UNIQUE dedup key (http://... for notices, kakao://<chat_id>/<row_id> for Kakao)
published_at / scraped_at	ISO dates
extra	JSON blob (notice_number, views, chat_id, row_id, sender_user_id)
2. RAG AI Service: How It Works
The AI system is a Python subprocess bridge — the Next.js API spawns Python as a child process. This avoids rewriting LlamaIndex in TypeScript.

Architecture Flow



Frontend page.tsx (ask() function)
  ↓ POST JSON {question, department?}
/api/ai/chat/route.ts
  ↓ calls runRagJson()
lib/ai.ts
  ↓ spawns child_process:  tu_rag/.venv/Scripts/python.exe  tu_rag/rag.py --json ask "question"
tu_rag/rag.py (Python)
  ↓ load_or_build_index() → tu_rag/storage/
  ↓ LlamaIndex + Gemini (models/gemini-embedding-001 + gemini-2.5-flash)
  ↓ query tu_data.md vector chunks
  ↓ prints JSON to stdout
lib/ai.ts
  ↓ parses stdout JSON
route.ts
  ↓ returns {answer, sources[]} to page.tsx
page.tsx
  ↓ word-drip streams answer (45ms/word) + renders cite chips
Key Files in Detail
tu_rag/rag.py (Python RAG core):

Lines 19-27: Windows UTF-8 stdout fix (reconfigure encoding to prevent UnicodeEncodeError)
Lines 56-99: configure_models() — dual-backend init: tries new GoogleGenAI SDK first, falls back to deprecated Gemini class
Lines 102-148: build_index() — MarkdownNodeParser splits tu_data.md into markdown-aware chunks, embeds with models/gemini-embedding-001, persists to tu_rag/storage/
Lines 177-212: ask() — CLI mode, returns formatted string with 💬/📚 emoji
Lines 214-243: ask_json() — JSON mode (Task 1). Returns {answer, sources: [{label, preview}]} for Next.js bridge
Lines 272-318: __main__ — --json flag toggles JSON mode on stdout (logs go to stderr instead)
src/lib/ai.ts (Node ↔ Python bridge):

getPythonBin() (lines 19-25): Windows path detection — .venv\Scripts\python.exe on Windows, .venv/bin/python on Unix
runRagJson(question, department) (lines 27-100): spawns subprocess with:
PYTHONIOENCODING=utf-8, PYTHONUNBUFFERED=1
60-second timeout with SIGTERM kill
Parses stdout as JSON, rejects on non-zero exit or parse error
⚠️ NOTE: department param is accepted but does void department (line 28) — it's NOT used yet. RAG only queries tu_data.md, not live DB announcements.
src/app/api/ai/chat/route.ts (API endpoint):

Validates question non-empty → 400 if missing
Calls runRagJson(), returns {answer, sources} on success
On failure: returns HTTP 200 with {error} (friendly message, stack only in dev mode) — never 500 crash to client
src/app/page.tsx (Chat UI — ask() function):

Lines 355-424: Optimistic UI — adds user + pending AI bubble immediately
Lines 369-370: Sends department in body if user is signed in (though backend ignores it currently)
Lines 387-414: Word-drip streaming — full answer arrives, then splits by spaces and reveals one word every 45ms with setInterval
Lines 780-786: Renders .cite-chip source citations after streaming completes
3. Notices & Announcements / Notification System
There are two independent data pipelines feeding the unified content_items table:

Pipeline 1: University Notices (Public)



python-scrapper/scrape_notice.py    ← scrapes tu.ac.kr notice board
  ↓ batch of IngestNoticePayload
  ↓ POST /api/ingest/notices        (with optional x-ingest-secret header)
src/app/api/ingest/notices/route.ts
  ↓ INSERT OR IGNORE into content_items (idempotent by source_url)
  ↓ detectLanguage() → ko/en/mixed based on Hangul ratio
data/bic_pulse.db content_items WHERE source='bic_notices'
  ↓ GET /api/notices?page=1&limit=20
src/app/api/notices/route.ts → paginated JSON
  ↓ fetched by page.tsx: fetchNoticesList()
Pipeline 2: Kakao Department Announcements (Gated)
Documented in KAKAO_RELAY_GUIDE.md:




KakaoDump2 Android app (rooted phone)
  ↓ dumps KakaoTalk SQLite DB → decrypts with KakaoDecrypt
  ↓ per-chat Relay Config: user selects department slug + flips toggle ON
  ↓ POST JSON batch {messages: [{row_id, chat_id, sender_id, text, timestamp}]}
  ↓ to /api/ingest/kakao/<department>    (department encoded in URL path!)
src/app/api/ingest/kakao/[department]/route.ts
  ↓ source_url = "kakao://<chat_id>/<row_id>"  → UNIQUE dedup key
  ↓ title = first ~80 chars of text (Kakao has no subject line)
  ↓ INSERT OR IGNORE: is_gated=1, department=<slug>, source='kakao_announcement'
data/bic_pulse.db content_items WHERE source='kakao_announcement' AND department=?
  ↓ GET /api/announcements/<department>?page=1&limit=20
src/app/api/announcements/[department]/route.ts → paginated JSON
  ↓ fetched by page.tsx: fetchAnnouncementsList(dept, page, limit)
Gating logic in page.tsx:

Signed out (bp_loggedIn !== 'true' in localStorage): Announcements panel + Dashboard widget show .locked dashed card with "Sign up" CTA → goes to signup view
Signed in: Uses bp_dept from localStorage → fetches that department's list → pagination works
No backend auth — purely client-side localStorage (scope is MVP, non-production per spec Non-Goals)
4. Frontend Design (Neo-Brutalist)
The design is fully implemented, matching bic-pulse-app.html exactly.

Design System in globals.css
CSS Var	Value	Usage
--paper	#F5F2EA	Body background
--card	#FFFFFF	Card backgrounds
--ink	#111111	All borders, text, shadows
--yellow	#FFD400	Primary buttons, user chat bubbles, active mobile tabs
--blue	#1E3FE0	Secondary buttons, announcement tags
--locked	#E7E3D8	Empty/locked dashed cards
--border	2.5px solid var(--ink)	Thick brutalist borders
--shadow	4px 4px 0 var(--ink)	Hard drop shadow (no blur)
Responsive Breakpoint: Exactly 760px
Desktop (>760px): 220px left .sidebar, .main padding 26/30px
Mobile (≤760px): Sidebar display:none, fixed .bottom-tabs at bottom with 5 tabs (Home/Notices/Dept/Ask AI/You), active tab gets yellow bg
Three Views in page.tsx
Landing View (lines 455-522): Hero with TU label + yellow highlight on headline, hero search that jumps to AI panel, 3 latest NoticeCard previews, Announcements CTA, footer
App View / Shell (lines 525-906): Sidebar + main area with 5 panels:
Dashboard (panel-dashboard): 2 stat boxes (Notices count, Announcements count or —), 01 RECENT NOTICES (2 cards), 02 ANNOUNCEMENTS (locked or 2 preview cards)
Notices (panel-notices): Full paginated list, 10/page, Prev/Next
Announcements (panel-announce): Locked when signed out, dept-specific list + pagination when signed in
Ask AI (panel-ai): Full chat flow, word-drip streaming, source chips, 2 suggestion chips, scope-note bar
Profile (panel-profile): Signup CTA (signed out) or student ID + dept display + Sign out
Signup View (lines 909-957): Student ID, Department dropdown (5 options), Password → "Create account" writes to localStorage → redirects to App Dashboard
5. Where the Previous Agent Stopped & What Remains
Task Completion Status (from tasks.md)
Task	Description	Status	Evidence
Task 1	Extend rag.py with --json output mode	✅ DONE	rag.py has ask_json(), --json CLI flag works for build + ask
Task 2	Python bridge + /api/ai/chat route	✅ DONE	ai.ts + chat/route.ts both exist, tested with build
Task 3	Design system: globals.css + layout fonts	✅ DONE	globals.css full neo-brutalist system; layout.tsx has Space Grotesk + Noto Sans KR preconnects; viewport meta present
Task 4	App shell: Landing + App views, hash routing, nav	✅ DONE	page.tsx: useAuth(), go(), showTab() hash-based router; 3 views + 5 panels; sidebar + bottom-tabs
Task 5	Wire real data: Notices, Dashboard, Announcements	✅ DONE	fetchNoticesList() + fetchAnnouncementsList() call actual APIs; Landing (3 notices), Dashboard (2+preview), Notices pagination, Announcements gating all wired
Task 6	AI Chat panel + streaming UX	✅ DONE	ask() (lines 355-424): POST /api/ai/chat → word-drip 45ms/word → source chips → error handling; suggestion chips work
Task 7	Re-style NoticeCard & AnnouncementCard	✅ DONE	NoticeCard.tsx uses .card .notice-card with yellow tag; AnnouncementCard.tsx uses blue dept tag
Task 8	Mobile polish + mobile-app-like UI	⚠️ ~90% DONE	Media query @media (max-width:760px) implemented; bottom tabs appear; sidebar hidden; padding reduced; hero h1=30px. Agent was about to do final polish when stopped.
Task 9	Lint/TS/build + smoke tests + final cross-check	⚠️ ~70% DONE	Last agent message: "Build passed! All routes including new /api/ai/chat compiled successfully. Now let me start the dev server for functional testing and polish the mobile CSS." So: tsc ✅, lint ✅ 0 errors, npm run build ✅ passed. NOT DONE: dev server functional smoke tests, mobile CSS final polish, manual AC-01 through AC-13 verification.
The Exact Stopping Point
The agent had just successfully completed:

All code changes for Tasks 1-7
npm run build → passed (all routes including /api/ai/chat compiled)
Lint fixed to 0 errors, TypeScript --noEmit clean
The agent was about to perform these final actions:

Start the Next.js dev server (npm run dev)
Run functional smoke tests on all UI flows (Task 9.4):
Landing → hero search click → App/AI
Dashboard stat counts vs DB
Notices pagination click
Signup flow → Announcements unlock
AI chat end-to-end question
Resize desktop ↔ mobile
Design visual parity check
API routes curl verification
Mobile CSS polish (Task 8): Specifically verifying 375px iPhone SE, 768px boundary, no horizontal overflow, safe-area padding for home indicator, 100dvh chat height, env(safe-area-inset-bottom)
What Still Needs to Be Done (Remaining Work)
Priority	Task	Details
🔴 High	Start dev server + smoke test all 8 flows (Task 9.4)	Manually verify each Acceptance Criterion from spec.md actually works end-to-end
🔴 High	AI chat backend verification	curl the /api/ai/chat endpoint with a real question → confirm {answer, sources[]} returns non-empty. The build compiled but nobody has actually run a real RAG query through the bridge yet.
🟡 Medium	Mobile viewport polish (Task 8)	DevTools 375px iPhone SE: check document.documentElement.scrollWidth === clientWidth (no x-overflow), add padding-bottom: env(safe-area-inset-bottom) to .bottom-tabs, change .chat height from 65vh to calc(65dvh - 80px) for iOS Safari
🟡 Medium	department param in AI RAG (minor gap)	ai.ts line 28 does void department — the signed-in dept is sent but ignored. If scope is RAG-over-DB + tu_data.md, this needs enhancement. Otherwise acceptable for current MVP (only tu_data.md is indexed).
🟢 Low	tu_rag/storage/ existence	The RAG index must be built once (.venv\Scripts\python.exe rag.py build). The bridge calls get_or_build_index() which auto-builds on first query, but first-request latency will be ~30-60s. Consider pre-building.
🟢 Low	GOOGLE_API_KEY env consistency	Verify key is loaded: either Next.js .env.local propagates through process.env to subprocess, OR tu_rag/.env has it. rag.py's dotenv handles the fallback, but smoke test will confirm.
One Known Bug (Minor) Already Found
In page.tsx line 370, the frontend sends body.department = auth.dept when signed in, but the API route at chat/route.ts line 26 reads the field as department (correct), then passes it to runRagJson(question, department) (correct), but runRagJson immediately discards it with void department on ai.ts line 28. So department-aware RAG is not implemented yet. For the MVP this is fine since only tu_data.md is indexed, but if department announcements from SQLite should also be searched, that's a remaining enhancement.