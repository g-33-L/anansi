const BASE = import.meta.env.VITE_ANANSI_URL ?? '';

export interface EntityRelationship {
  relationship: string;
  target: { id: string; type: string; name: string };
  validFrom: string;
  validUntil: string | null;
  current: boolean;
}

export interface EntitySummary {
  id: string;
  type: string;
  name: string;
  relationships: EntityRelationship[];
  firstSeen: string;
  lastSeen: string;
}

export interface Memory {
  id: string;
  content: string;
  sourceType: string;
  sourceId: string | null;
  metadata: Record<string, unknown>;
  similarity: number | null;
  synthesized: boolean;
  expiresAt: string | null;
  createdAt: string;
}

function headers(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

export async function fetchEntities(
  userId: string,
  apiKey: string,
  asOf?: string,
): Promise<EntitySummary[]> {
  const params = new URLSearchParams({ userId });
  if (asOf) params.set('asOf', asOf);
  const res = await fetch(`${BASE}/v1/entities?${params}`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(`/v1/entities ${res.status}: ${await res.text()}`);
  const data = await res.json() as { entities: EntitySummary[] };
  return data.entities;
}

export async function fetchMemories(
  userId: string,
  apiKey: string,
  limit = 100,
): Promise<Memory[]> {
  const params = new URLSearchParams({ userId, limit: String(limit) });
  const res = await fetch(`${BASE}/v1/memories?${params}`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(`/v1/memories ${res.status}: ${await res.text()}`);
  const data = await res.json() as { memories: Memory[] };
  return data.memories;
}
