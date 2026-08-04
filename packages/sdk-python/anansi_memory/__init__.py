"""anansi-memory — The memory layer for AI apps."""

from .client import (
    AnansiMemory,
    AnansiError,
    IngestResult,
    ContextResult,
    RelevantChunk,
    SearchResult,
    Memory,
)

__all__ = [
    "AnansiMemory",
    "AnansiError",
    "IngestResult",
    "ContextResult",
    "RelevantChunk",
    "SearchResult",
    "Memory",
]
__version__ = "0.3.0"
