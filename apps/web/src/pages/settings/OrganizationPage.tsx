import { useState, type FormEvent } from "react";
import { Button, Card, Field, Input } from "@anansi/ui";
import { useSession } from "../../lib/session.js";
import { consoleApi } from "../../lib/api.js";

export default function OrganizationPage() {
  const { me, refresh } = useSession();
  const org = me?.activeOrganization;
  const canEdit = org?.role === "owner" || org?.role === "admin";
  const [name, setName] = useState(org?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await consoleApi.updateOrganization(name);
      await refresh();
      setMsg("Saved.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!org) return <p className="text-sm text-muted-foreground">No active organization.</p>;

  return (
    <Card className="max-w-lg p-6">
      <form onSubmit={save} className="space-y-4">
        <Field label="Organization name">
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
        </Field>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Slug</span>
          <code className="font-mono text-xs text-foreground">{org.slug}</code>
        </div>
        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
        {canEdit && (
          <Button type="submit" loading={saving}>
            Save changes
          </Button>
        )}
      </form>
    </Card>
  );
}
