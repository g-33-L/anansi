/*
 * Public TypeScript SDK contract. This is compiled with `tsc --noEmit` as part
 * of the package build, so an accidental response-type or input-type break is a
 * CI failure before a package can be published.
 */
import AnansiMemory, {
  type ContextResult,
  type Entity,
  type IngestResult,
  type ListMemoriesResponse,
  type SearchResponse,
} from "../src/index.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Condition extends true> = Condition;

type Client = InstanceType<typeof AnansiMemory>;
type _IngestResponseIsStable = Expect<Equal<Awaited<ReturnType<Client["ingest"]>>, IngestResult>>;
type _ContextResponseIsStable = Expect<Equal<Awaited<ReturnType<Client["context"]>>, ContextResult>>;
type _SearchResponseIsStable = Expect<Equal<Awaited<ReturnType<Client["search"]>>, SearchResponse>>;
type _MemoriesResponseIsStable = Expect<Equal<Awaited<ReturnType<Client["listMemories"]>>, ListMemoriesResponse>>;
type _EntitiesResponseIsStable = Expect<
  Equal<Awaited<ReturnType<Client["listEntities"]>>, { entities: Entity[] }>
>;
type _DeleteResponseIsStable = Expect<Equal<Awaited<ReturnType<Client["deleteUser"]>>, { deleted: boolean }>>;

const client = new AnansiMemory({ apiKey: "ans_contract_test" });

async function publicSdkResponsesRemainUsable() {
  const ingested = await client.ingest({ userId: "user-123", content: "A durable fact" });
  const ingestId: string = ingested.id;
  const queued: boolean = ingested.queued;

  const context = await client.context({ userId: "user-123", asOf: "2026-08-04" });
  const staticFact: string = context.static[0]!;
  const temporalFact: string = context.temporal[0]!.fact;
  const relationshipTarget: string = context.entities[0]!.relationships[0]!.target.name;

  const search = await client.search({ userId: "user-123", query: "fact", limit: 10 });
  const score: number = search.results[0]!.score;
  const searchTotal: number = search.total;

  const memories = await client.listMemories({ userId: "user-123", limit: 20, offset: 0 });
  const memorySource: string = memories.memories[0]!.sourceType;
  const offset: number = memories.offset;

  const entities = await client.listEntities({ userId: "user-123", asOfKnowledge: "2026-08-04" });
  const entityType: string = entities.entities[0]!.type;

  const deleted = await client.deleteUser("user-123");
  const wasDeleted: boolean = deleted.deleted;

  void [ingestId, queued, staticFact, temporalFact, relationshipTarget, score, searchTotal, memorySource, offset, entityType, wasDeleted];
}

void publicSdkResponsesRemainUsable();

// Input contracts are equally important: they prevent invalid requests from
// compiling in an application's integration layer.
// @ts-expect-error `limit` is numeric, never a query-string value.
client.search({ userId: "user-123", query: "fact", limit: "10" });
// @ts-expect-error sourceType is the documented closed union.
client.ingest({ userId: "user-123", content: "fact", sourceType: "email" });
// @ts-expect-error a memory list always identifies the memory subject.
client.listMemories({ limit: 20 });
