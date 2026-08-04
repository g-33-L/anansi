import { useEffect, useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, Checkbox, CodeBlock, Field, Heading, Input, Spinner, Text } from "@anansi/ui";
import { consoleApi, type ApiKeyDto } from "../lib/api.js";
import { useSession } from "../lib/session.js";

const SCOPES = ["ingest", "read", "entities", "ledger", "admin"];

export default function ApiKeysPage() {
  const { me } = useSession();
  const role = me?.activeOrganization?.role;
  const canManage = role === "owner" || role === "admin" || role === "member";

  const [keys, setKeys] = useState<ApiKeyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await consoleApi.listApiKeys();
      setKeys(r.keys);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function toggleScope(s: string) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await consoleApi.createApiKey(name.trim() || "Default", scopes);
      setSecret(r.secret);
      setName("");
      setScopes([]);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) {
    return (
      <div className="lab-page lab-page--narrow">
        <div className="flex justify-center py-12">
          <Spinner className="text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="lab-page lab-page--narrow lab-api-keys">
      <header className="lab-page-header">
        <p className="lab-page-overline">Access control</p>
        <Heading level={2}>API Keys</Heading>
        <Text muted className="mt-1">Bearer keys for the public <code className="font-mono text-xs">/v1</code> API. Keys are shown once — store them securely.</Text>
      </header>

      {error && <Alert variant="danger" className="mt-6">{error}</Alert>}

      {secret && (
        <Card className="lab-key-reveal mt-6 p-5">
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="success">New key</Badge>
            <span className="text-sm text-muted-foreground">Copy it now — you won't see it again.</span>
          </div>
          <CodeBlock code={secret} />
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setSecret(null)}>
            Dismiss
          </Button>
        </Card>
      )}

      {canManage && (
        <Card className="lab-key-create mt-6 p-6">
          <h3 className="font-semibold">Create a key</h3>
          <form onSubmit={create} className="mt-4 space-y-4">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production" />
            </Field>
            <div>
              <p className="mb-2 text-sm font-medium">
                Scopes <span className="font-normal text-muted-foreground">(none = full access)</span>
              </p>
              <div className="flex flex-wrap gap-4">
                {SCOPES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={scopes.includes(s)} onChange={() => toggleScope(s)} />
                    {s}
                  </label>
                ))}
              </div>
            </div>
            <Button type="submit">Create key</Button>
          </form>
        </Card>
      )}

      <div className="mt-8">
        <h3 className="mb-3 font-semibold">Keys ({keys.length})</h3>
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No API keys yet.</p>
        ) : (
          <Card className="lab-data-list divide-y divide-border">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{k.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {k.scopes.length ? k.scopes.join(", ") : "full access"} · created{" "}
                    {new Date(k.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => void consoleApi.revokeApiKey(k.id).then(load)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
