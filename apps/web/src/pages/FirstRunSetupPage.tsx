/*
 * Owner-focused, first-run path. It deliberately composes the same scoped
 * console endpoints used by Settings, API Keys, and Search rather than adding a
 * privileged onboarding backdoor. A completed run leaves one real memory item
 * in the active organization and proves it can be retrieved.
 */
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Badge, Button, Card, CodeBlock, Field, Heading, Input, Text } from "@anansi/ui";
import { consoleApi } from "../lib/api.js";
import { markFirstRunComplete } from "../lib/first-run.js";
import { useSession } from "../lib/session.js";

const STEPS = ["Organization", "Invite", "API key", "Verify memory"];
const SMOKE_PREFIX = "Anansi first-run verification";

type SmokeStatus = "idle" | "seeding" | "queued" | "verified" | "error";

function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-4" aria-label="Setup progress">
      {STEPS.map((label, index) => {
        const complete = index < current;
        const active = index === current;
        return (
          <li
            key={label}
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
              active ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"
            }`}
          >
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                complete ? "bg-success text-success-foreground" : active ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
              aria-hidden
            >
              {complete ? "✓" : index + 1}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

export default function FirstRunSetupPage() {
  const navigate = useNavigate();
  const { me, refresh } = useSession();
  const organization = me?.activeOrganization;
  const isOwner = organization?.role === "owner";

  const [step, setStep] = useState(0);
  const [organizationName, setOrganizationName] = useState(organization?.name ?? "");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteResult, setInviteResult] = useState<{ email: string; acceptUrl?: string } | null>(null);
  const [keyName, setKeyName] = useState("First-run verification");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [smokeStatus, setSmokeStatus] = useState<SmokeStatus>("idle");

  if (!organization) {
    return (
      <div className="mx-auto max-w-2xl p-6 sm:p-8">
        <Heading level={2}>Finish account setup</Heading>
        <Alert variant="warning" className="mt-6">
          No active organization is selected. Select an organization in the header, then reopen setup.
        </Alert>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="mx-auto max-w-2xl p-6 sm:p-8">
        <Heading level={2}>Setup needs an owner</Heading>
        <Alert variant="warning" className="mt-6">
          An organization owner must create the initial key and run the memory check. Ask an owner of {organization.name} to complete this guide.
        </Alert>
      </div>
    );
  }

  async function saveOrganization(event: FormEvent) {
    event.preventDefault();
    const name = organizationName.trim();
    if (!name) {
      setError("Give this organization a name before continuing.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await consoleApi.updateOrganization(name);
      await refresh();
      setNotice("Organization ready.");
      setStep(1);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function sendInvite(event: FormEvent) {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email) {
      setStep(2);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await consoleApi.invite(email, "member");
      setInviteResult({ email: result.invitation.email, acceptUrl: result.acceptUrl });
      setNotice("Invitation created.");
      setStep(2);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function createKey() {
    setSaving(true);
    setError(null);
    try {
      // Least privilege for the verification flow: it can ingest and read, but
      // cannot administer data. The raw secret stays only in component memory.
      const result = await consoleApi.createApiKey(keyName.trim() || "First-run verification", ["ingest", "read"]);
      setApiKey(result.secret);
      setNotice("API key created. Copy it before leaving this page.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function checkSeededMemory(): Promise<boolean> {
    try {
      const result = await consoleApi.search(SMOKE_PREFIX);
      const verified = result.results.some((item) => item.content.includes(SMOKE_PREFIX));
      setSmokeStatus(verified ? "verified" : "queued");
      if (verified) setNotice("Memory verified: the setup item is searchable in this organization.");
      return verified;
    } catch (cause) {
      setSmokeStatus("error");
      setError((cause as Error).message);
      return false;
    }
  }

  async function seedAndVerify() {
    if (!apiKey) {
      setError("Create this setup key first. Its secret is needed only for this verification request.");
      return;
    }
    setSaving(true);
    setError(null);
    setSmokeStatus("seeding");
    try {
      const sourceId = `first-run-${crypto.randomUUID()}`;
      const content = `${SMOKE_PREFIX}: ${organization!.name} is ready to use Anansi memory.`;
      const response = await fetch("/v1/ingest", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: "anansi-first-run",
          content,
          sourceType: "note",
          sourceId,
          metadata: { title: "Anansi first-run verification" },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `Ingest failed (${response.status})`);

      setSmokeStatus("queued");
      setNotice("Setup memory was accepted and is being indexed. Check search when the worker has processed it.");
      await checkSeededMemory();
    } catch (cause) {
      setSmokeStatus("error");
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function finish() {
    markFirstRunComplete(organization!.id);
    navigate("/app", { replace: true });
  }

  return (
    <div className="mx-auto max-w-3xl p-6 sm:p-8" data-testid="first-run-setup">
      <Badge variant="primary">First-run setup</Badge>
      <Heading level={2} className="mt-3">Make {organization.name} ready for memory</Heading>
      <Text muted className="mt-2">
        This owner-only guide creates a safe verification key, seeds one real memory item, and confirms it can be searched.
      </Text>

      <div className="mt-8">
        <StepIndicator current={step} />
      </div>

      {error && <Alert variant="danger" className="mt-6">{error}</Alert>}
      {notice && <Alert variant="success" className="mt-6">{notice}</Alert>}

      {step === 0 && (
        <Card className="mt-6 p-6">
          <Heading level={3}>1. Confirm your organization</Heading>
          <Text muted className="mt-1">Choose the name teammates will see in the console.</Text>
          <form onSubmit={saveOrganization} className="mt-5 space-y-4">
            <Field label="Organization name">
              <Input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} autoFocus />
            </Field>
            <Button type="submit" loading={saving}>Save and continue</Button>
          </form>
        </Card>
      )}

      {step === 1 && (
        <Card className="mt-6 p-6">
          <Heading level={3}>2. Invite a teammate</Heading>
          <Text muted className="mt-1">Optional, but a good way to confirm your organization is ready for collaboration.</Text>
          <form onSubmit={sendInvite} className="mt-5 space-y-4">
            <Field label="Teammate email">
              <Input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@company.com" />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" loading={saving}>Send invite and continue</Button>
              <Button variant="ghost" onClick={() => setStep(2)}>Skip for now</Button>
            </div>
          </form>
          {inviteResult && (
            <Alert variant="success" className="mt-5">
              Invited {inviteResult.email}. {inviteResult.acceptUrl && (
                <a className="ml-1 break-all underline" href={inviteResult.acceptUrl}>Copy the local acceptance link</a>
              )}
            </Alert>
          )}
        </Card>
      )}

      {step === 2 && (
        <Card className="mt-6 p-6">
          <Heading level={3}>3. Create a verification API key</Heading>
          <Text muted className="mt-1">This key has only ingest and read scopes. It is used once below and shown only now.</Text>
          {!apiKey ? (
            <div className="mt-5 space-y-4">
              <Field label="Key name">
                <Input value={keyName} onChange={(event) => setKeyName(event.target.value)} />
              </Field>
              <Button loading={saving} onClick={() => void createKey()}>Create verification key</Button>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <CodeBlock code={apiKey} language="API key — copy now" />
              <Alert variant="warning">Store this key in your application or secret manager. It will not be shown again.</Alert>
              <Button onClick={() => setStep(3)}>I copied the key — continue</Button>
            </div>
          )}
        </Card>
      )}

      {step === 3 && (
        <Card className="mt-6 p-6">
          <Heading level={3}>4. Seed and verify memory</Heading>
          <Text muted className="mt-1">
            We will ingest a small setup note with the key above, then search for it through the signed-in console.
          </Text>
          <div className="mt-5 flex flex-wrap gap-3">
            {smokeStatus === "idle" || smokeStatus === "error" ? (
              <Button loading={saving} onClick={() => void seedAndVerify()}>Seed verification memory</Button>
            ) : smokeStatus === "queued" ? (
              <Button loading={saving} onClick={() => void checkSeededMemory()}>Check search again</Button>
            ) : null}
            {smokeStatus === "verified" && <Button onClick={finish}>Finish setup</Button>}
          </div>
          {smokeStatus === "seeding" && <Text muted className="mt-4">Submitting the verification memory…</Text>}
          {smokeStatus === "queued" && (
            <Alert variant="info" className="mt-5">
              The item is queued for indexing. Keep the worker running, then use “Check search again” until it appears. You can also inspect it from Search after setup.
            </Alert>
          )}
        </Card>
      )}
    </div>
  );
}
