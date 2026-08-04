/*
 * Anansi Enterprise Edition — licensed under LICENSE-EE, not MIT.
 * See /LICENSE-EE at the repo root. Production use requires a commercial
 * license; evaluation, self-hosted non-production use, and contributions
 * are permitted under LICENSE-EE terms.
 */

import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Field, Input, Spinner } from "@anansi/ui";
import { consoleApi, type TeamDto } from "../../lib/api.js";
import { useSession } from "../../lib/session.js";

export default function TeamsPage() {
  const { me } = useSession();
  const role = me?.activeOrganization?.role;
  const canManage = role === "owner" || role === "admin";

  const [teams, setTeams] = useState<TeamDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await consoleApi.listTeams();
      setTeams(r.teams);
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

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await consoleApi.createTeam(name.trim());
      setName("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {canManage && (
        <Card className="p-6">
          <h3 className="font-semibold">Create a team</h3>
          <form onSubmit={create} className="mt-4 flex items-end gap-3">
            <Field label="Team name" className="flex-1">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Engineering" />
            </Field>
            <Button type="submit">Create</Button>
          </form>
        </Card>
      )}

      {teams.length === 0 ? (
        <p className="text-sm text-muted-foreground">No teams yet.</p>
      ) : (
        <Card className="divide-y divide-border">
          {teams.map((t) => (
            <div key={t.id} className="flex items-center justify-between p-4">
              <span className="text-sm font-medium">{t.name}</span>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => void consoleApi.deleteTeam(t.id).then(load)}
                >
                  Delete
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
