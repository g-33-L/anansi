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
    <div className="lab-page lab-page--narrow lab-search">
      <header className="lab-page-header">
        <p className="lab-page-overline">Source index</p>
        <Heading level={2}>Search</Heading>
        <Text muted className="mt-1">Keyword search across your organization's ingested memory.</Text>
      </header>

      <form onSubmit={run} className="lab-search-form">
        <Field label="Query" className="flex-1">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. incident response owner" autoFocus />
        </Field>
        <Button type="submit" loading={loading}>Search</Button>
      </form>

      {error && <Alert variant="danger" className="mt-6">{error}</Alert>}

      <div className="mt-9">
        {loading ? (
          <div className="flex justify-center">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : results === null ? (
          <div className="lab-search-prompt"><span>⌘</span><p>Enter a query to search the source index.</p></div>
        ) : results.length === 0 ? (
          <EmptyState className="lab-empty" title="No results" description="Nothing matched — try different keywords, or ingest more content first." />
        ) : (
          <div className="lab-data-list space-y-3">
            {results.map((r) => (
              <Card key={r.id} className="lab-search-result p-5">
                <div className="mb-2 flex items-center gap-2">
                  <Badge>{r.sourceType}</Badge>
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-[.08em] text-muted-foreground">score {r.score.toFixed(3)}</span>
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
