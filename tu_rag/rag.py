"""
Tongmyong University RAG — LlamaIndex + Gemini over the unified knowledge base.

Public API:
  build_index(md_path) -> VectorStoreIndex
  load_existing_index() -> VectorStoreIndex | None
  get_or_build_index() -> VectorStoreIndex
  ask(index, question, department=None) -> str
  ask_json(index, question, department=None) -> dict
  chat_loop(index)
"""
from __future__ import annotations

import io
import json
import os
import sys
from pathlib import Path
from typing import Optional

# ── Unicode-safe stdout (Windows cp1252 / PowerShell compat) ───────────────
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")  # type: ignore[assignment]
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")  # type: ignore[assignment]
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from dotenv import load_dotenv

# ── Load env BEFORE any LlamaIndex imports that need GOOGLE_API_KEY ─────────
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

if not os.getenv("GOOGLE_API_KEY"):
    sys.stderr.write(
        "ERROR: GOOGLE_API_KEY is not set. Copy .env.example to .env and fill it in,\n"
        "or set the env var in your shell.\n"
    )
    sys.exit(1)

from llama_index.core import Settings, VectorStoreIndex, StorageContext, load_index_from_storage
from knowledge import KnowledgeBase

STORAGE_DIR = BASE_DIR / "storage"
DEFAULT_MD = BASE_DIR.parent / "tu_data.md"
DEFAULT_DB = BASE_DIR.parent / "data" / "bic_pulse.db"

_DEFAULT_MODEL = "gemini-2.5-flash"
_DEFAULT_EMBED = "models/gemini-embedding-001"


def _init_llm_and_embeddings(model: str, embed_model: str) -> None:
    """Try the new google-genai backend first, fall back to deprecated gemini."""
    try:
        from llama_index.llms.google_genai import GoogleGenAI
        from llama_index.embeddings.google_genai import GoogleGenAIEmbedding

        llm_name = model.replace("models/", "", 1)
        emb_name = embed_model.replace("models/", "", 1)
        Settings.llm = GoogleGenAI(model=llm_name, temperature=0.2, max_tokens=2048)
        Settings.embed_model = GoogleGenAIEmbedding(model=emb_name, dimensions=768, embed_batch_size=10)
        return
    except Exception as exc_new:  # noqa: BLE001
        err_new = str(exc_new)
        import warnings
        warnings.warn(
            f"New google-genai backend unavailable ({err_new[:80]}), "
            "falling back to deprecated llama-index-llms-gemini.",
            stacklevel=2,
        )

    from llama_index.llms.gemini import Gemini
    from llama_index.embeddings.gemini import GeminiEmbedding

    Settings.llm = Gemini(model=model, temperature=0.2, max_tokens=2048)
    Settings.embed_model = GeminiEmbedding(model_name=embed_model)


def configure_models(model: str = _DEFAULT_MODEL, embed_model: str = _DEFAULT_EMBED) -> None:
    """Bind Gemini LLM + embedding backend into LlamaIndex global Settings."""
    _init_llm_and_embeddings(model, embed_model)
    Settings.chunk_size = 1024
    Settings.chunk_overlap = 128


_cached_kb: Optional[KnowledgeBase] = None


def _kb(log=None) -> KnowledgeBase:
    global _cached_kb
    if _cached_kb is None:
        _cached_kb = KnowledgeBase(
            storage_dir=STORAGE_DIR,
            handbook_path=DEFAULT_MD,
            db_path=DEFAULT_DB,
            log=log or (lambda msg: sys.stderr.write(msg + "\n")),
        )
    return _cached_kb


def _make_log(json_mode: bool):
    def _log(msg: str) -> None:
        if json_mode:
            sys.stderr.write(msg + "\n")
            sys.stderr.flush()
        else:
            print(msg)
    return _log


def build_index(
    md_path: str | Path = DEFAULT_MD,
    json_mode: bool = False,
) -> VectorStoreIndex:
    """Rebuild the unified index from handbook markdown + SQLite content_items."""
    global _cached_kb
    configure_models()
    _cached_kb = KnowledgeBase(
        storage_dir=STORAGE_DIR,
        handbook_path=Path(md_path).resolve(),
        db_path=DEFAULT_DB,
        log=_make_log(json_mode),
    )
    docs = _cached_kb.load_documents()
    index = _cached_kb.rebuild(docs)
    if json_mode:
        result = {"ok": True, "storage": str(STORAGE_DIR), "documents": len(docs)}
        sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    return index


def load_existing_index() -> Optional[VectorStoreIndex]:
    """Load a previously-built index from ./storage, or return None if missing."""
    if not STORAGE_DIR.exists():
        return None
    configure_models()
    ctx = StorageContext.from_defaults(persist_dir=str(STORAGE_DIR))
    return load_index_from_storage(ctx)


def get_or_build_index(
    md_path: str | Path = DEFAULT_MD,
    json_mode: bool = False,
) -> VectorStoreIndex:
    """Load cached index if present, then sync new/changed SQLite rows."""
    global _cached_kb
    configure_models()
    if _cached_kb is None:
        _cached_kb = KnowledgeBase(
            storage_dir=STORAGE_DIR,
            handbook_path=Path(md_path).resolve(),
            db_path=DEFAULT_DB,
            log=_make_log(json_mode),
        )
    return _cached_kb.get_or_sync_index()


def ask(
    index: VectorStoreIndex,
    question: str,
    show_sources: bool = True,
    department: Optional[str] = None,
) -> str:
    """Answer a single question using the unified knowledge base."""
    kb = _kb()
    result = kb.ask(index, question, department)
    answer = result["answer"]
    out = [f"\n💬  Answer:\n{answer}"]
    if show_sources and result.get("sources"):
        out.append("\n📚  Source chunks:")
        for i, src in enumerate(result["sources"], 1):
            preview = (src.get("preview") or "")[:220]
            out.append(f"  [{i}] {src.get('label')}: {preview}…")
    return "\n".join(out)


def ask_json(
    index: VectorStoreIndex,
    question: str,
    department: Optional[str] = None,
) -> dict:
    """Answer a question from the unified KB. Returns {answer, sources[]}."""
    return _kb().ask(index, question, department)


def chat_loop(index: VectorStoreIndex) -> None:
    """Run a simple read-eval-print loop until the user types /quit."""
    print("\n=== Tongmyong University RAG Chat ===")
    print("Type your question. Enter: /quit to exit, /index to rebuild index.\n")
    while True:
        try:
            q = input("❓  You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not q:
            continue
        if q.lower() in ("/quit", "/q", "/exit"):
            return
        if q.lower() in ("/index", "/rebuild"):
            print("Rebuilding index…")
            index = build_index()
            continue
        try:
            print(ask(index, q))
        except Exception as exc:  # noqa: BLE001
            print(f"\n⚠️  Error: {exc}")


def _extract_flag(argv: list[str], flag: str) -> tuple[list[str], Optional[str]]:
    if flag not in argv:
        return argv, None
    i = argv.index(flag)
    if i + 1 >= len(argv):
        sys.stderr.write(f"Missing value for {flag}\n")
        sys.exit(2)
    value = argv[i + 1]
    rest = argv[:i] + argv[i + 2 :]
    return rest, value


if __name__ == "__main__":
    json_mode = False
    argv = sys.argv[1:]
    if argv and argv[0] == "--json":
        json_mode = True
        argv = argv[1:]

    argv, department = _extract_flag(argv, "--department")

    target = DEFAULT_MD
    if len(argv) >= 1:
        arg = argv[0]
        if arg in ("-h", "--help"):
            help_msg = (
                "Usage:\n"
                "  python rag.py                      # interactive chat (auto-syncs index)\n"
                "  python rag.py build                # rebuild unified index, exit\n"
                "  python rag.py build <md_file>      # rebuild using a different handbook file\n"
                "  python rag.py ask \"question\"       # answer a single question and exit\n"
                "  python rag.py ask \"question\" --department \"Computer Engineering\"\n"
                "  python rag.py --json build         # rebuild, JSON result on stdout\n"
                "  python rag.py --json ask \"ques\"    # answer as JSON on stdout\n"
            )
            if json_mode:
                sys.stderr.write(help_msg)
            else:
                print(help_msg)
            sys.exit(0)
        if arg == "build":
            if len(argv) >= 2:
                target = Path(argv[1])
            build_index(target, json_mode=json_mode)
            sys.exit(0)
        if arg == "ask":
            if len(argv) < 2:
                sys.stderr.write("Usage: python rag.py ask \"your question\" [--department NAME]\n")
                sys.exit(2)
            question = argv[1]
            idx = get_or_build_index(json_mode=json_mode)
            if json_mode:
                result = ask_json(idx, question, department=department)
                sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
                sys.stdout.flush()
            else:
                print(ask(idx, question, department=department))
            sys.exit(0)

    idx = get_or_build_index(target)
    chat_loop(idx)
