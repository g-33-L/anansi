import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Card, EmptyState, Heading, Spinner, Text } from "@anansi/ui";
import {
  consoleApi,
  type BillingSummary,
  type ConnectorDto,
  type DivergenceDto,
  type GraphEdgeDto,
  type GraphNodeDto,
  type LedgerClaimDto,
  type ProcedureDto,
  type SourceChunkDto,
  type SourceSummaryDto,
  type TimelineEntryDto,
} from "../lib/api.js";

export type Surface = "graph" | "facts" | "relationships" | "procedures" | "people" | "sources" | "connectors" | "api-explorer" | "billing" | "timeline";

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
function date(value: string | null | undefined) {
  return value ? DATE.format(new Date(value)) : "—";
}
function readable(value: string) {
  return value.replace(/_/g, " ");
}

function Loading() {
  return <div className="flex justify-center py-12"><Spinner className="text-muted-foreground" /></div>;
}

function GraphDiagram({ nodes, edges }: { nodes: GraphNodeDto[]; edges: GraphEdgeDto[] }) {
  const plotted = nodes.slice(0, 20).map((node, index) => {
    if (index === 0) return { node, x: 320, y: 180 };
    const angle = ((index - 1) / Math.max(1, Math.min(nodes.length - 1, 19))) * Math.PI * 2 - Math.PI / 2;
    const radiusX = index % 2 ? 192 : 144;
    const radiusY = index % 2 ? 108 : 132;
    return { node, x: 320 + Math.cos(angle) * radiusX, y: 180 + Math.sin(angle) * radiusY };
  });
  const byId = new Map(plotted.map((point) => [point.node.id, point]));
  const visibleEdges = edges.filter((edge) => byId.has(edge.fromEntityId) && byId.has(edge.toEntityId)).slice(0, 34);

  return (
    <div className="lab-graph-stage" role="img" aria-label={`${nodes.length} entities and ${edges.length} relationships`}>
      <span className="lab-graph-label">Relationship field</span>
      <svg viewBox="0 0 640 360" className="lab-graph-svg" aria-hidden="true">
        {visibleEdges.map((edge) => {
          const from = byId.get(edge.fromEntityId)!;
          const to = byId.get(edge.toEntityId)!;
          return <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="lab-graph-edge" />;
        })}
        {plotted.map(({ node, x, y }, index) => (
          <g key={node.id}>
            <circle cx={x} cy={y} r={index === 0 ? 16 : 11} className="lab-graph-node" />
            <text x={x} y={y + (index === 0 ? 31 : 26)} textAnchor="middle" className="lab-graph-node-label">{node.name.slice(0, 18)}</text>
          </g>
        ))}
      </svg>
      <span className="lab-graph-legend">{visibleEdges.length} visible relations / {nodes.length} entities</span>
    </div>
  );
}

function GraphView({ mode, nodes, edges }: { mode: "graph" | "relationships"; nodes: GraphNodeDto[]; edges: GraphEdgeDto[] }) {
  const names = useMemo(() => new Map(nodes.map((node) => [node.id, node.name])), [nodes]);
  if (!nodes.length) return <EmptyState title="No entities yet" description="Entity and relationship data appears after synthesized memory has been extracted from ingested content." />;
  if (mode === "relationships") {
    return edges.length ? (
      <div className="space-y-3">
        {edges.map((edge) => (
          <Card key={edge.id} className="lab-document-card p-4">
            <p className="text-sm font-medium">{names.get(edge.fromEntityId) ?? "Unknown"} <span className="font-normal text-muted-foreground">{readable(edge.relationship)}</span> {names.get(edge.toEntityId) ?? "Unknown"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{edge.validUntil ? `ended ${date(edge.validUntil)}` : "active"} · confidence {edge.confidence.toFixed(2)}</p>
          </Card>
        ))}
      </div>
    ) : <EmptyState title="No relationships yet" description="Relationships are extracted from synthesized memory when the workspace has evidence connecting entities." />;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1.55fr_.85fr]">
      <GraphDiagram nodes={nodes} edges={edges} />
      <Card className="lab-graph-index p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3"><h3 className="text-sm font-semibold">Entity index</h3><span className="font-mono text-[10px] uppercase tracking-[.08em] text-muted-foreground">{nodes.length}</span></div>
        <div className="space-y-2">
          {nodes.slice(0, 16).map((node) => <div key={node.id} className="flex items-center justify-between gap-3 border-b border-border/70 py-2 text-sm last:border-0"><span className="truncate">{node.name}</span><Badge>{node.entityType}</Badge></div>)}
        </div>
        {nodes.length > 16 && <p className="mt-4 font-mono text-[10px] uppercase tracking-[.08em] text-muted-foreground">+ {nodes.length - 16} more entities</p>}
      </Card>
    </div>
  );
}

function ClaimsView({ claims, divergences }: { claims: LedgerClaimDto[]; divergences: DivergenceDto[] }) {
  if (!claims.length) return <EmptyState title="No evidence-backed facts yet" description="Facts appear after the ledger extracts cited claims from ingested content." />;
  return <div className="space-y-4">
    {divergences.length > 0 && <Alert variant="warning">{divergences.length} documented-vs-observed divergence{divergences.length === 1 ? "" : "s"} need review.</Alert>}
    {claims.map((claim, index) => <Card key={`${claim.claimKey ?? "claim"}-${index}`} className="p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant={claim.status === "observed" ? "success" : "default"}>{claim.status}</Badge>{claim.disputed && <Badge variant="warning">disputed</Badge>}<span className="text-xs text-muted-foreground">confidence {claim.confidence.toFixed(2)}</span></div>
      <p className="text-sm">{claim.claim}</p>
      {claim.evidence.length > 0 && <div className="mt-3 border-l-2 border-border pl-3 text-xs text-muted-foreground">{claim.evidence.slice(0, 2).map((evidence, evidenceIndex) => <p key={evidenceIndex}>“{evidence.quote}”</p>)}</div>}
    </Card>)}
  </div>;
}

function TimelineView({ entries }: { entries: TimelineEntryDto[] }) {
  return entries.length ? <div className="space-y-3">{entries.map((entry) => <Card key={`${entry.fingerprint}-${entry.kind}-${entry.at}`} className="p-4"><div className="flex items-center gap-2"><Badge variant={entry.kind === "adopted" ? "success" : "default"}>{entry.kind}</Badge><span className="text-xs text-muted-foreground">{date(entry.at)}</span></div><p className="mt-2 text-sm">{entry.claim}</p></Card>)}</div> : <EmptyState title="No timeline entries yet" description="The timeline records when evidence-backed facts were adopted or superseded." />;
}

function ProceduresView({ procedures }: { procedures: ProcedureDto[] }) {
  return procedures.length ? <div className="space-y-3">{procedures.map((procedure) => <Card key={procedure.id} className="p-5"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{procedure.title}</h3><Badge>{procedure.status}</Badge>{procedure.currentVersion && <span className="text-xs text-muted-foreground">v{procedure.currentVersion}</span>}</div><p className="mt-2 text-sm text-muted-foreground">{procedure.description || "No description supplied."}</p><p className="mt-3 text-xs text-muted-foreground">{procedure.steps?.length ?? 0} steps · updated {date(procedure.updatedAt)}</p></Card>)}</div> : <EmptyState title="No procedures yet" description="Procedures appear here when extracted skills have been reviewed and published." />;
}

function SourcesView({ summaries, recent }: { summaries: SourceSummaryDto[]; recent: SourceChunkDto[] }) {
  if (!summaries.length) return <EmptyState title="No sources yet" description="Ingest content through the API or connect a source to begin building workspace memory." />;
  return <div className="space-y-6"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{summaries.map((source) => <Card key={source.sourceType} className="p-4"><p className="text-sm font-medium">{readable(source.sourceType)}</p><p className="mt-1 text-sm text-muted-foreground">{source.count.toLocaleString()} chunks</p><p className="mt-2 text-xs text-muted-foreground">latest {date(source.latestAt)}</p></Card>)}</div><div><h3 className="mb-3 text-sm font-semibold">Recent content</h3><div className="space-y-3">{recent.map((chunk) => <Card key={chunk.id} className="p-4"><div className="mb-2 flex items-center gap-2"><Badge>{chunk.sourceType}</Badge><span className="truncate text-xs text-muted-foreground">{chunk.sourceId}</span></div><p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{chunk.content}</p></Card>)}</div></div></div>;
}

const CONNECTOR_LABELS: Record<ConnectorDto["provider"], string> = { notion: "Notion", google_docs: "Google Docs", linear: "Linear", transcript_webhook: "Meeting transcripts" };
function ConnectorsView({ connectors }: { connectors: ConnectorDto[] }) {
  const byProvider = new Map(connectors.map((connector) => [connector.provider, connector]));
  return <div className="grid gap-4 sm:grid-cols-2">{(Object.keys(CONNECTOR_LABELS) as ConnectorDto["provider"][]).map((provider) => {
    const connector = byProvider.get(provider);
    return <Card key={provider} className="p-5"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{CONNECTOR_LABELS[provider]}</h3><Badge variant={connector ? "success" : "default"}>{connector ? "connected" : "not connected"}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{connector ? `Last synced ${date(connector.lastSyncedAt)}.` : "Connection setup is available to workspace administrators."}</p>{connector?.expiresAt && <p className="mt-2 text-xs text-muted-foreground">Token expires {date(connector.expiresAt)}</p>}{!connector && (provider === "notion" || provider === "google_docs") && <a href={`/console/connectors/${provider}/connect`} className="mt-4 inline-flex text-sm font-medium text-primary hover:underline">Connect {CONNECTOR_LABELS[provider]} →</a>}</Card>;
  })}</div>;
}

function BillingView({ billing }: { billing: BillingSummary }) {
  const price = billing.monthlyPriceUsd < 0 ? "Contact us" : billing.monthlyPriceUsd === 0 ? "Free" : `$${billing.monthlyPriceUsd}/month`;
  return <Card className="max-w-xl p-6"><div className="flex items-center gap-2"><Heading level={3}>{billing.displayName}</Heading><Badge variant={billing.status === "active" || billing.status === "trialing" ? "success" : "warning"}>{billing.status}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{price} · {billing.supportTier} support</p><p className="mt-5 text-sm">{billing.currentPeriodEnd ? `Current period ends ${date(billing.currentPeriodEnd)}.` : "No renewal date is recorded for this plan."}</p><p className="mt-5 text-sm text-muted-foreground">Billing changes are restricted to organization owners and billing administrators.</p></Card>;
}

function ApiExplorerView() {
  return <Card className="max-w-3xl p-6"><Heading level={3}>Call the public API</Heading><Text muted className="mt-2">Create a scoped API key, then use it from your application or terminal. The browser never stores your secret after it is shown once.</Text><pre className="mt-5 overflow-x-auto rounded-md bg-muted p-4 text-xs">{`curl -X POST "$ANANSI_URL/v1/search" \\\n+  -H "Authorization: Bearer $ANANSI_API_KEY" \\\n+  -H "Content-Type: application/json" \\\n+  -d '{"query":"incident response owner"}'`}</pre><div className="mt-5 flex gap-3"><Link className="text-sm font-medium text-primary hover:underline" to="/app/integrations">Manage API keys →</Link><a className="text-sm font-medium text-primary hover:underline" href="/docs/api-reference">API reference →</a></div></Card>;
}

export default function SurfacePage({ title, description, surface }: { title: string; description: string; surface: Surface }) {
  const [loading, setLoading] = useState(surface !== "api-explorer");
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<{ nodes: GraphNodeDto[]; edges: GraphEdgeDto[] } | null>(null);
  const [ledger, setLedger] = useState<{ claims: LedgerClaimDto[]; timeline: TimelineEntryDto[]; divergences: DivergenceDto[] } | null>(null);
  const [procedures, setProcedures] = useState<ProcedureDto[] | null>(null);
  const [people, setPeople] = useState<{ users: { id: string; externalId: string; optedOut: boolean; createdAt: string }[]; entities: Pick<GraphNodeDto, "id" | "name" | "firstSeenAt" | "lastSeenAt">[] } | null>(null);
  const [sources, setSources] = useState<{ sourceTypes: SourceSummaryDto[]; recent: SourceChunkDto[] } | null>(null);
  const [connectors, setConnectors] = useState<ConnectorDto[] | null>(null);
  const [billing, setBilling] = useState<BillingSummary | null>(null);

  useEffect(() => {
    if (surface === "api-explorer") return;
    let active = true;
    const load = async () => {
      try {
        if (surface === "graph" || surface === "relationships") { const value = await consoleApi.graph(); if (active) setGraph(value); }
        else if (surface === "facts" || surface === "timeline") { const value = await consoleApi.ledger(); if (active) setLedger(value.ledger ? { claims: value.ledger.claims, timeline: value.timeline, divergences: value.divergences } : null); }
        else if (surface === "procedures") { const value = await consoleApi.procedures(); if (active) setProcedures(value.procedures); }
        else if (surface === "people") { const value = await consoleApi.people(); if (active) setPeople(value); }
        else if (surface === "sources") { const value = await consoleApi.sources(); if (active) setSources(value); }
        else if (surface === "connectors") { const value = await consoleApi.connectors(); if (active) setConnectors(value.connectors); }
        else if (surface === "billing") { const value = await consoleApi.billing(); if (active) setBilling(value.subscription); }
      } catch (err) { if (active) setError((err as Error).message); }
      finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [surface]);

  let content: ReactNode;
  if (loading) content = <Loading />;
  else if (error) content = <Alert variant="danger">{error}</Alert>;
  else if (surface === "api-explorer") content = <ApiExplorerView />;
  else if ((surface === "graph" || surface === "relationships") && graph) content = <GraphView mode={surface} {...graph} />;
  else if (surface === "facts" && ledger) content = <ClaimsView claims={ledger.claims} divergences={ledger.divergences} />;
  else if (surface === "timeline" && ledger) content = <TimelineView entries={ledger.timeline} />;
  else if (surface === "procedures" && procedures) content = <ProceduresView procedures={procedures} />;
  else if (surface === "people" && people) content = people.users.length || people.entities.length ? <div className="grid gap-4 sm:grid-cols-2"><Card className="p-5"><h3 className="mb-3 text-sm font-semibold">Memory users ({people.users.length})</h3>{people.users.map((user) => <p key={user.id} className="mb-2 text-sm">{user.externalId}{user.optedOut && <span className="ml-2 text-xs text-muted-foreground">opted out</span>}</p>)}</Card><Card className="p-5"><h3 className="mb-3 text-sm font-semibold">People in the graph ({people.entities.length})</h3>{people.entities.map((person) => <p key={person.id} className="mb-2 text-sm">{person.name}</p>)}</Card></div> : <EmptyState title="No people yet" description="People appear as you ingest person-scoped content and entity extraction runs." />;
  else if (surface === "sources" && sources) content = <SourcesView summaries={sources.sourceTypes} recent={sources.recent} />;
  else if (surface === "connectors" && connectors) content = <ConnectorsView connectors={connectors} />;
  else if (surface === "billing" && billing) content = <BillingView billing={billing} />;
  else content = <EmptyState title={`No ${title.toLowerCase()} data yet`} description="This workspace has not produced data for this surface yet." />;

  return <div className="lab-page lab-surface"><header className="lab-page-header"><p className="lab-page-overline">{surface.replace(/-/g, " ")}</p><Heading level={2}>{title}</Heading><Text muted className="mt-1">{description}</Text></header><div className="mt-8">{content}</div></div>;
}
