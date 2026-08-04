import { useState, type FormEvent } from "react";
import { Button, Card, Field, Input } from "@anansi/ui";
import { useSession } from "../../lib/session.js";
import { consoleApi } from "../../lib/api.js";

export default function ProfilePage() {
  const { me, refresh } = useSession();
  const [name, setName] = useState(me?.user.name ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await consoleApi.updateProfile({ name });
      await refresh();
      setMsg("Saved.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-lg p-6">
      <form onSubmit={save} className="space-y-4">
        <Field label="Email" hint="Your sign-in email can't be changed here.">
          <Input value={me?.user.email ?? ""} disabled />
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </Field>
        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
        <Button type="submit" loading={saving}>
          Save changes
        </Button>
      </form>
    </Card>
  );
}
