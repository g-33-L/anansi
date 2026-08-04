import { chatSynthesis } from "./llm.js";
import {
  ATTESTATION_EXTRACTION_SYSTEM_PROMPT,
  buildAttestationExtractionPrompt,
  buildChunksBlock,
  parseExtractionResponse,
  type ExtractionOutput,
} from "./attestation-extraction-prompt.js";

// The LLM "reporter" step: turn a block of source chunks into proposed
// attestations. It only proposes — verification, scoring, and persistence happen
// downstream in attestation-ingest.ts. One retry with a stricter instruction if
// the first response doesn't parse (mirrors the synthesis worker).
export async function extractAttestations(opts: {
  domain: string;
  chunks: Array<{ id: string; source: string; author?: string; text: string }>;
}): Promise<ExtractionOutput> {
  const chunksBlock = buildChunksBlock(opts.chunks);

  for (const retry of [false, true]) {
    const raw = await chatSynthesis([
      { role: "system", content: ATTESTATION_EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: buildAttestationExtractionPrompt({ domain: opts.domain, chunksBlock, retry }) },
    ]);
    const parsed = parseExtractionResponse(raw);
    if (parsed) return parsed;
  }

  return { attestations: [], refusals: [] };
}
