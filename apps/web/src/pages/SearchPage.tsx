import { useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, EmptyState, Field, Heading, Input, Spinner, Text } from "@anansi/ui";
import { consoleApi, type SearchHit } from "../lib/api.js";

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await consoleApi.search(q.trim());
      setResults(r.results);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <Heading level={2}>Search</Heading>
      <Text muted className="mt-1">Keyword search across your organization's ingested memory.</Text>

      <form onSubmit={run} className="mt-6 flex items-end gap-3">
        <Field label="Query" className="flex-1">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. incident response owner" autoFocus />
        </Field>
        <Button type="submit" loading={loading}>Search</Button>
      </form>

      {error && <Alert variant="danger" className="mt-6">{error}</Alert>}

      <div className="mt-8">
        {loading ? (
          <div className="flex justify-center">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : results === null ? (
          <p className="text-sm text-muted-foreground">Enter a query to search.</p>
        ) : results.length === 0 ? (
          <EmptyState title="No results" description="Nothing matched — try different keywords, or ingest more content first." />
        ) : (
          <div className="space-y-3">
            {results.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Badge>{r.sourceType}</Badge>
                  <span className="text-xs text-muted-foreground">score {r.score.toFixed(3)}</span>
                </div>
                <p className="text-sm">{r.content}</p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
