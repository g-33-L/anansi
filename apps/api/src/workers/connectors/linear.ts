import { createHmac, timingSafeEqual } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../../lib/db/index.js";
import { connectorTokens } from "../../lib/db/schema.js";
import { decrypt } from "../../lib/utils/crypto.js";
import { embedAndInsert } from "../../lib/ai/ingest-core.js";
import { sanitizeText } from "../../lib/utils/sanitize.js";
import { chunkBySourceType } from "../../lib/ai/chunker.js";
import { synthesisQueue } from "../../lib/infra/queue.js";

export interface LinearWebhookEvent {
  action: "create" | "update" | "remove";
  type: "Issue" | "Comment" | "IssueLabel";
  data: {
    id: string;
    title?: string;
    description?: string;
    body?: string;           // comment body
    state?: { name: string };
    assignee?: { name: string };
    labels?: { name: string }[];
    createdAt?: string;
    updatedAt?: string;
    url?: string;
    issue?: { id: string; title?: string; url?: string }; // for comments
  };
  organizationId: string;
}

// Validates the Linear-Signature header against the stored webhook secret.
export function verifyLinearSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

export async function getLinearWebhookSecret(workspaceId: string): Promise<string | null> {
  const token = await db.query.connectorTokens.findFirst({
    where: and(
      eq(connectorTokens.workspaceId, workspaceId),
      eq(connectorTokens.provider, "linear")
    ),
    columns: { accessToken: true },
  });
  if (!token) return null;
  return decrypt(token.accessToken);
}

export async function processLinearEvent(workspaceId: string, event: LinearWebhookEvent): Promise<void> {
  // Only ingest issue create/update; ignore removes and unsupported types
  if (event.action === "remove") return;
  if (event.type !== "Issue" && event.type !== "Comment") return;

  let text: string;
  let sourceId: string;
  let title: string;
  let timestamp: string;

  if (event.type === "Issue") {
    const { id, title: issueTitle = "Untitled", description = "", state, assignee, labels = [], url = "" } = event.data;
    const meta = [
      state ? `Status: ${state.name}` : "",
      assignee ? `Assignee: ${assignee.name}` : "",
      labels.length > 0 ? `Labels: ${labels.map((l) => l.name).join(", ")}` : "",
      url ? `URL: ${url}` : "",
    ].filter(Boolean).join("\n");

    text = `${issueTitle}\n\n${description}${meta ? `\n\n${meta}` : ""}`;
    sourceId = `linear:issue:${id}`;
    title = issueTitle;
    timestamp = event.data.updatedAt ?? event.data.createdAt ?? new Date().toISOString();
  } else {
    // Comment
    const { id, body = "", issue, createdAt } = event.data;
    if (!body.trim()) return;
    const parentTitle = issue?.title ?? "Unknown issue";
    text = `Comment on: ${parentTitle}\n\n${body}`;
    sourceId = `linear:comment:${id}`;
    title = `Comment on: ${parentTitle}`;
    timestamp = createdAt ?? new Date().toISOString();
  }

  const { text: clean } = sanitizeText(text);
  if (!clean.trim()) return;

  const chunks = chunkBySourceType(clean, "linear_issue");

  await embedAndInsert(
    chunks.map((chunk, idx) => ({
      workspaceId,
      sourceType: "linear_issue" as const,
      sourceId: chunks.length > 1 ? `${sourceId}:${idx}` : sourceId,
      content: chunk,
      metadata: {
        author: "linear",
        authorId: "linear",
        timestamp,
        channelName: "linear",
        title,
      },
    }))
  );

  await synthesisQueue.add("synthesize", { workspaceId }, { jobId: `synthesis-${workspaceId}` });
}
