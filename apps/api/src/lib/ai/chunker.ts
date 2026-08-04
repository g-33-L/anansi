// ~4 chars per token is a good approximation for English text
const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_OVERLAP_TOKENS = 50;
const MAX_CHARS = DEFAULT_MAX_TOKENS * CHARS_PER_TOKEN;

export type ChunkableSourceType =
  | "message" | "thread" | "file_pdf" | "file_doc" | "url"
  | "api_text" | "meeting_transcript" | "notion_page" | "gdoc" | "linear_issue";

// Heading boundary: markdown headings at start of line
const HEADING_RE = /(?=\n#{1,6} )/;
// Speaker turn: "Name:" or "[00:00]" at start of line (meeting transcripts)
const SPEAKER_RE = /(?=\n[A-Za-z][^:\n]{0,50}:\s|\n\[\d{2}:\d{2}(?::\d{2})?\])/;

export function chunkText(
  text: string,
  maxTokens = DEFAULT_MAX_TOKENS,
  overlapTokens = DEFAULT_OVERLAP_TOKENS
): string[] {
  if (overlapTokens >= maxTokens) {
    throw new Error(`overlapTokens (${overlapTokens}) must be less than maxTokens (${maxTokens})`);
  }
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;

  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const chunks: string[] = [];
  let start = 0;

  while (start < trimmed.length) {
    const end = Math.min(start + maxChars, trimmed.length);
    // Prefer splitting at sentence boundary when not at the very end
    const boundary = end < trimmed.length ? findSentenceBoundary(trimmed, start, end) : end;
    chunks.push(trimmed.slice(start, boundary).trim());
    if (boundary >= trimmed.length) break;
    // Advance the window with overlap, but NEVER rewind to or before the current
    // start. When the boundary lands within `overlapChars` of `start` (e.g. the
    // only separator sits near the top of the window), `boundary - overlapChars`
    // would be <= start; without this guard the next iteration re-selects the same
    // boundary and the loop spins forever, pinning the event loop (see chunker test).
    const next = boundary - overlapChars;
    start = next > start ? next : boundary;
  }

  return chunks.filter(Boolean);
}

// Walk back from `end` to find the last sentence-ending character.
// Falls back to `end` if no boundary found in the window.
function findSentenceBoundary(text: string, start: number, end: number): number {
  const window = text.slice(start, end);
  // Prefer \n, then ". ", "? ", "! "
  for (const sep of ["\n", ". ", "? ", "! "]) {
    const idx = window.lastIndexOf(sep);
    if (idx > 50) return start + idx + sep.length; // keep at least 50 chars per chunk
  }
  return end;
}

// Split pre-segmented text at boundaries; if a segment is too big, apply chunkText.
function splitAndLimit(segments: string[]): string[] {
  const result: string[] = [];
  for (const seg of segments) {
    const t = seg.trim();
    if (!t) continue;
    if (t.length <= MAX_CHARS) result.push(t);
    else result.push(...chunkText(t));
  }
  return result;
}

function chunkDocument(text: string): string[] {
  const sections = text.split(HEADING_RE).filter((s) => s.trim());
  if (sections.length > 1) return splitAndLimit(sections);
  const paras = text.split(/\n\n+/).filter((s) => s.trim());
  if (paras.length > 1) return splitAndLimit(paras);
  return chunkText(text);
}

function chunkTranscript(text: string): string[] {
  const turns = text.split(SPEAKER_RE).filter((s) => s.trim());
  if (turns.length > 1) return splitAndLimit(turns);
  return chunkText(text);
}

// Type-aware chunking dispatcher. Call this instead of chunkText when sourceType is known.
export function chunkBySourceType(text: string, sourceType: ChunkableSourceType): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  switch (sourceType) {
    case "notion_page":
    case "gdoc":
      return chunkDocument(trimmed);

    case "meeting_transcript":
      return chunkTranscript(trimmed);

    case "linear_issue":
      // Issues are small — keep as one chunk rather than splitting mid-context
      return [trimmed.slice(0, MAX_CHARS)];

    default:
      return chunkText(trimmed);
  }
}
