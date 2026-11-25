# BIC Pulse Full Integration — Implementation Tasks

Parent spec: [spec.md](./spec.md)

---

## Task 1: Extend rag.py with JSON output mode

**Status:** pending
**Priority:** high
**Covers AC:** AC-01, AC-02
**Depends on:** none

### Description
Modify `tu_rag/rag.py` to support machine-readable JSON output so Next.js can call it via subprocess and parse the response deterministically.

Add a `--json` CLI flag (and a library-mode helper `ask_json(index, question) -> dict`) that prints a single JSON object on stdout with shape:
```json
{"answer": "...", "sources": [{"label": "...", "preview": "..."}, ...]}
```
- `label`: unique identifier per source (e.g., document name, section, score)
- `preview`: first ~120 chars of the source chunk (optional but recommended)

Keep `ask()` backward-compatible for interactive CLI use. Preserve all existing UTF-8 safety and dual-backend (new GenAI SDK / deprecated Gemini) initialisation logic.

If `--json build` is passed, still run index build but also emit JSON on completion for scripting: `{"ok": true, "storage": "...", "nodes": N}`.

### Test Requirements

- **TR-1.1 (rule):** `cd tu_rag && .venv\Scripts\python.exe rag.py --json ask "registration?"` prints a single valid JSON object parsable by `jq` / `JSON.parse` with `answer` non-empty and `sources` array. Evidence: console capture.
- **TR-1.2 (rule):** Interactive mode `rag.py ask "registration?"` (no `--json`) still prints the styled multiline format. Evidence: terminal output.
- **TR-1.3 (rule):** `rag.py --json build` emits JSON object on successful build. Evidence: terminal.

### Completion Evidence
*(filled when done)*

---

## Task 2: Implement Python subprocess bridge + `/api/ai/chat` route

**Status:** pending
**Priority:** high
**Covers AC:** AC-01, AC-02, AC-03
**Depends on:** Task 1

### Description

1. Create `src/lib/ai.ts` exporting:
   - `getPythonBin(): string` — resolves the Python interpreter, preferring `tu_rag/.venv` (`.venv\Scripts\python.exe` on Windows, `.venv/bin/python` otherwise), falling back to `python3` then `python`.
   - `runRagJson(question: string, department?: string): Promise<{answer: string, sources: {label:string,preview?:string}[]}>` — spawns Python with `rag.py --json ask <question>`, captures stdout, parses JSON, rejects on non-zero exit or parse failure.
   - Propagate `GOOGLE_API_KEY` from `process.env` into the child env (so Python inherits Next's GOOGLE_API_KEY if set, otherwise relies on tu_rag/.env dotenv).
   - Ensure Windows path-safety (backslash handling via `path.resolve`, `shell: false`, and quote-less args array).

2. Create `src/app/api/ai/chat/route.ts` with `POST` handler:
   - Reads JSON body `{ question: string, department?: string }` — validates question non-empty, 400 on missing.
   - Calls `runRagJson()`.
   - Returns 200 `{ answer, sources }` on success.
   - On failure: returns 200 (or 500) with `{ error: string }` and logs server-side. Never hangs. Add 60s timeout wrapper.

3. Verify env-loading: if `process.env.GOOGLE_API_KEY` is missing, the Python subprocess should still load from `tu_rag/.env` (rag.py calls dotenv). Do NOT duplicate secrets in two files; document the behaviour.

### Test Requirements

- **TR-2.1 (rule):** Running dev server and `curl -X POST http://localhost:3000/api/ai/chat -H "Content-Type: application/json" -d "{\"question\":\"when does registration open?\"}"` returns HTTP 200 with `answer` field non-empty. Evidence: curl capture.
- **TR-2.2 (rule):** Same curl but `question:""` or missing → HTTP 400 with JSON error. Evidence: curl.
- **TR-2.3 (rule):** Temporarily break Python access (e.g., rename venv) → API returns 200/500 JSON with `{error}` field, no stack trace leaked to client. Evidence: curl.
- **TR-2.4 (rule):** Existing routes GET `/api/notices?page=1` and `/api/announcements/demo_dep` still return their schemas unchanged (AC-11). Evidence: curl both.

### Completion Evidence
*(filled when done)*

---

## Task 3: Rewrite design system (globals.css + layout fonts)

**Status:** pending
**Priority:** high
**Covers AC:** AC-04
**Depends on:** none

### Description

**3a.** Replace `src/app/globals.css` entirely with the neo-brutalist system from `bic-pulse-app.html`, adapted for Next.js. Add:

- `:root` variables **exact**: `--paper`, `--card`, `--ink`, `--ink-soft`, `--yellow`, `--blue`, `--locked`, `--border`, `--shadow`, `--shadow-sm`, and font variables.
- Typography: set `h1,h2,.display` to Space Grotesk (font-weight 700, letter-spacing -0.01em). Body to Noto Sans KR.
- Primitives: `.btn` (with `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-block`, active-state 2px translate pressed shadow). `.card`, `.tag`, `.tag-notice`, `.tag-announce`, `.stat`, `.section-label`, `.field` (label + input/select). Locked dashed card.
- App shell: `.shell`, `.sidebar` (220px), `.nav-item`, `.nav-item.active`, `.main` (padding 26/30 desktop, 18/16 mobile). `.bottom-tabs`, `.tab`, `.tab.active`.
- Landing: `.land-nav`, `.hero` (h1 44px desktop / 30px mobile), `.hero-search`, `.hero .hl` yellow bg highlight, `.land-section`, `.footer`, `.badge`.
- Chat: `.chat`, `.chat-log`, `.msg-user`, `.msg-ai .bubble`, `.cursor` blink, `.cite-row`, `.cite-chip`, `.chip-row`, `.sugg`, `.chat-input`, `.scope-note`.
- Mobile breakpoint: `@media (max-width:760px)` — exactly 760px. Show bottom tabs, hide sidebar, collapse paddings, shrink hero.
- Keep existing classes `.notice-card`, `.attachment-*` etc. but re-style them to match the neo-brutalist visuals (thick 2.5px ink border, shadow, card bg paper/yellow tags).

**3b.** Update `src/app/layout.tsx`:
- Remove old header/footer markup from `<body>` (we'll build landing+app shell inside pages/route groups). Keep `<html>`, `<body>` tags, and fonts.
- Preload Google Fonts: add `<link rel="preconnect" href="https://fonts.googleapis.com">` and the Space Grotesk 500+700 + Noto Sans KR 400+500+700 stylesheet link.
- Keep metadata title/description.
- The new shell will be rendered inside each route (we combine views via routing or client state).
- Add `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` so mobile layout respects safe areas.

### Test Requirements

- **TR-3.1 (rubric, AC-04):** Visual comparison of colour variables and primitives — ≥4/5. Evidence: screenshots of the new `globals.css` applied vs reference side-by-side.
- **TR-3.2 (rule):** `<body>` rendered has `font-family` applying Noto Sans KR, h1 Space Grotesk — visible in DevTools computed style. Evidence: screenshot or computed CSS dump.
- **TR-3.3 (rule):** `.nav-item.active` ink background + `.btn:active` press translate effect works in both desktop and mobile when clicked. Evidence: interaction test.
- **TR-3.4 (rule):** Resize 760px → bottom tabs appear, sidebar gone. 769px → sidebar appears, bottom tabs gone. Evidence: DevTools screenshot.

### Completion Evidence
*(filled when done)*

---

## Task 4: App shell architecture (Landing + App views, hash routing, nav)

**Status:** pending
**Priority:** high
**Covers AC:** AC-04, AC-05, AC-10, AC-06, AC-07
**Depends on:** Task 3

### Description

Build the top-level page structure as a client-centric app. Use Next.js App Router route groups to keep the layout clean, or implement view switching via client state + shallow hash routing.

**Approach:** Rewrite `src/app/page.tsx` as a client component that switches between **Landing view** and **App view** (with 5 panels inside the App shell). A simpler single-page approach: the root page acts as the router by reading `window.location.hash` to determine active panel. Direct links to `/#ai` open AI panel directly.

**Structure of `src/app/page.tsx` (marked `'use client'`):**

```
<App />
├── state: view ∈ { 'landing' | 'app' | 'signup' }
│   panel ∈ { 'dashboard'|'notices'|'announce'|'ai'|'profile' }
│   auth: { loggedIn:boolean, dept:string, studentId:string } (localStorage)
│
├── Landing view
│   ├── land-nav (logo + Dashboard btn + Sign up btn)
│   ├── hero (TU label, headline, lede, hero-search)
│   ├── land-section "LATEST NOTICES" with 3 NoticeCards
│   ├── land-section "DEPARTMENT ANNOUNCEMENTS" locked CTA or summary
│   └── footer
│
├── App view (shell with sidebar + main + bottom-tabs)
│   ├── Dashboard panel: stat row, section 01 recent notices, section 02 announcements
│   ├── Notices panel: full paginated notices list via API
│   ├── Announcements panel: locked card or list
│   ├── Ask AI panel: chat interface
│   └── Profile panel: auth state UI
│
└── Signup view
    └── Form (student id, department select, password, create account)
```

**Helpers required in `src/app/page.tsx` or extracted `src/components/`:**
- `useAuth()` hook — reads/writes localStorage.
- `go(view)`, `showTab(panel)` that sync hash & state.
- Department list: union of known defaults + whatever `kakao_announcement` departments exist. To keep it simple, expose a small server component helper or just hardcode `['Computer Engineering','Business Administration','Mechanical Engineering','Nursing','demo_dep']`; we refresh later.

Do NOT yet wire actual data (panels render skeleton placeholders using dummy NOTICES array from reference; Task 5 plugs real data in).

### Test Requirements

- **TR-4.1 (rule):** Click hero-search input → switches to App view → AI panel active (AC-10). Evidence: click recording or state log.
- **TR-4.2 (rule):** Click sidebar/bottom tab `announce` → Announcements panel shows locked card when not signed in (AC-07 signed out half). Evidence: screenshot.
- **TR-4.3 (rule):** `/#notices` opens directly to App view → Notices panel. Evidence: paste URL in new tab.
- **TR-4.4 (rule):** Signup form → sets localStorage `{ loggedIn:true, dept:..., ...}` → redirects to App view → Profile panel shows signed-in state & department. Announcements panel unlocks (AC-07 signed-in half). Evidence: DevTools Application → localStorage.
- **TR-4.5 (rule):** Viewport ≤760px: bottom-tabs fixed, sidebar `display:none`. Viewport >760px: sidebar visible, bottom-tabs `display:none`. (AC-05, partial) Evidence: resize + screenshots.

### Completion Evidence
*(filled when done)*

---

## Task 5: Wire real data into panels — Notices, Dashboard, Announcements

**Status:** pending
**Priority:** high
**Covers AC:** AC-06, AC-07, AC-08, AC-11
**Depends on:** Task 4, Task 2 (partially for API routes reuse)

### Description

**5a Notices (Dashboard + Notices panel + Landing preview):**
- Create server data functions in `src/lib/data.ts`:
  - `getLatestNotices(limit=3)` returns ContentItem[] from SQLite (`source='bic_notices' ORDER BY published_at DESC LIMIT ?`)
  - `getNoticesPage(page=1, limit=20)` returns `{items, total, totalPages}`
  - `getAnnouncementsForDept(dept, limit=20)` returns ContentItem[]
  - `getAnnouncementCountByDept()` returns Map<dept, number>
- Pass these through a server component or client fetch. Simplest approach: on Landing, Dashboard, Notices panels we fetch via client-side `fetch('/api/notices?...')` so they stay client components and share the existing well-tested API. Alternatively: server-side direct DB read in server components. Either works; pick client-side fetch for the chat-heavy app to avoid route changes.
- Landing preview shows 3 most-recent notices (use `?_limit=3`; create query param support or add an internal route — the cleanest: reuse `/api/notices?limit=3&page=1` since `/api/notices` already supports limit).
- Dashboard: 2 most-recent notices + recent announcements preview if signed in.
- Notices panel: page 1..N with Prev/Next pagination + page indicator.
- **Empty state:** If no notices in DB, show friendly empty-state card matching the design.

**5b Announcements:**
- Signed in → fetch `/api/announcements/<dept>?limit=20&page=1` and list.
- Signed out → show locked card with signup CTA button that calls `go('signup')`.
- Dashboard announcements widget mirrors signed-in state.

**5c Dashboard stat counts:**
- "NEW NOTICES" = COUNT of bic_notices (or a recent-window count; use total notices for simplicity as per reference style of round numbers).
- "ANNOUNCEMENTS" = COUNT of signed-in dept or `—` em-dash.

### Test Requirements

- **TR-5.1 (rule):** Notices panel paginates if DB has >1 page of notices (AC-06). Evidence: pagination UI clicking Next then Prev works.
- **TR-5.2 (rule):** Signed in to dept X → Announcements panel renders `kakao_announcement` rows filtered to X (AC-07). Sign out → returns to locked card. Evidence: screenshots + data in DB.
- **TR-5.3 (rule):** Dashboard "New Notices" stat === DB COUNT for bic_notices (or number of items shown on first page, clearly matching reference style "12"), announcements stat = count of dept if logged in else `—` em-dash (AC-08). Evidence: compare DB query result against UI.
- **TR-5.4 (rule):** Existing API routes unchanged (AC-11). Evidence: curl check from TR-2.4 still passes after the refactor.

### Completion Evidence
*(filled when done)*

---

## Task 6: AI Chat panel wiring + streaming UX

**Status:** pending
**Priority:** high
**Covers AC:** AC-09
**Depends on:** Task 2 (API), Task 4 (shell)

### Description

Build the AI chat interface to design-system spec + live backend:

1. **Chat log** (`.chat-log`): vertically flex, auto-scroll-to-bottom when new messages arrive.
2. **User message**: right-aligned yellow bubble `msg-user`, rendered upon submit (optimistic UI — immediately before API returns).
3. **AI message placeholder**: on submit, append an AI bubble with `.cursor` blink animation; replace/stream into this bubble as answer arrives.
4. **Submit flow**:
   - Input + send button. Enter key also submits.
   - Call `POST /api/ai/chat` with `{question, department}`.
   - **Presentation streaming**: once the full JSON answer arrives, simulate word-drip into the bubble using setInterval ~45ms per word (exactly as reference does). Don't wait for real SSE — we chose client word-drip (per spec assumptions).
   - After drip completes: remove cursor, show cite chips from `sources[]`.
5. **Error handling**: If API returns `{error}`, show an AI-styled bubble with red-ish tinge (or label ⚠️) and the error message. Never leave dangling cursor hanging.
6. **Suggestion chips** (`.chip-row > .sugg`): "When does registration open?" and "Latest from my department?" — clicking prefills the input and sends.
7. **Scope note** (`.scope-note`): "Signed out — answers use public Notices only." or `Signed in as ${dept} — answers can use your department's announcements too.`
8. **Input empty guard**: don't send empty.

Keep state of chat log in memory (page-level React state); optionally persist a single session in localStorage but NOT required.

### Test Requirements

- **TR-6.1 (rule, AC-09):** Type "registration open", press Enter → user bubble → pending AI bubble with blinking cursor → ~3s later answer word-drips in → after completion cite chips appear below. Evidence: Network tab shows `POST /api/ai/chat` 200 OK + visual walkthrough screenshot/video.
- **TR-6.2 (rule):** Click suggestion chip "Latest from my department?" → same flow runs with that exact question. Evidence: click + network tab.
- **TR-6.3 (rule):** Break API (e.g., rename tu_rag/.env temporarily) → submit question → shows error bubble, no uncaught exception. Evidence: DevTools console clean + screenshot of error bubble.
- **TR-6.4 (rule):** Scope note updates synchronously after sign in/sign out. Evidence: click Sign out → scope note changes to public-data note.

### Completion Evidence
*(filled when done)*

---

## Task 7: Re-style NoticeCard and AnnouncementCard to neo-brutalist

**Status:** pending
**Priority:** medium
**Covers AC:** AC-04, AC-06, AC-07
**Depends on:** Task 3

### Description

Both `src/components/NoticeCard.tsx` and `src/components/AnnouncementCard.tsx` currently match the dark walking-skeleton style. Re-implement them to match the `.card` + `.tag` visual from reference:

- Outer: `.card` (white, 2.5px ink border, 4×4 ink shadow, 16px padding, 14px margin bottom).
- Tag at top: `.tag tag-notice` yellow for BIC, `.tag tag-announce` blue/white for Kakao announcements.
- Title: bold weight 600–700, ~14px, margin-top 7px. Keep the expand/collapse interaction but replace chevron with a simpler toggle (like `+`/`−` or keep ▼ but styled to ink).
- Date/small meta below title, 11px `ink-soft`.
- Expanded body: use the same `.card`-inner or a separate ink-bordered sub-panel (1.5px border inside). Keep existing logic for images, attachments, original-post link — but restyle buttons/links to design system buttons.
- AnnouncementCard department label: `.tag tag-announce` with the dept name (e.g. `COMPUTER ENGINEERING`).

Do NOT break the existing `expanded` state pattern. Keep it `use client`.

### Test Requirements

- **TR-7.1 (rule):** NoticeCard rendered has: yellow `NOTICE` tag, 2.5px solid `--ink` border on card, `--shadow` visible, white `--card` bg. Evidence: screenshot.
- **TR-7.2 (rule):** Click card → expands showing body + attachments. Click again → collapses. Evidence: interaction.
- **TR-7.3 (rule):** AnnouncementCard renders with blue/white dept tag (or yellow if team prefers a single tag scheme — but reference shows `.tag-announce` blue). Evidence: screenshot.

### Completion Evidence
*(filled when done)*

---

## Task 8: Mobile polish and mobile-app-like UI quality

**Status:** pending
**Priority:** medium
**Covers AC:** AC-05, AC-12
**Depends on:** Tasks 4, 5, 6, 7

### Description

Audit all breakpoints systematically and fix any remaining mobile UX warts:

1. **375px iPhone SE portrait:**
   - Bottom tabs: each tab flex:1, labels max two lines, tap target height ≥ 44px (HIG). Bottom safe-area padding via `env(safe-area-inset-bottom)` so content avoids home indicator.
   - Chat input sits above the tabs when keyboard open? iOS safari 100vh issues: use `100dvh` or `min-height: 100vh` with `padding-bottom` for home indicator. Chat body `.chat` uses `height: calc(65dvh or 65vh)` so doesn't push beyond viewport.
   - No horizontal scrollbars anywhere (test by touch-drag horizontally). `.main` must never overflow-x; set `min-width:0` on flex items that could otherwise break.
   - `.hero h1` font-size exactly 30px (reference). Land nav, hero, land-section padding-left/right 16px on mobile.
2. **760px iPad mini portrait (mobile break boundary):**
   - Exactly at 760 → bottom tabs visible. 761 → sidebar visible. Test edge of rule (Chrome DevTools device toggle exact px set).
3. **390px iPhone 12:** similar to SE, verify no layout break.
4. **Touches:** Remove/raise click delay (`touch-action: manipulation` on buttons/tabs). Ensure press state visual for `.btn:active` still works with touch (try pointer events).
5. **Chat view on mobile**: input stays fixed at bottom of `.chat` panel, chat log scrolls. Keyboard not covering the input when possible — mobile browsers handle this on their own mostly.

### Test Requirements

- **TR-8.1 (rubric, AC-05):** 375px + 768px responsive ≥ 2/3. Evidence: screenshots.
- **TR-8.2 (rubric, AC-12):** Mobile app-like feel on phone ≥ 2/3. Evidence: 375px screenshot walkthrough (bottom tabs solid, no horizontal overflow).
- **TR-8.3 (rule):** No element renders wider than viewport at 375px (DevTools → "Toggle device toolbar" → horizontal scrollbar absent). Evidence: screenshot showing no x-scroll, or computed `document.documentElement.scrollWidth === document.documentElement.clientWidth` at 375px.

### Completion Evidence
*(filled when done)*

---

## Task 9: Lint, TypeScript, final cross-check

**Status:** pending
**Priority:** medium
**Covers AC:** AC-13, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12
**Depends on:** Tasks 1-8 (all)

### Description

Run quality gates and fix any regressions:

1. `npm run lint` — fix any warnings/errors. Prefer fixing code over disabling rules unless the rule is wrong.
2. `npx tsc --noEmit` — ensure no new TS errors. (Allow pre-existing errors only if there were any pre-existing; new code must be clean.)
3. `npm run build` — ensure production build succeeds. (Next build is the final arbiter of App Router correctness for the non-standard 16.3.4 version.)
4. Manual smoke checklist:
   - Landing → hero search click → App/AI. (AC-10)
   - App: Home → stat counts match DB. (AC-08)
   - Notices: pagination works. (AC-06)
   - Announcements: signed out locked, signup flow → unlocked list. (AC-07)
   - AI chat: end-to-end works. (AC-09)
   - Resize: desktop sidebar, mobile tabs. (AC-05, AC-12)
   - Design: colours, shadows, borders match reference. (AC-04)
   - API routes: GET `/api/notices` and `/api/announcements/demo_dep` still return correct shapes. (AC-11)
5. `POST /api/ai/chat` end-to-end check with curl (AC-01, AC-02).

### Test Requirements

- **TR-9.1 (rule, AC-13):** `npm run lint` exit 0 AND `npx tsc --noEmit` exit 0. Evidence: terminal log.
- **TR-9.2 (rule):** `npm run build` exit 0 (production build). Evidence: terminal log.
- **TR-9.3 (rule):** All 10 smoke checklist items passed (each item evidenced as above). Evidence: linked to per-Task completion evidence.

### Completion Evidence
*(filled when done)*
