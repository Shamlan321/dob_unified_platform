"""
scrape_details.py  (v2 — clean extraction + attachments)
─────────────────────────────────────────────────────────
Re-scrapes each notice page, extracting:
  • A clean body text  (boilerplate stripped)
  • Attachment download links  (stored as JSON)
  • Images

Usage:
    python scrape_details.py              # only notices with no content
    python scrape_details.py --all        # re-scrape everything
    python scrape_details.py --limit 20   # cap at N notices
"""

import requests
from bs4 import BeautifulSoup
import sqlite3
import logging
import sys
import io
import time
import os
import re
import json
import argparse
from urllib.parse import urljoin, urlparse, parse_qs

# ─── UTF-8 console on Windows ────────────────────────────────────────────────
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('scrape_details.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ]
)
log = logging.getLogger(__name__)

DB_PATH     = os.path.join(os.path.dirname(__file__), 'notices.db')
BASE_DOMAIN = "https://www.tu.ac.kr"
DELAY       = 0.7

HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/115.0.0.0 Safari/537.36'
    )
}

# ─── Boilerplate patterns to strip from body text ───────────────────────────
# Lines that match exactly (after strip)
BOILERPLATE_EXACT = {
    '화면확대', '화면추소', '인쇄', '공유', '블로그', '페이스북',
    'URL 공유하기', 'Notice', 'Attachment', '첨부파일',
    'List', 'Previous post', 'Next post',
    'No next post', 'No previous post',
    '이전글', '다음글', '목록', '첨부', '다운로드',
}

# Lines that START WITH these prefixes should be dropped
BOILERPLATE_STARTS = (
    'Date Created',
    'Page Views',
    'Previous post',
    'Next post',
    '날짜',
    '조회',
    'No next',
    'No previous',
)

# Regex patterns: lines that match entirely should be dropped
BOILERPLATE_PATTERNS = [
    re.compile(r'^\d{4}-\d{2}-\d{2}$'),           # bare date: 2026-08-18
    re.compile(r'^\d+$'),                           # bare number: 134
    re.compile(r'^https?://\S+$'),                  # bare URL lines
]


def clean_body(raw: str, title: str, attachment_names: set[str]) -> str:
    """
    Remove navigation chrome, metadata duplicates, and attachment filenames
    from extracted page text, leaving only the actual notice body.

    Stops collecting as soon as a nav-sentinel line is reached so that
    adjacent-post link text (prev/next post titles) cannot leak in.
    """
    lines = raw.split('\n')
    cleaned: list[str] = []
    title_norm = title.strip()

    # Sentinels: when any of these appear as a line (exact), we stop reading
    # because the content that follows is navigation, not body text.
    NAV_SENTINELS = {'List', '목록', 'Previous post', 'Next post', '이전글', '다음글'}

    for line in lines:
        s = line.strip()
        if not s:
            continue
        # Stop collection at navigation boundaries
        if s in NAV_SENTINELS:
            break
        # Skip exact boilerplate tokens
        if s in BOILERPLATE_EXACT:
            continue
        # Skip the notice title (already stored separately)
        if s == title_norm:
            continue
        # Skip metadata prefix lines
        if s.startswith(BOILERPLATE_STARTS):
            continue
        # Skip regex-matched noise
        if any(p.match(s) for p in BOILERPLATE_PATTERNS):
            continue
        # Skip attachment filenames (already captured as structured links)
        if s in attachment_names:
            continue
        cleaned.append(s)

    return '\n'.join(cleaned).strip()


# ─── Attachment extraction ────────────────────────────────────────────────────
def extract_attachments(soup: BeautifulSoup, base_domain: str, list_url: str) -> list[dict]:
    """
    Find all attachment download links on the page.
    TU notice board uses URLs with mode=download in the query string.
    Some hrefs are query-string only (e.g. ?mode=download&...) — these
    must be resolved against the full list_url, not just the domain.
    Returns: [{'name': str, 'url': str}, ...]
    """
    attachments = []
    seen_urls: set[str] = set()

    for link in soup.find_all('a', href=True):
        href = link.get('href', '')
        if 'mode=download' not in href:
            continue

        # Build absolute URL
        if href.startswith('http'):
            abs_url = href
        elif href.startswith('?'):
            # Query-string-only href: append to the page base URL (strip its own query first)
            from urllib.parse import urlparse, urlunparse
            parsed = urlparse(list_url)
            base = urlunparse((parsed.scheme, parsed.netloc, parsed.path, '', '', ''))
            abs_url = base + href
        else:
            abs_url = urljoin(base_domain, href)

        if abs_url in seen_urls:
            continue
        seen_urls.add(abs_url)

        # Try to get a human-readable name from the link text
        name = link.get_text(strip=True)
        if not name:
            qs = parse_qs(urlparse(href).query)
            name = qs.get('attachNo', ['attachment'])[0]

        attachments.append({'name': name, 'url': abs_url})

    return attachments


# ─── DB helpers ──────────────────────────────────────────────────────────────
def ensure_attachments_column(conn: sqlite3.Connection) -> None:
    """Add the `attachments` column if it doesn't exist yet."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(notices)").fetchall()}
    if 'attachments' not in cols:
        conn.execute("ALTER TABLE notices ADD COLUMN attachments TEXT DEFAULT '[]'")
        conn.commit()
        log.info("Added `attachments` column to notices table.")


def get_notices(conn: sqlite3.Connection, fetch_all: bool) -> list[sqlite3.Row]:
    if fetch_all:
        return conn.execute(
            "SELECT id, notice_number, title, url FROM notices ORDER BY id"
        ).fetchall()
    return conn.execute(
        """SELECT id, notice_number, title, url
           FROM notices
           WHERE content IS NULL OR TRIM(content) = ''
           ORDER BY id"""
    ).fetchall()


def update_notice(
    conn: sqlite3.Connection,
    notice_id: int,
    content: str,
    images: str,
    attachments: str,   # JSON string
) -> None:
    conn.execute(
        "UPDATE notices SET content = ?, images = ?, attachments = ? WHERE id = ?",
        (content, images, attachments, notice_id)
    )
    conn.commit()


# ─── Main scrape logic ───────────────────────────────────────────────────────
def scrape_detail(session: requests.Session, url: str, title: str) -> dict:
    """
    Fetch one notice page. Returns:
        content     (str)  – clean body text only
        images      (str)  – comma-separated absolute image URLs
        attachments (str)  – JSON: [{'name': str, 'url': str}, ...]
    """
    try:
        response = session.get(url, timeout=30)
        response.raise_for_status()
    except requests.RequestException as exc:
        log.error(f"  HTTP error for {url}: {exc}")
        return {'content': '', 'images': '', 'attachments': '[]'}

    soup = BeautifulSoup(response.text, 'html.parser')

    # ── 1. Extract attachments (pass the notice URL as the base for ?-only hrefs) ─
    attachments = extract_attachments(soup, BASE_DOMAIN, url)
    attachment_names = {a['name'] for a in attachments}

    # ── 2. Strip known navigation elements from the soup before extraction ───
    # This prevents prev/next post link text from leaking into the body.
    NAV_SELECTORS = [
        ('div',  {'class': 'board_view_navi'}),
        ('div',  {'class': 'board_navi'}),
        ('div',  {'class': 'paging'}),
        ('div',  {'class': 'btn_wrap'}),
        ('ul',   {'class': 'board_view_navi'}),
        ('div',  {'class': 'file_wrap'}),      # attachment section (we capture these via links)
        ('div',  {'class': 'attach_area'}),
        ('div',  {'id':    'addFile'}),
    ]
    for tag, attrs in NAV_SELECTORS:
        for el in soup.find_all(tag, attrs):
            el.decompose()

    # ── 3. Locate the content container ──────────────────────────────────
    # Try narrower selectors first (body-only), then broader containers.
    content_div = (
        soup.find('div', class_='view_cont')        or   # iCMS body cell
        soup.find('td',  class_='view_cont')        or
        soup.find('div', class_='board_view_cont')  or
        soup.find('div', class_='cont_area')        or
        soup.find('div', class_='view-content')     or
        soup.find('div', class_='contents')         or
        soup.find('div', class_='board_view')       or
        soup.find('div', class_='board-view')       or
        soup.find('div', id='cms-content')          or
        soup.find('article')
    )

    if content_div:
        raw_text   = content_div.get_text(separator='\n', strip=True)
        raw_images = [
            img.get('src') for img in content_div.find_all('img')
            if img.get('src')
        ]
    else:
        log.warning(f"  No content container — falling back to <body>")
        body       = soup.body
        raw_text   = body.get_text(separator='\n', strip=True) if body else ''
        raw_images = [img.get('src') for img in (body or soup).find_all('img') if img.get('src')]

    # ── 4. Clean the body text ────────────────────────────────────────────
    clean = clean_body(raw_text, title, attachment_names)

    # ── 4. Make image URLs absolute ───────────────────────────────────────
    images = [
        urljoin(BASE_DOMAIN, src) if not src.startswith('http') else src
        for src in raw_images
    ]

    return {
        'content':     clean,
        'images':      ','.join(images),
        'attachments': json.dumps(attachments, ensure_ascii=False),
    }


# ─── Entry point ─────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='Scrape notice detail pages (clean content + attachments).')
    parser.add_argument('--all',   action='store_true', help='Re-scrape all notices.')
    parser.add_argument('--limit', type=int, default=None, help='Process at most N notices.')
    args = parser.parse_args()

    if not os.path.exists(DB_PATH):
        log.error(f"Database not found: {DB_PATH}")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    ensure_attachments_column(conn)

    notices = get_notices(conn, fetch_all=args.all)
    total   = len(notices)
    if args.limit:
        notices = notices[:args.limit]

    log.info(f"{'Re-scraping all' if args.all else 'Scraping missing'} "
             f"{len(notices)} / {total} notice(s)…")

    if not notices:
        log.info("Nothing to do. Use --all to force re-scrape.")
        conn.close()
        return

    session = requests.Session()
    session.headers.update(HEADERS)
    ok = skipped = errors = 0

    for i, row in enumerate(notices, 1):
        notice_id = row['id']
        title     = row['title'] or ''
        url       = row['url']   or ''

        log.info(f"[{i:>4}/{len(notices)}]  #{row['notice_number']:<6}  {title[:60]}")

        if not url:
            log.warning("  No URL — skipping.")
            skipped += 1
            continue

        detail = scrape_detail(session, url, title)

        attachments_list = json.loads(detail['attachments'])
        img_count        = len(detail['images'].split(',')) if detail['images'] else 0

        update_notice(conn, notice_id, detail['content'], detail['images'], detail['attachments'])
        log.info(
            f"  ✓  {len(detail['content']):,} chars | "
            f"{img_count} image(s) | "
            f"{len(attachments_list)} attachment(s)"
        )
        ok += 1
        time.sleep(DELAY)

    conn.close()
    print()
    print("=" * 55)
    print(f"  Done.  ✓ {ok} saved  |  ✗ {errors} failed  |  — {skipped} skipped")
    print("=" * 55)


if __name__ == "__main__":
    main()
