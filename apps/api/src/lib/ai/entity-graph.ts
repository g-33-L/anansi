import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { entityNodes, entityEdges } from "../db/schema.js";

// Relationship types where a NEW current edge supersedes the entity's other active
// edges of that type — i.e. functional/single-valued relations ("changed jobs"
// closes the old works_at). Everything else is multi-valued and must accumulate:
// a person uses many technologies and knows many people concurrently, so those
// edges must never supersede one another. See BUG_AUDIT H1.
const SINGLE_VALUED_RELATIONSHIPS = new Set([
  "works_at",
  "reports_to",
  "located_in",
  "lives_in",
  "based_in",
  "headquartered_in",
]);

// ─── Entity extraction shapes (produced by the synthesis LLM) ─────────────────

export interface ExtractedRelationship {
  type: string;
  target: string;
  targetType?: string;
  current?: boolean;
}

export interface ExtractedEntity {
  type: string;
  name: string;
  relationships?: ExtractedRelationship[];
}

// ─── Entity graph persistence ─────────────────────────────────────────────────
// Upserts extracted entities into entity_nodes and maintains bi-temporal edges:
// a relationship marked current supersedes active edges of the same type to
// other targets; one marked not-current closes any active edge to that target.
//
// Correctness guarantees:
//  - Atomic: the whole graph update runs in ONE transaction. A partial failure
//    rolls back cleanly rather than leaving some edges closed and others not
//    inserted. (Callers run this *outside* the profile transaction so a graph
//    failure never rolls back the synthesized profile.)
//  - Race-safe: edge inserts use ON CONFLICT DO NOTHING against the partial
//    unique index on active edges (entity_edges_active_unique, valid_until IS
//    NULL). Two concurrent synthesis passes cannot create duplicate active edges
//    even if the per-user advisory lock is ever bypassed.

export async function persistEntityGraph(
  developerId: string,
  memoryUserId: string,
  entities: ExtractedEntity[]
): Promise<void> {
  if (entities.length === 0) return;

  // Collect every unique (type, name) pair needed — entities + their relationship
  // targets. A Map deduplicates so the batch INSERT never sees the same row twice
  // (PostgreSQL errors with "ON CONFLICT cannot affect row a second time").
  const nodeSpecs = new Map<string, { entityType: string; name: string }>();
  for (const entity of entities) {
    const key = `${entity.type}\0${entity.name}`;
    nodeSpecs.set(key, { entityType: entity.type, name: entity.name });
    for (const rel of entity.relationships ?? []) {
      const targetType = (rel.targetType ?? "org").trim().toLowerCase();
      const tKey = `${targetType}\0${rel.target.trim()}`;
      nodeSpecs.set(tKey, { entityType: targetType, name: rel.target.trim() });
    }
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    // Single batch upsert for all nodes; returning() yields both inserted and
    // updated rows, so nodeIdMap covers every spec.
    const upsertedNodes = await tx
      .insert(entityNodes)
      .values(
        [...nodeSpecs.values()].map((n) => ({
          developerId,
          memoryUserId,
          entityType: n.entityType,
          name: n.name,
          canonicalName: n.name.toLowerCase(),
        }))
      )
      .onConflictDoUpdate({
        target: [entityNodes.developerId, entityNodes.memoryUserId, entityNodes.entityType, entityNodes.name],
        set: { lastSeenAt: now },
      })
      .returning({ id: entityNodes.id, entityType: entityNodes.entityType, name: entityNodes.name });

    const nodeIdMap = new Map(upsertedNodes.map((n) => [`${n.entityType}\0${n.name}`, n.id]));

    for (const entity of entities) {
      const fromId = nodeIdMap.get(`${entity.type}\0${entity.name}`);
      if (!fromId) continue;

      // Resolve every relationship to a concrete (relType, toId, current) triple up
      // front, dropping ones whose target didn't resolve or that point at self.
      const rels = (entity.relationships ?? [])
        .map((rel) => {
          const relType = rel.type.trim().toLowerCase();
          const targetType = (rel.targetType ?? "org").trim().toLowerCase();
          const toId = nodeIdMap.get(`${targetType}\0${rel.target.trim()}`);
          return { relType, toId, current: rel.current };
        })
        .filter(
          (r): r is { relType: string; toId: string; current: boolean | undefined } =>
            !!r.toId && r.toId !== fromId
        );

      // 1. Explicit ends — close the active edge to that specific target.
      // Stamp validUntilRecordedAt = now: the moment we learned it ended.
      for (const { relType, toId, current } of rels) {
        if (current !== false) continue;
        await tx
          .update(entityEdges)
          .set({ validUntil: now, validUntilRecordedAt: now })
          .where(and(
            eq(entityEdges.fromEntityId, fromId),
            eq(entityEdges.toEntityId, toId),
            eq(entityEdges.relationship, relType),
            isNull(entityEdges.validUntil),
          ));
      }

      // 2. Supersession — ONLY for single-valued relationship types. For each such
      // type, close active edges whose target is NOT among this pass's current
      // targets. Computing the current-target set first (rather than closing
      // "everything except this one target" per rel) means multiple current edges
      // of a single-valued type in one pass no longer close each other, and no edge
      // is left with a zero-width [validFrom == validUntil] interval. Multi-valued
      // types are skipped entirely so concurrent edges accumulate.
      const currentTargetsByType = new Map<string, Set<string>>();
      for (const { relType, toId, current } of rels) {
        if (current === false) continue;
        if (!SINGLE_VALUED_RELATIONSHIPS.has(relType)) continue;
        const set = currentTargetsByType.get(relType) ?? new Set<string>();
        set.add(toId);
        currentTargetsByType.set(relType, set);
      }
      for (const [relType, targets] of currentTargetsByType) {
        await tx
          .update(entityEdges)
          .set({ validUntil: now, validUntilRecordedAt: now })
          .where(and(
            eq(entityEdges.fromEntityId, fromId),
            eq(entityEdges.relationship, relType),
            isNull(entityEdges.validUntil),
            notInArray(entityEdges.toEntityId, [...targets]),
          ));
      }

      // 3. Insert the active edges. The partial unique index makes a duplicate
      // active edge a no-op — no check-then-insert race. validFrom is stamped to
      // `now` so if this edge is later closed the interval is non-zero-width.
      for (const { relType, toId, current } of rels) {
        if (current === false) continue;
        await tx
          .insert(entityEdges)
          .values({ fromEntityId: fromId, toEntityId: toId, relationship: relType, validFrom: now })
          .onConflictDoNothing({
            target: [entityEdges.fromEntityId, entityEdges.toEntityId, entityEdges.relationship],
            where: sql`${entityEdges.validUntil} IS NULL`,
          });
      }
    }
  });
}
