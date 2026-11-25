import sqlite3
import sys
import io
import os

# Force UTF-8 on Windows Console
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

DB_PATH = os.path.join(os.path.dirname(__file__), 'notices.db')

DIVIDER  = "=" * 70
SECTION  = "-" * 70

def connect():
    if not os.path.exists(DB_PATH):
        print(f"[ERROR] Database not found at: {DB_PATH}")
        sys.exit(1)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def section(title: str):
    print(f"\n{DIVIDER}")
    print(f"  {title}")
    print(DIVIDER)

# ─── 1. Tables ──────────────────────────────────────────────────────────────
def show_tables(conn):
    section("DATABASE TABLES")
    tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    if not tables:
        print("  No tables found.")
        return []
    names = [t['name'] for t in tables]
    for name in names:
        print(f"  • {name}")
    return names

# ─── 2. Schema ──────────────────────────────────────────────────────────────
def show_schema(conn, table: str):
    section(f"SCHEMA  ›  {table}")
    cols = conn.execute(f"PRAGMA table_info({table})").fetchall()
    header = f"  {'cid':<4}  {'name':<20}  {'type':<15}  {'notnull':<8}  {'default':<15}  {'pk'}"
    print(header)
    print(f"  {SECTION}")
    for c in cols:
        print(f"  {c['cid']:<4}  {c['name']:<20}  {c['type']:<15}  {c['notnull']:<8}  {str(c['dflt_value']):<15}  {c['pk']}")

# ─── 3. Row count ───────────────────────────────────────────────────────────
def show_row_count(conn, table: str):
    section(f"ROW COUNT  ›  {table}")
    count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    print(f"  Total rows: {count:,}")
    return count

# ─── 4. Field statistics ────────────────────────────────────────────────────
def show_field_stats(conn, table: str, total: int):
    section(f"FIELD STATISTICS  ›  {table}")
    if total == 0:
        print("  No rows to analyse.")
        return

    cols = [c['name'] for c in conn.execute(f"PRAGMA table_info({table})").fetchall()]

    print(f"  {'Column':<22}  {'Non-NULL':>8}  {'Empty/blank':>12}  {'Coverage':>10}")
    print(f"  {SECTION}")

    for col in cols:
        non_null = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE {col} IS NOT NULL"
        ).fetchone()[0]

        # Count truly blank strings (for TEXT columns)
        empty = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE TYPEOF({col})='text' AND TRIM({col})=''"
        ).fetchone()[0]

        coverage = (non_null / total) * 100 if total else 0
        print(f"  {col:<22}  {non_null:>8,}  {empty:>12,}  {coverage:>9.1f}%")

# ─── 5. Content-length distribution ─────────────────────────────────────────
def show_content_lengths(conn, table: str):
    section(f"CONTENT LENGTH DISTRIBUTION  ›  {table}")
    rows = conn.execute(
        f"SELECT LENGTH(content) AS len FROM {table} WHERE content IS NOT NULL ORDER BY len"
    ).fetchall()

    if not rows:
        print("  No content data found.")
        return

    lengths = [r['len'] for r in rows]
    n = len(lengths)
    print(f"  Rows with content : {n:,}")
    print(f"  Min length        : {min(lengths):,} chars")
    print(f"  Max length        : {max(lengths):,} chars")
    print(f"  Avg length        : {sum(lengths) // n:,} chars")
    print(f"  Median length     : {lengths[n // 2]:,} chars")

    buckets = [0] * 5  # <100, 100-499, 500-1999, 2000-4999, 5000+
    labels  = ["< 100", "100 – 499", "500 – 1999", "2000 – 4999", "5000+"]
    thresholds = [100, 500, 2000, 5000]
    for l in lengths:
        if   l < 100:   buckets[0] += 1
        elif l < 500:   buckets[1] += 1
        elif l < 2000:  buckets[2] += 1
        elif l < 5000:  buckets[3] += 1
        else:           buckets[4] += 1

    print(f"\n  {'Range':<14}  {'Count':>7}  Bar")
    print(f"  {SECTION}")
    max_b = max(buckets) or 1
    for label, b in zip(labels, buckets):
        bar = "█" * int((b / max_b) * 30)
        print(f"  {label:<14}  {b:>7,}  {bar}")

# ─── 6. Sample rows ─────────────────────────────────────────────────────────
def show_sample_rows(conn, table: str, n: int = 5):
    section(f"SAMPLE ROWS  ›  {table}  (first {n})")
    rows = conn.execute(f"SELECT * FROM {table} LIMIT {n}").fetchall()
    if not rows:
        print("  No rows found.")
        return

    for i, row in enumerate(rows, 1):
        print(f"\n  ── Record {i} ──────────────────────────────────────────")
        for key in row.keys():
            val = row[key]
            if isinstance(val, str) and len(val) > 200:
                val = val[:200].replace('\n', ' ') + "  …[truncated]"
            print(f"    {key:<20}: {val}")

# ─── 7. Notices with no content ─────────────────────────────────────────────
def show_missing_content(conn, table: str):
    section(f"NOTICES WITH MISSING / EMPTY CONTENT  ›  {table}")
    rows = conn.execute(
        f"""SELECT id, notice_number, title, url
            FROM {table}
            WHERE content IS NULL OR TRIM(content) = ''
            ORDER BY id
            LIMIT 20"""
    ).fetchall()

    if not rows:
        print("  All notices have some content. ✓")
        return

    count = conn.execute(
        f"SELECT COUNT(*) FROM {table} WHERE content IS NULL OR TRIM(content) = ''"
    ).fetchone()[0]

    print(f"  Total with no content: {count:,}  (showing first 20)\n")
    for r in rows:
        title = (r['title'] or '')[:55]
        print(f"  [{r['id']:>4}] #{r['notice_number']:<6}  {title:<57}  {r['url']}")

# ─── 8. Date range ──────────────────────────────────────────────────────────
def show_date_range(conn, table: str):
    section(f"DATE RANGE  ›  {table}")
    result = conn.execute(
        f"SELECT MIN(date_created) AS earliest, MAX(date_created) AS latest FROM {table}"
    ).fetchone()
    if result:
        print(f"  Earliest : {result['earliest']}")
        print(f"  Latest   : {result['latest']}")

# ─── 9. Image stats ─────────────────────────────────────────────────────────
def show_image_stats(conn, table: str):
    section(f"IMAGE STATISTICS  ›  {table}")
    rows = conn.execute(
        f"SELECT images FROM {table} WHERE images IS NOT NULL AND TRIM(images) != ''"
    ).fetchall()

    total_with_images = len(rows)
    total_images = sum(len(r['images'].split(',')) for r in rows)
    print(f"  Notices that have images : {total_with_images:,}")
    print(f"  Total image URLs stored  : {total_images:,}")

# ─── Main ───────────────────────────────────────────────────────────────────
def main():
    print(DIVIDER)
    print(f"  NOTICES DATABASE EXPLORER")
    print(f"  File: {DB_PATH}  ({os.path.getsize(DB_PATH):,} bytes)")
    print(DIVIDER)

    conn = connect()

    # Internal SQLite system tables to skip
    SKIP_TABLES = {'sqlite_sequence', 'sqlite_stat1', 'sqlite_master'}

    tables = show_tables(conn)
    for table in tables:
        if table in SKIP_TABLES:
            continue
        show_schema(conn, table)
        total = show_row_count(conn, table)
        if total > 0:
            show_field_stats(conn, table, total)
            # Only call column-specific helpers if the column exists
            col_names = {c['name'] for c in conn.execute(f'PRAGMA table_info({table})').fetchall()}
            if 'date_created' in col_names:
                show_date_range(conn, table)
            if 'images' in col_names:
                show_image_stats(conn, table)
            if 'content' in col_names:
                show_content_lengths(conn, table)
                show_missing_content(conn, table)
            show_sample_rows(conn, table, n=3)

    print(f"\n{DIVIDER}")
    print("  Exploration complete.")
    print(DIVIDER)
    conn.close()

if __name__ == "__main__":
    main()
