import { Link } from "react-router-dom";
import { Badge, Card, Heading, Text } from "@anansi/ui";
import { useSession } from "../lib/session.js";

const QUICK_ACTIONS = [
  { to: "/app/settings/members", title: "Invite your team", body: "Add teammates and assign roles." },
  { to: "/app/connectors", title: "Connect a source", body: "Sync Slack, Notion, Google Docs, Linear." },
  { to: "/app/memory", title: "Explore memory", body: "Browse synthesized profiles and chunks." },
  { to: "/app/api-explorer", title: "Use the API", body: "Mint a key and call /v1 from your app." },
];

export default function OverviewPage() {
  const { me } = useSession();
  const org = me?.activeOrganization;

  return (
    <div className="lab-page lab-overview">
      <header className="lab-page-header lab-overview-header">
        <p className="lab-page-overline">Workspace index</p>
        <Heading level={2}>Welcome{me?.user.name ? `, ${me.user.name}` : ""}</Heading>
        <Text muted className="mt-2 flex items-center gap-2">
          {org ? <><span>{org.name}</span><Badge variant="primary">{org.role}</Badge></> : "No active organization selected."}
        </Text>
      </header>

      <section className="lab-overview-intro" aria-label="Workspace status">
        <div>
          <p className="lab-overview-kicker">Working surface</p>
          <p>Start with a source, inspect what Anansi retained, then give your application only the context it needs.</p>
        </div>
        <div className="lab-overview-readout"><span aria-hidden="true" /><span>Organization-scoped</span></div>
      </section>

      <section className="mt-9" aria-labelledby="quick-actions-heading">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h3 id="quick-actions-heading" className="text-sm font-semibold">Start a working session</h3>
          <span className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">Four paths</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
        {QUICK_ACTIONS.map((a) => (
          <Link key={a.to} to={a.to}>
            <Card className="lab-document-card h-full p-5">
              <div className="mb-6 flex items-center justify-between"><span className="lab-action-index">{String(QUICK_ACTIONS.indexOf(a) + 1).padStart(2, "0")}</span><span className="lab-action-arrow" aria-hidden="true">↗</span></div>
              <h3 className="font-semibold tracking-tight">{a.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{a.body}</p>
            </Card>
          </Link>
        ))}
        </div>
      </section>

      <Card className="lab-overview-notice mt-9 p-5">
        <div className="lab-notice-rule" aria-hidden="true" />
        <div>
        <p className="lab-page-overline">Available now</p>
        <h3 className="text-sm font-semibold">Workspace surfaces</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Organizations, members, roles, teams, and profile are backed by the{" "}
          <code className="font-mono text-xs">/console</code> API. Search, memory, evidence, graph, procedures,
          sources, connectors, usage, and billing use the same organization-scoped engine data.
        </p>
        </div>
      </Card>
    </div>
  );
}
