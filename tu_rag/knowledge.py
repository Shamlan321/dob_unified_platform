"""Unified knowledge base for BIC Pulse.

All student-facing facts live here as LlamaIndex documents with a shared
metadata schema:

  university_info      — handbook markdown (tu_data.md)
  bic_notices          — public notices from SQLite content_items
  kakao_announcement   — department-gated Kakao messages from SQLite

Query-time access control keeps gated Kakao rows out unless the caller's
department matches. Notices and announcements are recency-boosted so
upcoming events and fresh deadlines outrank stale handbook text.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from llama_index.core import PromptTemplate, StorageContext, VectorStoreIndex, load_index_from_storage
from llama_index.core.node_parser import MarkdownNodeParser, SentenceSplitter
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.core.retrievers import BaseRetriever
from llama_index.core.schema import (
    Document,
    NodeRelationship,
    NodeWithScore,
    QueryBundle,
    RelatedNodeInfo,
    TextNode,
)

SCHEMA_VERSION = 2
MANIFEST_NAME = "kb_manifest.json"

SOURCE_HANDBOOK = "university_info"
SOURCE_NOTICE = "bic_notices"
SOURCE_KAKAO = "kakao_announcement"

PUBLIC_SOURCES = {SOURCE_HANDBOOK, SOURCE_NOTICE}

VECTOR_CANDIDATES = 24
FINAL_TOP_K = 8
LEXICAL_RECENT = 40
MAX_BODY_CHARS = 12_000

_STOP = {
    "the", "a", "an", "is", "are", "was", "were", "what", "when", "where",
    "how", "does", "do", "did", "of", "for", "to", "in", "on", "and", "or",
    "my", "your", "our", "any", "about", "with", "from", "this", "that",
    "latest", "please", "tell", "me",
}

_QA_TMPL = PromptTemplate(
    "You are BIC Pulse, the Tongmyong University student assistant.\n"
    "Today's date is {today}.\n"
    "Student access scope: {scope}.\n\n"
    "You answer from ONE unified knowledge base that contains:\n"
    "1) University handbook (standing institutional facts)\n"
    "2) Official public notices (events, deadlines, academic calendar)\n"
    "3) Department Kakao announcements (only if they appear in the context)\n\n"
    "Rules:\n"
    "- For schedules, events, deadlines, registration, exams, or 'what's happening', "
    "prefer the newest notices and announcements over older handbook text.\n"
    "- If a newer notice conflicts with the handbook, trust the notice and mention its date.\n"
    "- If relevant notices contain attached files or manuals, mention their names and note that direct download links are provided below.\n"
    "- Never invent events, dates, or department messages that are not in the context.\n"
    "- If the context has no relevant notice/announcement, say so and answer from the handbook if possible.\n"
    "- Do not mention access-control internals.\n\n"
    "Context:\n{context_str}\n\n"
    "Question: {query_str}\n\n"
    "Answer:"
)

LogFn = Callable[[str], None]


def default_log(msg: str) -> None:
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def _norm_dept(value: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def departments_match(stored: Optional[str], requested: Optional[str]) -> bool:
    a, b = _norm_dept(stored), _norm_dept(requested)
    if not a or not b:
        return False
    return a == b or a in b or b in a


def parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text[:32])
    except ValueError:
        pass
    for fmt, width in (("%Y-%m-%d %H:%M:%S", 19), ("%Y-%m-%dT%H:%M:%S", 19), ("%Y-%m-%d", 10)):
        try:
            return datetime.strptime(text[:width], fmt)
        except ValueError:
            continue
    return None


def recency_weight(published_at: Optional[str], now: datetime, source: str) -> float:
    """1.0 for upcoming/today; decays for older live posts. Handbook stays mid-weight."""
    if source == SOURCE_HANDBOOK:
        return 0.38
    dt = parse_dt(published_at)
    if dt is None:
        return 0.15
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    days = (now - dt).total_seconds() / 86400.0
    if days < 0:
        return 1.0
    return math.exp(-days / 90.0)


def _tokens(text: str) -> set[str]:
    return {
        t for t in re.findall(r"[A-Za-z0-9가-힣]{2,}", (text or "").lower())
        if t not in _STOP
    }


def _fingerprint(text: str, metadata: dict) -> str:
    payload = json.dumps(
        {"text": text, "title": metadata.get("title"), "published_at": metadata.get("published_at")},
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _source_label(source: str, title: str, department: Optional[str]) -> str:
    short = (title or "Untitled").strip()
    if len(short) > 72:
        short = short[:69] + "…"
    if source == SOURCE_NOTICE:
        return f"Notice · {short}"
    if source == SOURCE_KAKAO:
        dept = department or "Department"
        return f"Announcement · {dept} · {short}"
    return f"Handbook · {short}"


class KnowledgeBase:
    def __init__(
        self,
        *,
        storage_dir: Path,
        handbook_path: Path,
        db_path: Path,
        log: LogFn = default_log,
    ) -> None:
        self.storage_dir = storage_dir
        self.handbook_path = handbook_path
        self.db_path = db_path
        self.log = log
        self._md_parser = MarkdownNodeParser()
        self._sent_parser = SentenceSplitter(chunk_size=1024, chunk_overlap=128)
        self._live_docs: list[Document] = []

    @property
    def manifest_path(self) -> Path:
        return self.storage_dir / MANIFEST_NAME

    def load_documents(self) -> list[Document]:
        docs: list[Document] = []
        handbook = self._handbook_document()
        if handbook is not None:
            docs.append(handbook)
        live = self._sqlite_documents()
        self._live_docs = live
        docs.extend(live)
        return docs

    def get_or_sync_index(self) -> VectorStoreIndex:
        docs = self.load_documents()
        manifest = self._read_manifest()
        if manifest.get("schema_version") != SCHEMA_VERSION or not self._storage_ready():
            self.log("[kb] Building unified index (schema mismatch or empty storage)…")
            return self.rebuild(docs)

        try:
            ctx = StorageContext.from_defaults(persist_dir=str(self.storage_dir))
            index = load_index_from_storage(ctx)
        except Exception as exc:  # noqa: BLE001
            self.log(f"[kb] Failed to load storage ({exc}); rebuilding.")
            return self.rebuild(docs)

        return self._sync(index, docs, manifest)

    def rebuild(self, docs: Optional[list[Document]] = None) -> VectorStoreIndex:
        if docs is None:
            docs = self.load_documents()
        return self._rebuild(docs)

    def ask(self, index: VectorStoreIndex, question: str, department: Optional[str] = None) -> dict:
        t0 = time.time()
        now = datetime.now()
        retriever = _UnifiedRetriever(
            index=index,
            department=department,
            live_docs=self._live_docs or [d for d in self.load_documents() if d.metadata.get("source") != SOURCE_HANDBOOK],
            now=now,
        )
        scope = (
            f"signed in as {department} — public handbook + notices + that department's announcements"
            if department
            else "signed out — public handbook and notices only"
        )
        engine = RetrieverQueryEngine.from_args(
            retriever,
            text_qa_template=_QA_TMPL.partial_format(
                today=now.strftime("%Y-%m-%d"),
                scope=scope,
            ),
            response_mode="compact",
            similarity_top_k=FINAL_TOP_K,
        )

        resp = engine.query(question)
        total_time_ms = round((time.time() - t0) * 1000, 1)
        answer = str(resp).strip() or "(no answer generated)"

        sources: list[dict] = []
        all_attachments: list[dict] = []
        seen_sources: set[str] = set()
        seen_attachments: set[str] = set()

        if getattr(resp, "source_nodes", None):
            for node in resp.source_nodes:
                meta = dict(getattr(node.node, "metadata", None) or {})
                item_id = meta.get("item_id") or ""
                source_url = meta.get("source_url") or ""
                title = meta.get("title") or ""
                src_type = meta.get("source") or SOURCE_HANDBOOK
                label = meta.get("label") or _source_label(
                    src_type,
                    title,
                    meta.get("department"),
                )
                if label in seen_sources:
                    continue
                seen_sources.add(label)
                preview = node.node.get_content().replace("\n", " ")[:160]

                node_attachments = meta.get("attachments") or []
                for att in node_attachments:
                    if isinstance(att, dict) and att.get("url") and att.get("url") not in seen_attachments:
                        seen_attachments.add(att["url"])
                        all_attachments.append({
                            "name": att.get("name") or "Download Attachment",
                            "url": att["url"],
                            "source_title": title,
                        })

                sources.append({
                    "label": label,
                    "preview": preview,
                    "source": src_type,
                    "item_id": item_id,
                    "title": title,
                    "source_url": source_url,
                    "attachments": node_attachments,
                })

        self.log(f"[AI TIMING] Query: '{question[:40]}...' answered in {total_time_ms}ms with {len(sources)} source(s), {len(all_attachments)} attachment(s)")
        return {
            "answer": answer,
            "sources": sources,
            "attachments": all_attachments,
            "timing_ms": total_time_ms,
        }

    def _handbook_document(self) -> Optional[Document]:
        path = self.handbook_path
        if not path.exists():
            self.log(f"[kb] Handbook missing: {path}")
            return None
        text = path.read_text(encoding="utf-8")
        meta = {
            "source": SOURCE_HANDBOOK,
            "is_gated": 0,
            "department": "",
            "title": "Tongmyong University handbook",
            "published_at": "",
            "item_id": "tu_data",
            "source_url": str(path),
            "label": "Handbook · Tongmyong University",
        }
        return self._document("kb:university_info:tu_data.md", text, meta)

    def _sqlite_documents(self) -> list[Document]:
        if not self.db_path.exists():
            self.log(f"[kb] SQLite DB not found: {self.db_path}")
            return []

        conn = sqlite3.connect(str(self.db_path), timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                """
                SELECT id, source, is_gated, department, title, raw_text,
                       source_url, published_at, scraped_at, extra
                FROM content_items
                WHERE source IN (?, ?, ?)
                ORDER BY published_at DESC
                """,
                (SOURCE_NOTICE, SOURCE_KAKAO, SOURCE_HANDBOOK),
            ).fetchall()
        except sqlite3.Error as exc:
            self.log(f"[kb] SQLite read failed: {exc}")
            return []
        finally:
            conn.close()

        docs: list[Document] = []
        for row in rows:
            title = (row["title"] or "").strip()
            body = (row["raw_text"] or "").strip()
            if not title and not body:
                continue
            body = body[:MAX_BODY_CHARS]
            source = row["source"]
            department = row["department"] or ""
            published = row["published_at"] or ""
            kind = {
                SOURCE_NOTICE: "Official university notice",
                SOURCE_KAKAO: "Department Kakao announcement",
                SOURCE_HANDBOOK: "University information record",
            }.get(source, source)

            extra_raw = row["extra"] or "{}"
            attachments: list[dict] = []
            try:
                extra_data = json.loads(extra_raw)
                raw_att = extra_data.get("attachments")
                if isinstance(raw_att, list):
                    attachments = [a for a in raw_att if isinstance(a, dict) and a.get("url")]
                elif isinstance(raw_att, str):
                    parsed_att = json.loads(raw_att)
                    if isinstance(parsed_att, list):
                        attachments = [a for a in parsed_att if isinstance(a, dict) and a.get("url")]
            except Exception:
                attachments = []

            attach_desc = ""
            if attachments:
                file_names = [a.get("name", "Document") for a in attachments if a.get("name")]
                if file_names:
                    attach_desc = "\nAttachments available for direct download:\n" + "\n".join(f"- {n}" for n in file_names) + "\n"

            text = (
                f"# {title or '(untitled)'}\n\n"
                f"Kind: {kind}\n"
                f"Published: {published}\n"
                f"Department: {department or 'Public'}\n"
                f"URL: {row['source_url'] or ''}\n"
                f"{attach_desc}\n"
                f"{body}"
            )
            meta = {
                "source": source,
                "is_gated": int(row["is_gated"] or 0),
                "department": department,
                "title": title or "(untitled)",
                "published_at": published,
                "item_id": row["id"],
                "source_url": row["source_url"] or "",
                "label": _source_label(source, title, department),
                "attachments": attachments,
            }
            docs.append(self._document(f"kb:{source}:{row['id']}", text, meta))
        self.log(f"[kb] Loaded {len(docs)} live content_items from SQLite.")
        return docs

    def _document(self, doc_id: str, text: str, metadata: dict) -> Document:
        keys = list(metadata.keys())
        return Document(
            id_=doc_id,
            text=text,
            metadata=metadata,
            excluded_embed_metadata_keys=keys,
            excluded_llm_metadata_keys=keys,
        )

    def _nodes_from_documents(self, docs: list[Document]) -> list:
        nodes = []
        for doc in docs:
            parser = self._md_parser if doc.metadata.get("source") == SOURCE_HANDBOOK else self._sent_parser
            nodes.extend(parser.get_nodes_from_documents([doc]))
        return nodes

    def _rebuild(self, docs: list[Document]) -> VectorStoreIndex:
        self._clear_storage()
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        nodes = self._nodes_from_documents(docs)
        self.log(f"[kb] Embedding {len(nodes)} nodes from {len(docs)} documents…")

        index = VectorStoreIndex([], show_progress=False)
        batch_size = 12
        for i in range(0, len(nodes), batch_size):
            chunk = nodes[i : i + batch_size]
            for attempt in range(5):
                try:
                    index.insert_nodes(chunk)
                    break
                except Exception as exc:
                    err_str = str(exc)
                    if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                        wait = 15 * (attempt + 1)
                        self.log(f"[kb] Rate limit reached. Backing off {wait}s (attempt {attempt+1}/5)…")
                        time.sleep(wait)
                    else:
                        raise exc
            time.sleep(0.4)

        index.storage_context.persist(persist_dir=str(self.storage_dir))
        self._write_manifest(docs)
        self.log(f"[kb] Unified index saved to {self.storage_dir}")
        return index

    def _sync(self, index: VectorStoreIndex, docs: list[Document], manifest: dict) -> VectorStoreIndex:
        old = manifest.get("docs") or {}
        new_map = {d.id_: _fingerprint(d.text, d.metadata) for d in docs}
        to_delete = [doc_id for doc_id in old if doc_id not in new_map]
        to_upsert = [d for d in docs if old.get(d.id_) != new_map[d.id_]]

        if not to_delete and not to_upsert:
            self.log("[kb] Index already in sync.")
            return index

        for doc_id in to_delete:
            try:
                index.delete_ref_doc(doc_id, delete_from_docstore=True)
            except Exception as exc:  # noqa: BLE001
                self.log(f"[kb] delete_ref_doc failed for {doc_id}: {exc}")

        if to_upsert:
            self.log(f"[kb] Updating {len(to_upsert)} document(s), removing {len(to_delete)} stale…")
            for doc in to_upsert:
                if doc.id_ in old:
                    try:
                        index.delete_ref_doc(doc.id_, delete_from_docstore=True)
                    except Exception as exc:  # noqa: BLE001
                        self.log(f"[kb] replace-delete failed for {doc.id_}: {exc}")
                nodes_to_add = self._nodes_from_documents([doc])
                for attempt in range(5):
                    try:
                        index.insert_nodes(nodes_to_add)
                        break
                    except Exception as exc:
                        err_str = str(exc)
                        if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                            wait = 15 * (attempt + 1)
                            self.log(f"[kb] Rate limit reached. Backing off {wait}s…")
                            time.sleep(wait)
                        else:
                            raise exc
                time.sleep(0.3)

        index.storage_context.persist(persist_dir=str(self.storage_dir))
        self._write_manifest(docs)
        return index

    def _storage_ready(self) -> bool:
        return (self.storage_dir / "docstore.json").exists()

    def _read_manifest(self) -> dict:
        path = self.manifest_path
        if not path.exists():
            return {}
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}

    def _write_manifest(self, docs: list[Document]) -> None:
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema_version": SCHEMA_VERSION,
            "docs": {d.id_: _fingerprint(d.text, d.metadata) for d in docs},
        }
        self.manifest_path.write_text(json.dumps(payload), encoding="utf-8")

    def _clear_storage(self) -> None:
        if not self.storage_dir.exists():
            return
        for child in self.storage_dir.iterdir():
            if child.is_file():
                child.unlink()


def allowed_for_department(metadata: dict, department: Optional[str]) -> bool:
    source = metadata.get("source")
    if source in PUBLIC_SOURCES:
        return True
    if source == SOURCE_KAKAO:
        return departments_match(metadata.get("department"), department)
    return False


class _UnifiedRetriever(BaseRetriever):
    def __init__(
        self,
        *,
        index: VectorStoreIndex,
        department: Optional[str],
        live_docs: list[Document],
        now: datetime,
    ) -> None:
        super().__init__()
        self._index = index
        self._department = department
        self._live_docs = live_docs
        self._now = now

    def _retrieve(self, query_bundle: QueryBundle) -> list[NodeWithScore]:
        question = query_bundle.query_str
        raw = self._index.as_retriever(similarity_top_k=VECTOR_CANDIDATES).retrieve(query_bundle)
        vector_hits = [
            hit for hit in raw
            if allowed_for_department(dict(getattr(hit.node, "metadata", None) or {}), self._department)
        ]
        lexical_hits = self._lexical_hits(question)

        merged: dict[str, NodeWithScore] = {}
        for hit in vector_hits + lexical_hits:
            key = getattr(hit.node, "ref_doc_id", None) or hit.node.node_id
            prev = merged.get(key)
            if prev is None or (hit.score or 0) > (prev.score or 0):
                merged[key] = hit

        ranked: list[tuple[float, NodeWithScore]] = []
        sims = [h.score or 0.0 for h in merged.values()]
        max_sim = max(sims) if sims else 1.0
        min_sim = min(sims) if sims else 0.0
        span = (max_sim - min_sim) or 1.0

        for hit in merged.values():
            meta = dict(getattr(hit.node, "metadata", None) or {})
            source = meta.get("source") or SOURCE_HANDBOOK
            sim_norm = ((hit.score or 0.0) - min_sim) / span
            rec = recency_weight(meta.get("published_at"), self._now, source)
            combined = 0.7 * sim_norm + 0.3 * rec
            hit.score = combined
            ranked.append((combined, hit))

        ranked.sort(key=lambda x: x[0], reverse=True)
        return [hit for _, hit in ranked[:FINAL_TOP_K]]

    def _lexical_hits(self, question: str) -> list[NodeWithScore]:
        qtoks = _tokens(question)
        if not qtoks:
            return []
        scored: list[tuple[float, Document]] = []
        for doc in self._live_docs[:LEXICAL_RECENT]:
            if not allowed_for_department(doc.metadata, self._department):
                continue
            blob = f"{doc.metadata.get('title', '')} {doc.text}"
            dtoks = _tokens(blob)
            if not dtoks:
                continue
            overlap = len(qtoks & dtoks) / len(qtoks)
            rec = recency_weight(doc.metadata.get("published_at"), self._now, doc.metadata.get("source") or "")
            score = overlap + 0.2 * rec
            if overlap >= 0.2 or (overlap >= 0.1 and rec > 0.6):
                scored.append((score, doc))
        scored.sort(key=lambda x: x[0], reverse=True)

        hits: list[NodeWithScore] = []
        for score, doc in scored[:4]:
            node = TextNode(
                text=doc.text[:4000],
                id_=f"{doc.id_}#focus",
                metadata=doc.metadata,
            )
            node.relationships[NodeRelationship.SOURCE] = RelatedNodeInfo(node_id=doc.id_)
            hits.append(NodeWithScore(node=node, score=score))
        return hits
