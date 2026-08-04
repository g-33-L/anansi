from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Optional
from urllib import request, error
from urllib.parse import urlencode


@dataclass
class RelevantChunk:
    content: str
    similarity: float
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class IngestResult:
    id: str
    queued: bool


@dataclass
class SearchResult:
    content: str
    score: float
    source_id: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class Memory:
    id: str
    content: str
    source_type: str
    source_id: str
    metadata: dict[str, Any]
    similarity: Optional[float]
    synthesized: bool
    expires_at: Optional[str]
    created_at: str


@dataclass
class ContextResult:
    static: list[str]
    dynamic: list[str]
    relevant: list[RelevantChunk]
    temporal: list[dict[str, Any]] = field(default_factory=list)
    entities: list[dict[str, Any]] = field(default_factory=list)

    def format_for_prompt(self) -> str:
        lines: list[str] = []
        if self.static:
            lines.append("## User — Stable facts")
            lines.extend(f"- {f}" for f in self.static)
        if self.dynamic:
            if lines:
                lines.append("")
            lines.append("## User — Current context")
            lines.extend(f"- {d}" for d in self.dynamic)
        if self.relevant:
            if lines:
                lines.append("")
            lines.append("## Relevant history")
            lines.extend(f"- {r.content}" for r in self.relevant)
        return "\n".join(lines)


class AnansiError(Exception):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


class AnansiMemory:
    def __init__(self, api_key: str, base_url: str = "https://anansimemory.com") -> None:
        if not api_key:
            raise ValueError("api_key is required")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")

    def _request(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        url = f"{self._base_url}{path}"
        data = json.dumps(body).encode() if body is not None else None
        headers: dict[str, str] = {"Authorization": f"Bearer {self._api_key}"}
        if data is not None:
            headers["Content-Type"] = "application/json"

        req = request.Request(url, data=data, headers=headers, method=method)
        try:
            with request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except error.HTTPError as exc:
            msg = f"Anansi API error {exc.code}"
            try:
                payload = json.loads(exc.read())
                if isinstance(payload, dict) and payload.get("error"):
                    msg = payload["error"]
            except Exception:
                pass
            raise AnansiError(msg, exc.code) from exc

    def ingest(self, *, user_id: str, content: str, source_type: Optional[str] = None,
               source_id: Optional[str] = None, session_id: Optional[str] = None,
               agent_id: Optional[str] = None, ttl: Optional[int] = None,
               embedding: Optional[list[float]] = None, embedding_model: Optional[str] = None,
               entity_context: Optional[str] = None,
               metadata: Optional[dict[str, Any]] = None) -> IngestResult:
        payload: dict[str, Any] = {"userId": user_id, "content": content}
        if source_type is not None:
            payload["sourceType"] = source_type
        if source_id is not None:
            payload["sourceId"] = source_id
        if session_id is not None:
            payload["sessionId"] = session_id
        if agent_id is not None:
            payload["agentId"] = agent_id
        if ttl is not None:
            payload["ttl"] = ttl
        if embedding is not None:
            payload["embedding"] = embedding
        if embedding_model is not None:
            payload["embeddingModel"] = embedding_model
        if entity_context is not None:
            payload["entityContext"] = entity_context
        if metadata is not None:
            payload["metadata"] = metadata
        raw = self._request("POST", "/v1/ingest", payload)
        return IngestResult(id=raw["id"], queued=raw["queued"])

    def context(self, *, user_id: Optional[str] = None, q: Optional[str] = None,
                scope: str = "user", alpha: Optional[float] = None,
                threshold: Optional[float] = None, filters: Optional[dict] = None,
                session_id: Optional[str] = None, as_of: Optional[str] = None,
                as_of_knowledge: Optional[str] = None) -> ContextResult:
        params: dict[str, str] = {}
        if user_id is not None:
            params["userId"] = user_id
        if q is not None:
            params["q"] = q
        if scope != "user":
            params["scope"] = scope
        if alpha is not None:
            params["alpha"] = str(alpha)
        if threshold is not None:
            params["threshold"] = str(threshold)
        if filters is not None:
            params["filters"] = json.dumps(filters)
        if session_id is not None:
            params["sessionId"] = session_id
        if as_of is not None:
            # Valid-time: entities/temporal facts as TRUE at as_of
            # ("YYYY-MM", "YYYY-MM-DD", or ISO 8601).
            params["asOf"] = as_of
        if as_of_knowledge is not None:
            # Knowledge-time (bi-temporal): graph as we KNEW it at this instant.
            params["asOfKnowledge"] = as_of_knowledge
        path = f"/v1/context?{urlencode(params)}"
        raw = self._request("GET", path)
        return ContextResult(
            static=raw.get("static", []),
            dynamic=raw.get("dynamic", []),
            temporal=raw.get("temporal", []),
            entities=raw.get("entities", []),
            relevant=[
                RelevantChunk(content=r["content"], similarity=r["similarity"], metadata=r.get("metadata", {}))
                for r in raw.get("relevant", [])
            ],
        )

    def search(self, *, user_id: str, query: str, search_mode: Optional[str] = None,
               threshold: Optional[float] = None, alpha: Optional[float] = None,
               limit: Optional[int] = None, filters: Optional[dict] = None,
               source_id: Optional[str] = None, session_id: Optional[str] = None) -> list[SearchResult]:
        """Raw hybrid search without synthesis — returns scored chunks."""
        payload: dict[str, Any] = {"userId": user_id, "query": query}
        if search_mode is not None:
            payload["searchMode"] = search_mode
        if threshold is not None:
            payload["threshold"] = threshold
        if alpha is not None:
            payload["alpha"] = alpha
        if limit is not None:
            payload["limit"] = limit
        if filters is not None:
            payload["filters"] = filters
        if source_id is not None:
            payload["sourceId"] = source_id
        if session_id is not None:
            payload["sessionId"] = session_id
        raw = self._request("POST", "/v1/search", payload)
        return [
            SearchResult(content=r["content"], score=r["score"],
                         source_id=r["sourceId"], metadata=r.get("metadata", {}))
            for r in raw.get("results", [])
        ]

    def list_memories(self, user_id: str, *, source_type: Optional[str] = None,
                      limit: int = 20, offset: int = 0,
                      q: Optional[str] = None) -> tuple[list[Memory], int]:
        """List raw memory chunks. Returns (memories, total)."""
        params: dict[str, str] = {"userId": user_id, "limit": str(limit), "offset": str(offset)}
        if source_type is not None:
            params["sourceType"] = source_type
        if q is not None:
            params["q"] = q
        raw = self._request("GET", f"/v1/memories?{urlencode(params)}")
        memories = [
            Memory(
                id=m["id"], content=m["content"], source_type=m["sourceType"],
                source_id=m["sourceId"], metadata=m.get("metadata", {}),
                similarity=m.get("similarity"), synthesized=m.get("synthesized", False),
                expires_at=m.get("expiresAt"), created_at=m["createdAt"],
            )
            for m in raw.get("memories", [])
        ]
        return memories, raw.get("total", len(memories))

    def delete_user(self, user_id: str) -> dict[str, bool]:
        """GDPR hard-delete: removes the memory profile and all associated data for *user_id*.

        Deletes the memoryUser row and cascades to all child records (chunks,
        synthesized facts, entity graph). Irreversible and idempotent — a second
        call returns ``{"deleted": True}``.

        Returns:
            ``{"deleted": True}`` on success.
        """
        params = urlencode({"userId": user_id})
        raw = self._request("DELETE", f"/v1/user?{params}")
        return {"deleted": bool(raw.get("deleted", False))}

    def list_entities(self, user_id: str, *, as_of: Optional[str] = None,
                      as_of_knowledge: Optional[str] = None) -> list[dict[str, Any]]:
        """All extracted entities and their (temporal) relationships for a user.

        - as_of: graph snapshot as it was *valid* at that instant
        - as_of_knowledge: graph as we *knew* it at that instant (bi-temporal)
        Both accept "YYYY-MM", "YYYY-MM-DD", or ISO 8601; omitted = full history.
        """
        params = {"userId": user_id}
        if as_of is not None:
            params["asOf"] = as_of
        if as_of_knowledge is not None:
            params["asOfKnowledge"] = as_of_knowledge
        raw = self._request("GET", f"/v1/entities?{urlencode(params)}")
        return raw.get("entities", [])
