import sqlite3, json, os, sys, io

if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DB = os.path.join(os.path.dirname(__file__), 'data', 'bic_pulse.db')
conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

row = conn.execute(
    "SELECT title, raw_text, extra FROM content_items ORDER BY published_at DESC LIMIT 1"
).fetchone()

extra = json.loads(row['extra'])

print("=" * 60)
print("TITLE:", row['title'])
print("=" * 60)
print("\nBODY TEXT:")
print(row['raw_text'])
print("\nATTACHMENTS:", json.dumps(extra.get('attachments', []), indent=2, ensure_ascii=False))
print("VIEWS:", extra.get('views'))
conn.close()
