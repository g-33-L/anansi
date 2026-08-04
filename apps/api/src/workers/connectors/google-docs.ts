import { Worker } from "bullmq";
import { eq, and } from "drizzle-orm";
import { redis, synthesisQueue, type GoogleDocsSyncJobData } from "../../lib/infra/queue.js";
import { db } from "../../lib/db/index.js";
import { connectorTokens } from "../../lib/db/schema.js";
import { encrypt, decrypt } from "../../lib/utils/crypto.js";
import { embedAndInsert } from "../../lib/ai/ingest-core.js";
import { chunkBySourceType } from "../../lib/ai/chunker.js";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

interface DriveListResponse {
  files: DriveFile[];
  nextPageToken?: string;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

// Refresh the access token using the stored refresh token. Updates DB and returns new access token.
async function refreshAccessToken(token: typeof connectorTokens.$inferSelect): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google credentials not configured");

  const refreshToken = token.refreshToken ? decrypt(token.refreshToken) : null;
  if (!refreshToken) throw new Error("No refresh token stored for Google Docs connector");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  const data = await res.json() as GoogleTokenResponse;

  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  await db
    .update(connectorTokens)
    .set({ accessToken: encrypt(data.access_token), expiresAt })
    .where(eq(connectorTokens.id, token.id));

  return data.access_token;
}

// Returns a valid (non-expired) access token, refreshing if needed.
async function getAccessToken(token: typeof connectorTokens.$inferSelect): Promise<string> {
  if (token.expiresAt && token.expiresAt.getTime() - Date.now() > TOKEN_EXPIRY_BUFFER_MS) {
    return decrypt(token.accessToken);
  }
  return refreshAccessToken(token);
}

async function syncGoogleDocs(workspaceId: string, tokenId: string): Promise<void> {
  const token = await db.query.connectorTokens.findFirst({
    where: and(eq(connectorTokens.id, tokenId), eq(connectorTokens.workspaceId, workspaceId)),
  });
  if (!token) {
    console.error(`[google-docs] Token ${tokenId} not found`);
    return;
  }

  const accessToken = await getAccessToken(token);
  const lastSyncedAt = token.lastSyncedAt;
  let pageToken: string | undefined;
  let docsProcessed = 0;
  let hasErrors = false;

  console.log(`[google-docs] Syncing workspace ${workspaceId}, lastSyncedAt=${lastSyncedAt?.toISOString() ?? "never"}`);

  do {
    const params = new URLSearchParams({
      q: "mimeType='application/vnd.google-apps.document' and trashed=false",
      fields: "files(id,name,modifiedTime),nextPageToken",
      pageSize: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const listRes = await fetch(`${DRIVE_FILES_URL}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!listRes.ok) throw new Error(`Drive list failed: ${await listRes.text()}`);

    const listData = await listRes.json() as DriveListResponse;

    for (const file of listData.files) {
      if (lastSyncedAt && new Date(file.modifiedTime) <= lastSyncedAt) continue;

      const exportRes = await fetch(
        `${DRIVE_FILES_URL}/${encodeURIComponent(file.id)}/export?mimeType=text/plain`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!exportRes.ok) {
        console.error(`[google-docs] Failed to export doc ${file.id}: ${exportRes.status}`);
        hasErrors = true;
        continue;
      }

      const text = await exportRes.text();
      if (!text.trim()) continue;

      const fullText = `${file.name}\n\n${text}`;
      const chunks = chunkBySourceType(fullText, "gdoc");
      const sourceBase = `gdoc:${file.id}`;

      await embedAndInsert(
        chunks.map((chunk, idx) => ({
          workspaceId,
          sourceType: "gdoc" as const,
          sourceId: chunks.length > 1 ? `${sourceBase}:${idx}` : sourceBase,
          content: chunk,
          metadata: {
            author: "google_docs",
            authorId: "google_docs",
            timestamp: file.modifiedTime,
            channelName: "google_docs",
            title: file.name,
          },
        }))
      );

      docsProcessed++;
    }

    pageToken = listData.nextPageToken;
  } while (pageToken);

  // Only advance lastSyncedAt if no docs failed — prevents permanently skipping failed files
  if (!hasErrors) {
    await db
      .update(connectorTokens)
      .set({ lastSyncedAt: new Date() })
      .where(eq(connectorTokens.id, tokenId));
  } else {
    console.warn(`[google-docs] Workspace ${workspaceId}: sync had errors, lastSyncedAt not advanced`);
  }

  // Trigger workspace synthesis if any new chunks were ingested
  if (docsProcessed > 0) {
    await synthesisQueue.add("synthesize", { workspaceId }, { jobId: `synthesis-${workspaceId}` });
  }

  console.log(`[google-docs] Workspace ${workspaceId}: synced ${docsProcessed} documents`);
}

export function startGoogleDocsWorker() {
  const worker = new Worker<GoogleDocsSyncJobData>(
    "google-docs-sync",
    async (job) => {
      const { workspaceId, tokenId } = job.data;
      await syncGoogleDocs(workspaceId, tokenId);
    },
    { connection: redis, concurrency: 2 }
  );

  worker.on("failed", (job, err) => {
    console.error(`[google-docs] Job ${job?.id} failed:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`[google-docs] Job ${job.id} completed`);
  });

  console.log("[google-docs] Worker started");
  return worker;
}
