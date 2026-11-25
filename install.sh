#!/usr/bin/env bash
# BIC Pulse — install + initialize on a fresh Ubuntu.
#
#   git clone https://github.com/Shamlan321/dob_unified_platform.git bic-pulse
#   cd bic-pulse && bash install.sh
#
# Optional: GOOGLE_API_KEY=... bash install.sh   (otherwise you are prompted)
# Safe to re-run: existing env files and data are kept.
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
PORT=3000
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

# ── 1. System packages ──────────────────────────────────────────────────────
log "Installing system packages"
$SUDO apt-get update -y
$SUDO apt-get install -y curl ca-certificates git build-essential python3 python3-pip openssl

# ── 2. Node.js (Next 16 needs >= 20.9) ──────────────────────────────────────
node_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=9)?0:1)'; }
if ! node_ok; then
  log "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi
echo "node $(node -v), npm $(npm -v)"

# ── 3. Python packages (system Python, as the app spawns `python3`) ─────────
log "Installing Python packages"
python3 -m pip install --break-system-packages -r tu_rag/requirements.txt -r python-scrapper/requirements.txt

# ── 4. Node packages + production build ─────────────────────────────────────
log "Installing npm packages"
npm ci

# ── 5. Env files (never overwritten) ────────────────────────────────────────
if [ ! -f .env.local ]; then
  log "Creating .env.local with a random INGEST_SECRET"
  printf 'INGEST_SECRET=%s\n' "$(openssl rand -hex 24)" > .env.local
fi
INGEST_SECRET="$(grep -E '^INGEST_SECRET=' .env.local | cut -d= -f2- || true)"

if [ ! -f tu_rag/.env ]; then
  if [ -z "${GOOGLE_API_KEY:-}" ] && [ -t 0 ]; then
    read -r -p "Google Gemini API key (blank = skip AI setup for now): " GOOGLE_API_KEY
  fi
  if [ -n "${GOOGLE_API_KEY:-}" ]; then
    printf 'GOOGLE_API_KEY=%s\n' "$GOOGLE_API_KEY" > tu_rag/.env
    chmod 600 tu_rag/.env
  fi
fi
chmod 600 .env.local

log "Building Next.js app"
npm run build

# ── 6. Initialize data: start app, scrape notices, build AI index ───────────
mkdir -p data
log "Starting app temporarily on :$PORT to ingest notices"
npx next start -p "$PORT" > data/install-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  curl -fs "http://localhost:$PORT/api/notices?limit=1" >/dev/null && break
  sleep 1
done
curl -fs "http://localhost:$PORT/api/notices?limit=1" >/dev/null \
  || { echo "App did not start — see data/install-server.log"; exit 1; }

log "Scraping BIC notices (tu.ac.kr) and pushing them into the app"
(cd python-scrapper && python3 run_pipeline.py --url "http://localhost:$PORT" --secret "$INGEST_SECRET") \
  || echo "WARNING: scraper failed — retry later from /admin"

kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
trap - EXIT

if [ -f tu_rag/.env ]; then
  log "Building AI vector index (Gemini embeddings)"
  (cd tu_rag && python3 rag.py build) || echo "WARNING: AI index build failed — retry from /admin"
else
  echo "Skipped AI index: no GOOGLE_API_KEY. Add it to tu_rag/.env, then run: cd tu_rag && python3 rag.py build"
fi

# ── Done ────────────────────────────────────────────────────────────────────
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

✅ BIC Pulse is installed.

Start it:        cd $ROOT && npm start          (http://${IP:-localhost}:$PORT)
Admin panel:     http://${IP:-localhost}:$PORT/admin
The AI server (port 8001) and the daily scraper start automatically from the app.

KakaoDump2 (Android) relay settings:
  Base URL:      http://${IP:-<server-ip>}:$PORT
  Ingest secret: $INGEST_SECRET
EOF
