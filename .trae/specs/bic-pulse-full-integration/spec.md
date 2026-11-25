# BIC Pulse Full Integration Specification

## Problem

BIC Pulse currently has:
1. A minimal walking-skeleton Next.js frontend (dark theme, basic pages for Notices & Announcements)
2. A standalone LlamaIndex + Gemini RAG system in `tu_rag/rag.py` that works independently
3. A high-fidelity design reference in `bic-pulse-app.html` (neo-brutalist style)

These three pieces are disconnected. The AI RAG works only as a CLI tool, the frontend design is a throwaway mock, and the live pages use a different (dark) visual system. Users cannot ask university questions through the web UI, and the visual identity is inconsistent.

## Users

- **End users**: BIC / Tongmyong University students who want one place for notices, department Kakao announcements, and AI answers.
- **Developers**: Maintainers who need the AI integrated cleanly into the Next.js app without breaking the existing scraping/ingest pipeline.

## Goals

1. Expose the standalone RAG AI service as a backend API within the Next.js app so the frontend can send questions and receive streamed or structured answers (with source citations).
2. Redesign the entire frontend to match the neo-brutalist design system from `bic-pulse-app.html`: paper/card/yellow/blue palette, thick borders, drop-shadows, Space Grotesk + Noto Sans KR typography, sidebar (desktop) / bottom-tabs (mobile) layout.
3. Make the web app fully responsive:
   - Desktop: left sidebar navigation, generous padding, full-height chat.
   - Mobile (≤760px): fixed bottom tab bar, compact paddings, mobile-app-like UI.
4. Wire every module to real data: Landing, Dashboard, Notices, Announcements, AI Chat, Signup/Profile.
5. Preserve and integrate the existing SQLite-backed Notices and Kakao Announcements data pipeline.

## Non-Goals

- Production user authentication (JWT, OAuth, password hashing). The design reference uses a simple client-side "sign up" state for department gating. Production-grade auth is explicitly out of scope; use client-side state + localStorage only, matching the reference.
- Rebuilding the Python scraper, KakaoDump2 Android app, or ingest pipeline.
- Rewriting the RAG engine in TypeScript; we call the existing Python module.
- Deployment / hosting changes.

---

## Functional Requirements (FR)

### FR-01 AI Backend API
- **FR-01.1**: Create `POST /api/ai/chat` accepts `{ question: string, department?: string }` and returns a JSON answer with source metadata.
- **FR-01.2**: The API route invokes `tu_rag/rag.py` functions (via Python subprocess or equivalent bridge) to answer using the existing RAG index: load from `tu_rag/storage/`.
- **FR-01.3**: If no index exists, the route builds one from `tu_data.md` on first call (equivalent to `get_or_build_index`).
- **FR-01.4**: Response shape: `{ answer: string, sources: Array<{ label: string, preview?: string }> }`.
- **FR-01.5**: Windows-safe: stdout encoding / environment variables (`GOOGLE_API_KEY`) are propagated from `tu_rag/.env` or project `.env.local`.

### FR-02 Frontend Views / Routing
- **FR-02.1**: Single app shell with two top-level **views**: Landing (public) and App (authenticated area with tabs).
- **FR-02.2**: Landing view (`/`): hero with university label, big headline with yellow highlight, hero search input that jumps to AI tab, latest-notices preview section, gated announcements CTA, footer.
- **FR-02.3**: App view with 5 **panels**:
  - Dashboard (Home): stat row, recent notices, announcements widget)
  - Notices: full paginated list from DB
  - Announcements: department-gated (locked card when not signed in, list when signed in)
  - Ask AI: chat interface
  - Profile: sign-up form / sign-out
- **FR-02.4**: Dedicated Signup view: student-id / department / password form matching reference layout.
- **FR-02.5**: Panel routing: navigating updates URL hash or route state so direct-links work (e.g. open AI panel directly).

### FR-03 Design System Implementation
- **FR-03.1**: CSS custom properties exactly matching `:root` variables from the reference:
  `--paper:#F5F2EA`, `--card:#FFFFFF`, `--ink:#111111`, `--ink-soft:#5A5A54`, `--yellow:#FFD400`, `--blue:#1E3FE0`, `--locked:#E7E3D8`, `--border`, `--shadow`, `--shadow-sm`.
- **FR-03.2**: Typography: `Space Grotesk` for display/headings, `Noto Sans KR` for body text, loaded from Google Fonts.
- **FR-03.3**: Component primitives re-styled: `.btn` (primary/secondary/ghost/block), `.card`, `.tag` (notice/announce), `.stat`, `.section-label`, `.field` + form inputs with thick borders.
- **FR-03.4**: All existing cards (NoticeCard, AnnouncementCard) use the new design system visually.

### FR-04 Navigation (Responsive)
- **FR-04.1**: Desktop (>760px): left `.sidebar` 220px with logo, nav items (Home, Notices, Announcements, Ask AI, Sign in/Profile), scope note footer. Active nav gets ink background + paper text.
- **FR-04.2**: Mobile (≤760px): sidebar hidden, `.main` padding reduced, fixed `.bottom-tabs` bar with 5 iconless-label tabs (Home, Notices, Dept, Ask AI, You), active tab yellow background.
- **FR-04.3**: Landing view has its own `land-nav` header on both breakpoints.

### FR-05 AI Chat Panel
- **FR-05.1**: Chat log with user message bubbles (user right, yellow, ink border) and AI bubbles (left, paper bg, ink border).
- **FR-05.2**: AI answer appears with blinking cursor streaming simulation while waiting for API response.
- **FR-05.3**: Suggestion chips (e.g. "When does registration open?") clickable to prefill + send.
- **FR-05.4**: Source citation chips below each AI answer.
- **FR-05.5**: Scope note bar reflects signed-in / signed-out state.
- **FR-05.6**: Enter key in input sends question. Send button also works.

### FR-06 Notices & Announcements Integration
- **FR-06.1**: Notices panel pulls paginated list via `/api/notices` (or direct server component read) using real `bic_notices` rows.
- **FR-06.2**: Announcements panel:
  - Signed-out: show locked card with signup CTA.
  - Signed-in: list `kakao_announcement` rows filtered by selected department.
- **FR-06.3**: Dashboard Home panel: stat counts + recent 2 notices + announcements preview.
- **FR-06.4**: Landing latest notices preview shows 3 notices.

### FR-07 Signup / Department Gating (Client-Side)
- **FR-07.1**: Signup view captures student id, department dropdown, password.
- **FR-07.2**: State persisted in localStorage: `loggedIn`, `dept`.
- **FR-07.3**: Profile panel shows signed-in department with sign-out.
- **FR-07.4**: Sidebar scope + chat scope-note reflects state.
- **FR-07.5**: Departments dropdown populated with the departments found in DB or sensible defaults (Computer Engineering, Business Admin, Mechanical, Nursing, demo_dep).

---

## Non-Functional Requirements (NFR)

- **NFR-01**: No visual parity with `bic-pulse-app.html` reference — a side-by-side visual comparison should find no meaningful difference in layout, spacing, or colour values.
- **NFR-02**: Mobile-first responsive behaviour must work on common viewports: 375px iPhone SE, 390px iPhone 12, 768px iPad mini portrait (mobile breakpoint), 1280px desktop.
- **NFR-03**: AI API route response < 30s for typical questions (Gemini latency budget). Errors surface as user-visible error bubble, not uncaught crash.
- **NFR-04**: No new runtime dependencies added beyond what's in `package.json` unless necessary (Python bridge OK to add a single thin wrapper lib if needed; prefer Node `child_process` spawn).
- **NFR-05**: All existing API routes (`/api/notices`, `/api/announcements/[department]`, `/api/ingest/*`) continue to work unchanged.
- **NFR-06**: TypeScript strict (no `any` escapes beyond what's already in the codebase).
- **NFR-07**: Console must not add inline styles in production.

---

## Constraints

- Next.js version is 16.3.4 (see `package.json`). This is NOT the Next.js you know — check `node_modules/next/dist/docs/` before writing patterns.
- Python RAG must call via `tu_rag/rag.py` only — no reimplementation.
- Design tokens and palette come from the HTML reference, not invented.
- Mobile breakpoint `max-width: 760px` exact.
- `better-sqlite3` synchronous-style DB access pattern preserved for server components.
- Windows environment: child_process spawning Python must account for backslash paths, `PYTHONIOENCODING, shell=False where appropriate.
- GOOGLE_API_KEY loaded by precedence: `process.env.GOOGLE_API_KEY` (Next env) -> fallback `tu_rag/.env`.

## Dependencies

- Gemini API availability (GOOGLE_API_KEY in env).
- Prebuilt RAG storage in `tu_rag/storage/` (auto-rebuilds if missing).
- Python 3.11+ with `tu_rag/.venv` or system Python with `tu_rag/requirements.txt` installed.
- Existing `data/bic_pulse.db` SQLite populated for notices/announcements.

## Assumptions

- Simple localStorage-only client-side auth is sufficient (per non-goals; no production auth for MVP).
- Departments dropdown can be a union of KB defaults + DB-derived.
- AI streaming on frontend can be simulated word-by-word once full response received (server returns JSON; frontend word-drip presentation).
- `tu_rag/rag.py : `ask()` returns answer + sources as string; we may need a small `--json-output wrapper to get sources cleanly (add a mode).

## Open Questions (resolved via design choice):

- Q1. How to call Python from Next.js API route? → **Choice:** child_process.spawn the venv Python with a thin JSON mode argument (new `--json` flag added to `rag.py` returning JSON on stdout).

---

## Acceptance Criteria

### AC-01 (rule) AI Backend Contract
`POST /api/ai/chat with `{question:"When does registration open?"}` returns HTTP 200, body `{answer, sources[]}` with non-empty `answer` string and `sources` array.
Evidence source: `curl`/Thunder Client request + server log.

### AC-02 (rule) AI Sources Populated
At least one returned `sources[]` entry has a `label` field when the answer draws on `tu_data.md` chunks.
Evidence: same evidence as AC-01.

### AC-03 (rule) AI Error Handling
Missing `GOOGLE_API_KEY` or Python failure returns non-500 friendly JSON `{error: string}` with user-friendly error message; frontend shows error bubble.
Evidence source: Temporarily rename env, send request, observe 200 with error payload (or 500 with JSON error shape).

### AC-04 (rubric) Frontend Design Parity with Reference
Scale 0-5, pass ≥ 4.
Anchors:
- 5: pixel-level match (borders 2.5px solid ink, shadow 4×4px 0 ink, yellow `#FFD400`, blue `#1E3FE0`, Space+Noto Sans KR fonts loaded, sidebar 220px.
- 3: colors match but spacing ~20-30% off padding/font weight or border-radius wrongly used inadvertently.
- 1: wrong colors or dark theme still present still bleeds.
- 0: dark theme only.
Evidence: side-by-side screenshots of each view (Landing, App Home panel, AI chat, Signup) compared to `bic-pulse-app.html` screenshots.

### AC-05 (rubric) Responsive Behaviour (mobile)
Scale 0-3, pass ≥ 2:
- 3: 375px and 768px both perfect. side bottom tab bar active tab yellow, desktop sidebar active panel body padding tight; 761–768 uses mobile mode correctly 769+ desktop mode.
- 1: break present but overflow / missing.
- 0: unreadable on <760.
Evidence: Chrome DevTools Device Toolbar screenshots 375 and 768px screenshots.

### AC-06 (rule) Notices Panel Pagination Works
Notices panel shows paginated cards (e.g. 20 / page) and navigates.
Evidence: click Next / Prev arrows, page indicator, >1 page if notices exist (or mock if empty empty state message).

### AC-07 (rule) Announcements Gating
Signed out → Announcements panel shows locked "Sign up" card. Sign up with dept → announcements dept list renders. Sign out reverts.
Evidence: video or UI clicks screenshots.

### AC-08 (rule) Dashboard Stats
Dashboard "New Notices" stat updates based on DB rows. Announcements stat shows department count only when signed-in, else em-dash.
Evidence: compare DB COUNT vs. UI display.

### AC-09 (rule) AI Chat Flow
Type "registration" in chat, press Enter → user bubble appears → AI bubble appears → citation chips render after answer. No crash.
Evidence: UI recording or DevTools Network tab shows `/api/ai/chat` POST 200 OK.

### AC-10 (rule) Landing Hero Search
Click hero search input → navigates to App view → Ask AI panel active.
Evidence: click → view switches.

### AC-11 (rule) Existing APIs Still Work
GET `/api/notices?page=1` → same JSON shape as pre-integration (no schema).
GET `/api/announcements/demo_dep` → same shape.
Evidence: curl.

### AC-12 (rubric) Mobile App-Like Feel on Phone
Scale 0-3, pass ≥ 2:
- 3: bottom tabs feel native-feeling (fixed solid, spacing finger-sized padding of each other no horizontal over-scrolling chat fixed header-free scroll bouncing body).
- 1: works but.
- 0: unusable.
Evidence: 375px screenshot walkthrough.

### AC-13 (rule) Linting / TS
`npm run lint` exits 0; `npx tsc --noEmit` no new errors beyond those errors (or 0).
Evidence: terminal logs.
