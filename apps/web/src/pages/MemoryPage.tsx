import { useEffect, useState } from "react";
import { Alert, Badge, Card, EmptyState, Heading, Spinner, Text } from "@anansi/ui";
import { consoleApi, type MemoryProfile } from "../lib/api.js";

function FactList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="p-5">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <ul className="space-y-2">
        {items.map((f, i) => (
          <li key={i} className="text-sm text-muted-foreground">• {f}</li>
        ))}
      </ul>
    </Card>
  );
}

export default function MemoryPage() {
  const [profile, setProfile] = useState<MemoryProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    consoleApi
      .memory()
      .then((r) => setProfile(r.profile))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const empty =
    !profile ||
    (profile.staticFacts.length === 0 &&
      profile.dynamicContext.length === 0 &&
      profile.temporalFacts.length === 0);

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <Heading level={2}>Memory</Heading>
      <Text muted className="mt-1">
        The workspace-level synthesized profile — stable facts, current context, and time-bounded facts.
      </Text>

      {error && <Alert variant="danger" className="mt-6">{error}</Alert>}

      {loading ? (
        <div className="mt-10 flex justify-center">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : empty ? (
        <div className="mt-8">
          <EmptyState
            title="No synthesized memory yet"
            description="Once you ingest content via the API or a connector, the synthesized profile appears here."
          />
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {profile && (
            <p className="text-xs text-muted-foreground">
              Profile v{profile.version} · {profile.chunksSynthesized.toLocaleString()} chunks synthesized
            </p>
          )}
          <FactList title="Static facts" items={profile!.staticFacts} />
          <FactList title="Dynamic context" items={profile!.dynamicContext} />
          {profile!.temporalFacts.length > 0 && (
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold">Temporal facts</h3>
              <ul className="space-y-2">
                {profile!.temporalFacts.map((t, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">{t.fact}</span>
                    {t.validUntil ? (
                      <Badge variant="temporal">until {t.validUntil}</Badge>
                    ) : (
                      <Badge variant="success">current</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
