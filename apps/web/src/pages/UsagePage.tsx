import { useEffect, useState } from "react";
import { Alert, Badge, Card, Heading, Spinner, Text } from "@anansi/ui";
import { consoleApi, type UsageMetric, type UsageSummary } from "../lib/api.js";

function Meter({ label, metric }: { label: string; metric: UsageMetric }) {
  const unlimited = metric.limit === null;
  const pct = !unlimited && metric.limit! > 0 ? Math.min(100, Math.round((metric.used / metric.limit!) * 100)) : 0;
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-sm">
          {metric.used.toLocaleString()}{" "}
          <span className="text-muted-foreground">/ {unlimited ? "∞" : metric.limit!.toLocaleString()}</span>
        </p>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </Card>
  );
}

export default function UsagePage() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    consoleApi
      .usage()
      .then((r) => setUsage(r.usage))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <Heading level={2}>Usage</Heading>
      <Text muted className="mt-1 flex items-center gap-2">
        {usage ? (
          <>
            <Badge variant="primary">{usage.plan}</Badge>
            <span>{usage.month}</span>
          </>
        ) : (
          "This month's usage against your plan's limits."
        )}
      </Text>

      {error && <Alert variant="danger" className="mt-6">{error}</Alert>}

      {loading ? (
        <div className="mt-10 flex justify-center">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : (
        usage && (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <Meter label="API ingest calls" metric={usage.apiIngest} />
            <Meter label="API context calls" metric={usage.apiContext} />
            <Meter label="Queries" metric={usage.queries} />
            <Meter label="Messages" metric={usage.messages} />
            <Meter label="Connected channels" metric={usage.channels} />
          </div>
        )
      )}
    </div>
  );
}
