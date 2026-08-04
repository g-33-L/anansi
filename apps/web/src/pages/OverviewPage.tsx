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
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <Heading level={2}>Welcome{me?.user.name ? `, ${me.user.name}` : ""}</Heading>
      <Text muted className="mt-1 flex items-center gap-2">
        {org ? (
          <>
            <span>{org.name}</span>
            <Badge variant="primary">{org.role}</Badge>
          </>
        ) : (
          "No active organization selected."
        )}
      </Text>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {QUICK_ACTIONS.map((a) => (
          <Link key={a.to} to={a.to}>
            <Card className="h-full p-5 transition-colors hover:border-border-strong hover:bg-accent/40">
              <h3 className="font-semibold tracking-tight">{a.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{a.body}</p>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="mt-6 p-5">
        <h3 className="text-sm font-semibold">What's live</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Organizations, members, roles, teams, and profile are backed by the{" "}
          <code className="font-mono text-xs">/console</code> API. Search, memory, evidence, graph, procedures,
          sources, connectors, usage, and billing use the same organization-scoped engine data.
        </p>
      </Card>
    </div>
  );
}
