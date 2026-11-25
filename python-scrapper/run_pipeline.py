"""
run_pipeline.py
───────────────
Unified runner for the BIC notice scraping & push pipeline.
Executes:
  1. scrape_notice.py   (fetch notice list from tu.ac.kr)
  2. scrape_details.py  (fetch clean body, images, attachments for new notices)
  3. push_to_api.py     (push notices to BIC Pulse web app via /api/ingest/notices)

Usage:
  python run_pipeline.py                      # One-shot run with defaults
  python run_pipeline.py --url http://...     # Custom web app URL
  python run_pipeline.py --daemon --interval-hours 24  # Run continuously every 24 hours
"""

import argparse
import io
import json
import os
import subprocess
import sys
import time
from datetime import datetime

# Windows console UTF-8 fix
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
STATUS_FILE = os.path.join(CURRENT_DIR, 'scraper_status.json')


def write_status(state: str, message: str, details: dict = None):
    data = {
        'state': state,
        'message': message,
        'timestamp': datetime.now().isoformat(),
        'details': details or {},
    }
    try:
        with open(STATUS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[WARN] Failed to write status file: {e}", file=sys.stderr)


def run_command(cmd_args: list[str], description: str) -> tuple[bool, str]:
    print(f"\n▶ [{datetime.now().strftime('%H:%M:%S')}] {description}...")
    sys.stdout.flush()
    try:
        proc = subprocess.Popen(
            cmd_args,
            cwd=CURRENT_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='replace',
        )
        lines = []
        for line in proc.stdout:
            sys.stdout.write(f"  {line}")
            sys.stdout.flush()
            lines.append(line)
        proc.wait()
        output = "".join(lines)
        if proc.returncode != 0:
            print(f"✗ {description} exited with code {proc.returncode}")
            return False, output
        print(f"✓ {description} completed successfully.")
        return True, output
    except Exception as exc:
        err_msg = f"Failed to execute {description}: {exc}"
        print(f"✗ {err_msg}")
        return False, err_msg


def execute_cycle(api_url: str, secret: str = None, upsert: bool = False) -> bool:
    start_time = datetime.now()
    write_status('running', f"Scrape cycle started at {start_time.isoformat()}")

    python_bin = sys.executable

    # 1. Scrape notice list
    ok, out1 = run_command([python_bin, 'scrape_notice.py'], "Step 1: Scrape notice list")
    if not ok:
        write_status('failed', "Failed at Step 1 (scrape_notice.py)", {'error': out1[-500:]})
        return False

    # 2. Scrape details for new notices
    ok, out2 = run_command([python_bin, 'scrape_details.py'], "Step 2: Scrape notice details")
    if not ok:
        write_status('failed', "Failed at Step 2 (scrape_details.py)", {'error': out2[-500:]})
        return False

    # 3. Push to Web App API
    push_args = [python_bin, 'push_to_api.py', '--url', api_url]
    if secret:
        push_args.extend(['--secret', secret])
    if upsert:
        push_args.append('--upsert')

    ok, out3 = run_command(push_args, "Step 3: Push to web app API")
    if not ok:
        write_status('failed', "Failed at Step 3 (push_to_api.py)", {'error': out3[-500:]})
        return False

    elapsed = (datetime.now() - start_time).total_seconds()
    summary = f"Scrape cycle finished in {elapsed:.1f}s at {datetime.now().isoformat()}"
    print(f"\n🎉 {summary}\n")
    write_status('success', summary, {'elapsed_seconds': elapsed})
    return True


def main():
    parser = argparse.ArgumentParser(description="BIC Pulse Unified Scraper Pipeline")
    parser.add_argument('--url', default='http://localhost:3000', help="Web app base URL")
    parser.add_argument('--secret', default='', help="Ingest secret header if configured")
    parser.add_argument('--upsert', action='store_true', help="Force overwrite existing notices")
    parser.add_argument('--daemon', action='store_true', help="Run continuously on an interval")
    parser.add_argument('--interval-hours', type=float, default=24.0, help="Interval in hours for daemon mode")

    args = parser.parse_args()

    if not args.daemon:
        success = execute_cycle(args.url, args.secret, args.upsert)
        sys.exit(0 if success else 1)

    print(f"Starting Scraper Daemon. Interval: every {args.interval_hours} hour(s)...")
    interval_sec = max(60, int(args.interval_hours * 3600))
    while True:
        try:
            execute_cycle(args.url, args.secret, args.upsert)
        except Exception as e:
            print(f"[ERROR in daemon cycle]: {e}", file=sys.stderr)
            write_status('error', f"Exception in cycle: {e}")

        print(f"Sleeping for {args.interval_hours} hour(s) ({interval_sec} seconds)...")
        time.sleep(interval_sec)


if __name__ == '__main__':
    main()
