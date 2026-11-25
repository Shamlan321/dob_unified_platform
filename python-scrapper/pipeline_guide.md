# BIC Pulse — Scraping Pipeline Guide

Two projects. One data flow.

```
Notices Extractor/          →       bic-pulse/
(Python scraper)                    (Next.js web app)
```

---

## The Files

### `Notices Extractor/`

| File | What it does |
|---|---|
| `scrape_notice.py` | Scrapes the **notice list** from the university website. Pulls titles, dates, view counts, and URLs for each notice. Stores everything in `notices.db`. |
| `scrape_details.py` | Visits **each individual notice page** URL from `notices.db`. Extracts the clean body text, attachment download links, and images. Updates `notices.db` with the results. |
| `push_to_api.py` | Reads `notices.db` and **sends all notices to the BIC Pulse web app** via the ingest API. Handles deduplication — safe to run any time. |
| `notices.db` | Local SQLite cache. The scraper's working database. |

---

## The Steps

### Step 1 — Scrape the notice list
```
python scrape_notice.py
```
Scrapes 9 pages of the BIC notice board (~89 notices). Saves titles, dates, view counts, and URLs to `notices.db`. Takes about 10 seconds.

---

### Step 2 — Scrape each notice's full content
```
python scrape_details.py --all
```
Visits every notice URL stored in Step 1. Extracts:
- Clean body text (navigation chrome stripped out)
- Attachment file download links
- Inline images

Updates `notices.db` with the results. Takes about 1–2 minutes (0.7s delay per request to be polite to the server).

> **Re-run only new ones** (skip notices that already have content):
> ```
> python scrape_details.py
> ```

---

### Step 3 — Push to the web app
```
python push_to_api.py
```
Reads all 89 notices from `notices.db` and POSTs them in batches to `http://localhost:3000/api/ingest/notices`.

- **New notices** → inserted into the web app's database
- **Already-there notices** → counted as duplicates, skipped
- **100% safe to re-run** at any time

> **Force-update existing notices** (e.g. after re-scraping content):
> ```
> python push_to_api.py --upsert
> ```

---

## Typical Full Refresh

```
python scrape_notice.py        # 1. get new notices from the website
python scrape_details.py       # 2. fill in body text for any new ones
python push_to_api.py          # 3. send new ones to the web app
```

That's it. Run these three commands whenever you want to sync new notices.

---

## Where the data lives

```
notices.db          ← scraper's local cache (Notices Extractor folder)
data/bic_pulse.db   ← web app's database   (bic-pulse folder)
```

The two databases are separate. `push_to_api.py` is the bridge between them. The web app never touches `notices.db` directly.

---

## The Web App API Endpoints

| Endpoint | Method | What it does |
|---|---|---|
| `/api/ingest/notices` | POST | Receives notices from the push script |
| `/api/notices` | GET | Returns paginated notice list |
| `/api/notices/[id]` | GET | Returns a single notice |

The UI at `/notices` reads directly from the database and shows everything that's been pushed.
