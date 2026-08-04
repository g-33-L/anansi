import { Worker } from "bullmq";
import { eq, and } from "drizzle-orm";
import { Client as NotionClient } from "@notionhq/client";
import type {
  PageObjectResponse,
  BlockObjectResponse,
  RichTextItemResponse,
} from "@notionhq/client/build/src/api-endpoints.js";
import { redis, synthesisQueue, type NotionSyncJobData } from "../../lib/infra/queue.js";
import { db } from "../../lib/db/index.js";
import { connectorTokens } from "../../lib/db/schema.js";
import { decrypt } from "../../lib/utils/crypto.js";
import { embedAndInsert } from "../../lib/ai/ingest-core.js";
import { chunkBySourceType } from "../../lib/ai/chunker.js";

// ─── Text extraction from Notion blocks ──────────────────────────────────────

const TEXT_BLOCK_TYPES = [
  "paragraph", "heading_1", "heading_2", "heading_3",
  "bulleted_list_item", "numbered_list_item", "to_do",
  "quote", "callout", "toggle",
] as const;

function extractRichText(richText: RichTextItemResponse[]): string {
  return richText.map((t) => t.plain_text).join("");
}

function extractBlockText(block: BlockObjectResponse): string {
  const b = block as Record<string, unknown>;
  const type = block.type;

  if ((TEXT_BLOCK_TYPES as readonly string[]).includes(type)) {
    const content = b[type] as { rich_text?: RichTextItemResponse[] } | undefined;
    return extractRichText(content?.rich_text ?? []);
  }

  if (type === "code") {
    const content = b.code as { rich_text?: RichTextItemResponse[]; language?: string } | undefined;
    return extractRichText(content?.rich_text ?? []);
  }

  return "";
}

async function fetchPageText(notion: NotionClient, pageId: string): Promise<string> {
  const lines: string[] = [];
  let cursor: string | undefined;

  do {
    const res = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const block of res.results) {
      const text = extractBlockText(block as BlockObjectResponse);
      if (text.trim()) lines.push(text.trim());
    }

    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);

  return lines.join("\n");
}

// ─── Main sync function ───────────────────────────────────────────────────────

async function syncNotion(workspaceId: string, tokenId: string): Promise<void> {
  const token = await db.query.connectorTokens.findFirst({
    where: and(
      eq(connectorTokens.id, tokenId),
      eq(connectorTokens.workspaceId, workspaceId)
    ),
  });

  if (!token) {
    console.error(`[notion] Token ${tokenId} not found for workspace ${workspaceId}`);
    return;
  }

  const accessToken = decrypt(token.accessToken);
  const notion = new NotionClient({ auth: accessToken });

  const lastSyncedAt = token.lastSyncedAt;
  let cursor: string | undefined;
  let pagesProcessed = 0;
  let hasErrors = false;

  console.log(`[notion] Syncing workspace ${workspaceId}, lastSyncedAt=${lastSyncedAt?.toISOString() ?? "never"}`);

  do {
    const searchRes = await notion.search({
      filter: { property: "object", value: "page" },
      start_cursor: cursor,
      page_size: 100,
    });

    const pages = searchRes.results.filter(
      (r): r is PageObjectResponse => r.object === "page"
    );

    for (const page of pages) {
      // Incremental: skip pages not edited since last sync
      if (lastSyncedAt && new Date(page.last_edited_time) <= lastSyncedAt) continue;

      const title =
        "properties" in page
          ? Object.values(page.properties).find(
              (p): p is Extract<typeof p, { type: "title" }> => p.type === "title"
            )?.title.map((t) => t.plain_text).join("") ?? "Untitled"
          : "Untitled";

      let pageText: string;
      try {
        pageText = await fetchPageText(notion, page.id);
      } catch (err) {
        console.error(`[notion] Failed to fetch page ${page.id}:`, err);
        hasErrors = true;
        continue;
      }

      const fullText = title ? `${title}\n\n${pageText}` : pageText;
      if (!fullText.trim()) continue;

      const chunks = chunkBySourceType(fullText, "notion_page");
      const sourceBase = `notion:${page.id}`;

      await embedAndInsert(
        chunks.map((chunk, idx) => ({
          workspaceId,
          sourceType: "notion_page" as const,
          sourceId: chunks.length > 1 ? `${sourceBase}:${idx}` : sourceBase,
          content: chunk,
          metadata: {
            author: "notion",
            authorId: "notion",
            timestamp: page.last_edited_time,
            channelName: "notion",
            title,
          },
        }))
      );

      pagesProcessed++;
    }

    cursor = searchRes.has_more ? searchRes.next_cursor ?? undefined : undefined;
  } while (cursor);

  // Only advance lastSyncedAt if no pages failed — prevents permanently skipping failed pages
  if (!hasErrors) {
    await db
      .update(connectorTokens)
      .set({ lastSyncedAt: new Date() })
      .where(eq(connectorTokens.id, tokenId));
  } else {
    console.warn(`[notion] Workspace ${workspaceId}: sync had errors, lastSyncedAt not advanced`);
  }

  // Trigger workspace synthesis if any new chunks were ingested
  if (pagesProcessed > 0) {
    await synthesisQueue.add("synthesize", { workspaceId }, { jobId: `synthesis-${workspaceId}` });
  }

  console.log(`[notion] Workspace ${workspaceId}: synced ${pagesProcessed} pages`);
}

// ─── BullMQ Worker ────────────────────────────────────────────────────────────

export function startNotionWorker() {
  const worker = new Worker<NotionSyncJobData>(
    "notion-sync",
    async (job) => {
      const { workspaceId, tokenId } = job.data;
      await syncNotion(workspaceId, tokenId);
    },
    { connection: redis, concurrency: 2 }
  );

  worker.on("failed", (job, err) => {
    console.error(`[notion] Job ${job?.id} failed:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`[notion] Job ${job.id} completed`);
  });

  console.log("[notion] Worker started");
  return worker;
}
