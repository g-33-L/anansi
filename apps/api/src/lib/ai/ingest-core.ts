import { db } from "../db/index.js";
import { memoryChunks } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { embedBatch } from "./embed.js";

const EMBED_BATCH_SIZE = 100;

// Must match the vector(N) dimension on memory_chunks.embedding
export const EMBEDDING_DIMENSIONS = 768;

export interface ChunkInput {
  workspaceId: string;
  channelId?: string | null;
  memoryUserId?: string | null;
  sourceType: "message" | "thread" | "file_pdf" | "file_doc" | "url" | "api_text" | "meeting_transcript" | "notion_page" | "gdoc" | "linear_issue";
  sourceId: string;
  content: string;
  expiresAt?: Date | null;
  // Bring-your-own vector: skips the embedding provider for this chunk entirely
  precomputedEmbedding?: number[];
  metadata: {
    author: string;
    authorId: string;
    timestamp: string;
    channelName: string;
    threadTs?: string;
    title?: string;
  };
}

// Prepend a context header before embedding so the vector carries what-this-is info.
// The raw content is stored in the DB unchanged — only the embedding gets the prefix.
function buildEmbeddingText(input: ChunkInput): string {
  const parts: string[] = [];
  if (input.metadata.title) parts.push(`Title: ${input.metadata.title}`);
  parts.push(`Source: ${input.sourceType.replace(/_/g, " ")}`);
  return `${parts.join(" | ")}\n\n${input.content}`;
}

// insertChunks: insert rows immediately with NULL embedding (invisible to search).
// Returns the inserted chunk IDs so callers can enqueue embed jobs.
// Used by v1 ingest to decouple embedding computation from the HTTP request path.
export async function insertChunks(inputs: ChunkInput[]): Promise<string[]> {
  if (inputs.length === 0) return [];

  const ids: string[] = [];
  await db.transaction(async (tx) => {
    for (const input of inputs) {
      // precomputedEmbedding is stored inline — no embed job needed for those
      const embedding = input.precomputedEmbedding ?? null;

      const result = await tx
        .insert(memoryChunks)
        .values({
          workspaceId: input.workspaceId,
          channelId: input.channelId ?? null,
          memoryUserId: input.memoryUserId ?? null,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          content: input.content,
          embedding,
          expiresAt: input.expiresAt ?? null,
          metadata: input.metadata,
        })
        .onConflictDoNothing()
        .returning({ id: memoryChunks.id });

      if (result[0] && !input.precomputedEmbedding) {
        ids.push(result[0].id);
      }
    }
  });
  return ids;
}

// embedChunk: compute the embedding for a single chunk (by ID) and UPDATE the row.
// Called by the embed worker after insertChunks.
export async function embedChunk(chunkId: string): Promise<void> {
  const chunk = await db.query.memoryChunks.findFirst({
    where: eq(memoryChunks.id, chunkId),
  });
  if (!chunk) return; // chunk may have been deleted (e.g. GDPR wipe before worker ran)
  if (chunk.embedding && (chunk.embedding as number[]).length > 0) return; // already embedded

  const embeddingText = buildEmbeddingText({
    workspaceId: chunk.workspaceId,
    sourceType: chunk.sourceType,
    sourceId: chunk.sourceId,
    content: chunk.content,
    metadata: (chunk.metadata ?? {}) as ChunkInput["metadata"],
  });

  const [embedding] = await embedBatch([embeddingText]);
  if (!embedding || embedding.length === 0) {
    throw new Error(`embedBatch returned no vector for chunk ${chunkId}`);
  }

  await db
    .update(memoryChunks)
    .set({ embedding })
    .where(eq(memoryChunks.id, chunkId));
}

export async function embedAndInsert(inputs: ChunkInput[]): Promise<void> {
  if (inputs.length === 0) return;

  // Only inputs without a precomputed embedding go to the embedding provider
  const toEmbed = inputs.filter((input) => !input.precomputedEmbedding);
  const texts = toEmbed.map(buildEmbeddingText);
  const computed: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedBatch(batch);
    if (embeddings.length !== batch.length) {
      throw new Error(`embedBatch returned ${embeddings.length} embeddings for ${batch.length} inputs`);
    }
    computed.push(...embeddings);
  }

  let computedIdx = 0;
  const allEmbeddings = inputs.map((input) => input.precomputedEmbedding ?? computed[computedIdx++]);

  await db.transaction(async (tx) => {
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const embedding = allEmbeddings[i];

      await tx
        .insert(memoryChunks)
        .values({
          workspaceId: input.workspaceId,
          channelId: input.channelId ?? null,
          memoryUserId: input.memoryUserId ?? null,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          content: input.content,
          embedding,
          expiresAt: input.expiresAt ?? null,
          metadata: input.metadata,
        })
        .onConflictDoNothing();
    }
  });
}
