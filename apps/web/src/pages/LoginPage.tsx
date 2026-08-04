/*
 * Passwordless sign-in. Requests a magic link; in dev (no mail transport) the API
 * returns the link inline so login works without email infra.
 */
import { useState, type FormEvent } from "react";
import { Alert, Button, Card, Field, Input } from "@anansi/ui";
import { consoleApi } from "../lib/api.js";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    setDevUrl(null);
    try {
      const res = await consoleApi.requestMagicLink(email);
      setDevUrl(res.devUrl ?? null);
      setStatus("sent");
    } catch (err) {
      setError((err as Error).message);
      setStatus("idle");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-2">
          <span className="inline-block size-6 rounded-sm bg-primary" aria-hidden />
          <span className="text-lg font-semibold tracking-tight">Anansi</span>
        </div>

        {status === "sent" ? (
          <div className="space-y-4">
            <Alert variant="success">Check your email for a sign-in link.</Alert>
            {devUrl && (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="mb-1 text-muted-foreground">Dev mode — no mail transport configured. Use this link:</p>
                <a href={devUrl} className="break-all font-mono text-xs text-primary underline">{devUrl}</a>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={() => setStatus("idle")}>
              Use a different email
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
              <p className="mt-1 text-sm text-muted-foreground">We'll email you a magic link — no password needed.</p>
            </div>
            {error && <Alert variant="danger">{error}</Alert>}
            <Field label="Email">
              <Input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </Field>
            <Button type="submit" className="w-full" loading={status === "sending"}>
              Send magic link
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
