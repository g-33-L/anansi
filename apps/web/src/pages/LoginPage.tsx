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
    <div className="lab-auth">
      <Card className="lab-auth-panel">
        <div className="lab-auth-brand">
          <span className="lab-brand-mark" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3.3" stroke="currentColor" strokeWidth="1.25" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" /></svg></span>
          <div><span className="block text-[15px] font-semibold tracking-tight">Anansi</span><p>Knowledge infrastructure</p></div>
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
