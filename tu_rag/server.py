"""
tu_rag/server.py
────────────────
Persistent, in-memory FastAPI server for BIC AI.
Maintains the VectorStoreIndex, KnowledgeBase, and Gemini connection
hot in memory, reducing chat query latency from ~14s (cold CLI) down to ~2-3s.
"""

from __future__ import annotations

import io
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

# Windows UTF-8 stdout
if sys.platform == 'win32':
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
load_dotenv(BASE_DIR / ".env")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from rag import get_or_build_index, build_index, ask_json, _kb

# Global in-memory index
index_holder = {"index": None, "ready": False, "started_at": 0.0}


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[{time.strftime('%H:%M:%S')}] [SERVER] Initializing BIC AI models and loading index into memory...")
    t0 = time.time()
    try:
        idx = get_or_build_index()
        index_holder["index"] = idx
        index_holder["ready"] = True
        index_holder["started_at"] = time.time()
        elapsed = round(time.time() - t0, 2)
        print(f"[{time.strftime('%H:%M:%S')}] [SERVER] ✅ BIC AI hot in-memory index ready in {elapsed}s on http://127.0.0.1:8001")
    except Exception as exc:
        print(f"[{time.strftime('%H:%M:%S')}] [SERVER] ⚠️ Warning: Failed to pre-load index on startup: {exc}")
    yield
    print(f"[{time.strftime('%H:%M:%S')}] [SERVER] Shutting down BIC AI server.")


app = FastAPI(title="BIC AI In-Memory RAG Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AskRequest(BaseModel):
    question: str
    department: Optional[str] = None


class SyncRequest(BaseModel):
    rebuild: bool = False


@app.get("/health")
def health_check():
    kb = _kb()
    doc_count = len(kb._live_docs) if hasattr(kb, "_live_docs") and kb._live_docs else 0
    return {
        "status": "ok",
        "ready": index_holder["ready"],
        "uptime_seconds": round(time.time() - index_holder["started_at"], 1) if index_holder["started_at"] else 0,
        "cached_docs": doc_count,
    }


@app.post("/ask")
def ask_endpoint(req: AskRequest):
    q = (req.question or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Missing or empty 'question'")

    idx = index_holder["index"]
    if idx is None or not index_holder["ready"]:
        t0_sync = time.time()
        print(f"[{time.strftime('%H:%M:%S')}] [SERVER] Index not loaded yet; initializing on-demand...")
        idx = get_or_build_index()
        index_holder["index"] = idx
        index_holder["ready"] = True
        index_holder["started_at"] = time.time()
        print(f"[{time.strftime('%H:%M:%S')}] [SERVER] Index loaded on-demand in {round(time.time()-t0_sync, 2)}s")

    t0 = time.time()
    dept = (req.department or "").strip() or None
    try:
        result = ask_json(idx, q, department=dept)
        elapsed_ms = round((time.time() - t0) * 1000, 1)
        sources_cnt = len(result.get("sources", []))
        attach_cnt = len(result.get("attachments", []))
        print(
            f"[{time.strftime('%H:%M:%S')}] [AI QUERY] '{q[:40]}...' "
            f"-> {elapsed_ms}ms (sources: {sources_cnt}, attachments: {attach_cnt}, dept: {dept or 'public'})"
        )
        sys.stdout.flush()
        return {
            **result,
            "server_latency_ms": elapsed_ms,
        }
    except Exception as exc:
        err_msg = str(exc)
        print(f"[{time.strftime('%H:%M:%S')}] [SERVER ERROR] {err_msg}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=err_msg)


@app.post("/sync")
def sync_endpoint(req: SyncRequest = SyncRequest()):
    t0 = time.time()
    try:
        if req.rebuild:
            print(f"[{time.strftime('%H:%M:%S')}] [SERVER] Force rebuilding vector index...")
            idx = build_index()
        else:
            print(f"[{time.strftime('%H:%M:%S')}] [SERVER] Incrementally syncing vector index...")
            idx = get_or_build_index()
        index_holder["index"] = idx
        index_holder["ready"] = True
        elapsed_s = round(time.time() - t0, 2)
        return {"ok": True, "message": f"Index synced in {elapsed_s}s", "rebuilt": req.rebuild}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AI_SERVER_PORT", "8001"))
    print(f"Starting BIC AI Server on 127.0.0.1:{port}...", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
