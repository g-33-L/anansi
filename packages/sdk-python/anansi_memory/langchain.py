"""LangChain integration for anansi-memory.

Uses only the Python stdlib plus langchain-core when it is installed:
with langchain-core present, AnansiRetriever is a real BaseRetriever usable in
any chain; without it, the class still works standalone via
get_relevant_documents() and returns lightweight Document shims.
"""

from __future__ import annotations

from typing import Any, List, Optional

from .client import AnansiMemory

try:  # pragma: no cover - depends on the host environment
    from langchain_core.retrievers import BaseRetriever
    from langchain_core.documents import Document
    from langchain_core.callbacks import CallbackManagerForRetrieverRun

    _HAS_LANGCHAIN = True
except ImportError:  # langchain-core not installed — degrade to a stdlib shim
    _HAS_LANGCHAIN = False

    class Document:  # type: ignore[no-redef]
        """Minimal stand-in matching langchain_core.documents.Document."""

        def __init__(self, page_content: str, metadata: Optional[dict[str, Any]] = None) -> None:
            self.page_content = page_content
            self.metadata = metadata or {}

        def __repr__(self) -> str:
            return f"Document(page_content={self.page_content!r}, metadata={self.metadata!r})"


def _search_documents(
    client: AnansiMemory,
    user_id: str,
    query: str,
    *,
    limit: int = 10,
    search_mode: Optional[str] = None,
    alpha: Optional[float] = None,
    threshold: Optional[float] = None,
    filters: Optional[dict] = None,
) -> List[Document]:
    results = client.search(
        user_id=user_id,
        query=query,
        limit=limit,
        search_mode=search_mode,
        alpha=alpha,
        threshold=threshold,
        filters=filters,
    )
    return [
        Document(
            page_content=r.content,
            metadata={**r.metadata, "score": r.score, "source_id": r.source_id},
        )
        for r in results
    ]


if _HAS_LANGCHAIN:

    class AnansiRetriever(BaseRetriever):
        """LangChain retriever backed by Anansi's POST /v1/search."""

        api_key: str
        user_id: str
        base_url: Optional[str] = None
        limit: int = 10
        search_mode: Optional[str] = None
        alpha: Optional[float] = None
        threshold: Optional[float] = None
        filters: Optional[dict] = None

        @property
        def _client(self) -> AnansiMemory:
            if self.base_url:
                return AnansiMemory(api_key=self.api_key, base_url=self.base_url)
            return AnansiMemory(api_key=self.api_key)

        def _get_relevant_documents(
            self, query: str, *, run_manager: CallbackManagerForRetrieverRun
        ) -> List[Document]:
            return _search_documents(
                self._client,
                self.user_id,
                query,
                limit=self.limit,
                search_mode=self.search_mode,
                alpha=self.alpha,
                threshold=self.threshold,
                filters=self.filters,
            )

else:

    class AnansiRetriever:  # type: ignore[no-redef]
        """Standalone retriever with the same surface when langchain-core is absent."""

        def __init__(
            self,
            api_key: str,
            user_id: str,
            base_url: Optional[str] = None,
            limit: int = 10,
            search_mode: Optional[str] = None,
            alpha: Optional[float] = None,
            threshold: Optional[float] = None,
            filters: Optional[dict] = None,
        ) -> None:
            self.api_key = api_key
            self.user_id = user_id
            self.base_url = base_url
            self.limit = limit
            self.search_mode = search_mode
            self.alpha = alpha
            self.threshold = threshold
            self.filters = filters

        @property
        def _client(self) -> AnansiMemory:
            if self.base_url:
                return AnansiMemory(api_key=self.api_key, base_url=self.base_url)
            return AnansiMemory(api_key=self.api_key)

        def get_relevant_documents(self, query: str) -> List[Document]:
            return _search_documents(
                self._client,
                self.user_id,
                query,
                limit=self.limit,
                search_mode=self.search_mode,
                alpha=self.alpha,
                threshold=self.threshold,
                filters=self.filters,
            )

        def invoke(self, query: str, **_: Any) -> List[Document]:
            return self.get_relevant_documents(query)


__all__ = ["AnansiRetriever", "Document"]
