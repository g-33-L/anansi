import { useEffect, useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, Field, Input, Select, Spinner } from "@anansi/ui";
import { consoleApi, type InviteDto, type MemberDto } from "../../lib/api.js";
import { useSession } from "../../lib/session.js";

const ROLES = ["owner", "admin", "member", "billing", "auditor", "viewer"];

export default function MembersPage() {
  const { me } = useSession();
  const role = me?.activeOrganization?.role;
  const canManage = role === "owner" || role === "admin";

  const [members, setMembers] = useState<MemberDto[]>([]);
  const [invites, setInvites] = useState<InviteDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteMsg, setInviteMsg] = useState<{ text: string; url?: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [m, i] = await Promise.all([consoleApi.listMembers(), consoleApi.listInvitations()]);
      setMembers(m.members);
      setInvites(i.invitations);
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

  async function invite(e: FormEvent) {
    e.preventDefault();
    setInviteMsg(null);
    try {
      const res = await consoleApi.invite(inviteEmail, inviteRole);
      setInviteEmail("");
      setInviteMsg({ text: `Invited ${res.invitation.email}.`, url: res.acceptUrl });
      await load();
    } catch (err) {
      setInviteMsg({ text: (err as Error).message });
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
    <div className="space-y-8">
      {error && <Alert variant="danger">{error}</Alert>}

      {canManage && (
        <Card className="p-6">
          <h3 className="font-semibold">Invite a member</h3>
          <form onSubmit={invite} className="mt-4 flex flex-wrap items-end gap-3">
            <Field label="Email" className="min-w-56 flex-1">
              <Input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
              />
            </Field>
            <Field label="Role">
              <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </Select>
            </Field>
            <Button type="submit">Send invite</Button>
          </form>
          {inviteMsg && (
            <div className="mt-3 text-sm">
              <p className="text-muted-foreground">{inviteMsg.text}</p>
              {inviteMsg.url && (
                <a href={inviteMsg.url} className="break-all font-mono text-xs text-primary underline">
                  {inviteMsg.url}
                </a>
              )}
            </div>
          )}
        </Card>
      )}

      <div>
        <h3 className="mb-3 font-semibold">Members ({members.length})</h3>
        <Card className="divide-y divide-border">
          {members.map((m) => (
            <div key={m.membershipId} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{m.user.name || m.user.email}</p>
                <p className="truncate text-xs text-muted-foreground">{m.user.email}</p>
              </div>
              <div className="flex items-center gap-2">
                {canManage ? (
                  <Select
                    value={m.role}
                    onChange={(e) => void consoleApi.updateMemberRole(m.membershipId, e.target.value).then(load)}
                    className="h-8"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </Select>
                ) : (
                  <Badge>{m.role}</Badge>
                )}
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => void consoleApi.removeMember(m.membershipId).then(load)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </Card>
      </div>

      {invites.length > 0 && (
        <div>
          <h3 className="mb-3 font-semibold">Pending invitations ({invites.length})</h3>
          <Card className="divide-y divide-border">
            {invites.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm">{i.email}</p>
                  <p className="text-xs text-muted-foreground">{i.role}</p>
                </div>
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={() => void consoleApi.revokeInvitation(i.id).then(load)}>
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
