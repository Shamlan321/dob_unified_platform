"""
push_to_api.py
──────────────
Reads all notices from notices.db and pushes them to the BIC Pulse
ingest API endpoint in batches.

The endpoint uses INSERT OR IGNORE on source_url, so this script is
fully idempotent — safe to run multiple times. Already-ingested notices
are counted as duplicates and skipped server-side.

Usage:
    python push_to_api.py                        # push to localhost:3000 (default)
    python push_to_api.py --url http://...       # push to a custom base URL
    python push_to_api.py --secret my-secret     # provide ingest secret header
    python push_to_api.py --batch-size 50        # change batch size (default: 20)
    python push_to_api.py --dry-run              # show what would be sent, no requests made
"""

import sqlite3
import requests
import sys
import io
import os
import json
import argparse
import time

# ── UTF-8 console on Windows ─────────────────────────────────────────────────
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

DB_PATH          = os.path.join(os.path.dirname(__file__), 'notices.db')
DEFAULT_API_BASE = 'http://localhost:3000'
INGEST_ENDPOINT  = '/api/ingest/notices'

DIVIDER = '─' * 60


def fetch_all_notices(db_path: str) -> list[dict]:
    """Read every row from the scraped notices.db."""
    if not os.path.exists(db_path):
        print(f'[ERROR] notices.db not found at: {db_path}')
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    # Include attachments column if it exists
    cols = {row[1] for row in conn.execute("PRAGMA table_info(notices)").fetchall()}
    select_attachments = ", attachments" if 'attachments' in cols else ", '[]' as attachments"
    rows = conn.execute(
        f'SELECT notice_number, title, date_created, views, content, images{select_attachments}, url '
        'FROM notices ORDER BY CAST(notice_number AS INTEGER) DESC'
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def chunk(lst: list, size: int):
    """Split a list into chunks of the given size."""
    for i in range(0, len(lst), size):
        yield lst[i:i + size]


def transform_notice(row: dict) -> dict:
    """Map the scraper DB columns to the ingest API payload shape."""
    return {
        'notice_number': row.get('notice_number', ''),
        'title':         row.get('title', ''),
        'date':          row.get('date_created', ''),
        'views':         row.get('views', 0),
        'content':       row.get('content', ''),
        'images':        row.get('images', ''),
        'attachments':   row.get('attachments', '[]') or '[]',
        'url':           row.get('url', ''),
    }


def push_batch(
    session: requests.Session,
    endpoint: str,
    secret: str | None,
    notices: list[dict],
    dry_run: bool,
    upsert: bool = False,
) -> dict:
    """POST one batch to the ingest endpoint. Returns the response dict."""
    payload = {'notices': notices, 'upsert': upsert}

    if dry_run:
        print(f'  [DRY RUN] Would POST {len(notices)} notices to {endpoint} (upsert={upsert})')
        return {'inserted': 0, 'duplicates': 0, 'total': len(notices), 'results': []}

    headers = {'Content-Type': 'application/json'}
    if secret:
        headers['x-ingest-secret'] = secret

    resp = session.post(endpoint, json=payload, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.json()


def main():
    parser = argparse.ArgumentParser(description='Push scraped notices to BIC Pulse API.')
    parser.add_argument('--url',        default=DEFAULT_API_BASE,
                        help=f'Base URL of the BIC Pulse web app (default: {DEFAULT_API_BASE})')
    parser.add_argument('--secret',     default=os.environ.get('INGEST_SECRET', ''),
                        help='Value for x-ingest-secret header (or set INGEST_SECRET env var)')
    parser.add_argument('--batch-size', type=int, default=20,
                        help='Number of notices per POST request (default: 20)')
    parser.add_argument('--upsert',     action='store_true',
                        help='Update existing notices instead of skipping duplicates')
    parser.add_argument('--dry-run',    action='store_true',
                        help='Print what would be sent without making any requests')
    args = parser.parse_args()

    endpoint = args.url.rstrip('/') + INGEST_ENDPOINT

    print(DIVIDER)
    print('  BIC Pulse — Notice Push Script')
    print(DIVIDER)
    print(f'  Source DB : {DB_PATH}')
    print(f'  Endpoint  : {endpoint}')
    print(f'  Batch size: {args.batch_size}')
    print(f'  Dry run   : {args.dry_run}')
    print(f'  Upsert    : {args.upsert} {"(will overwrite existing)" if args.upsert else "(skip duplicates)"}')
    print(f'  Secret    : {"(set)" if args.secret else "(none — open endpoint)"}')
    print()

    notices = fetch_all_notices(DB_PATH)
    print(f'  Found {len(notices)} notices in notices.db')

    if not notices:
        print('  Nothing to push.')
        return

    transformed = [transform_notice(n) for n in notices]
    batches     = list(chunk(transformed, args.batch_size))

    print(f'  Sending in {len(batches)} batch(es) of up to {args.batch_size}...')
    print()

    session       = requests.Session()
    total_inserted   = 0
    total_duplicates = 0
    total_errors     = 0

    for i, batch in enumerate(batches, 1):
        try:
            result = push_batch(session, endpoint, args.secret or None, batch, args.dry_run, args.upsert)
            ins  = result.get('inserted',   0)
            dup  = result.get('duplicates', 0)
            total_inserted   += ins
            total_duplicates += dup
            print(f'  Batch {i:>2}/{len(batches)}  →  ✓ {ins} inserted  ·  {dup} duplicates')
        except requests.RequestException as exc:
            total_errors += 1
            print(f'  Batch {i:>2}/{len(batches)}  →  ✗ ERROR: {exc}')

        # Small delay to avoid hammering the dev server
        if i < len(batches):
            time.sleep(0.1)

    print()
    print(DIVIDER)
    print(f'  Done.')
    print(f'  ✓ Inserted  : {total_inserted}')
    print(f'  ~ Duplicates: {total_duplicates}')
    if total_errors:
        print(f'  ✗ Errors    : {total_errors}')
    print(DIVIDER)


if __name__ == '__main__':
    main()
