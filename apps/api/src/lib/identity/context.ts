/*
 * The resolved session context attached to every authenticated /console request
 * by requireSession(). `organization`/`membership`/`role` are null only in the
 * brief window after signup before the user has selected/created an org.
 */
import type { Membership, Organization, User, UserSession } from "../db/schema.js";
import type { Role } from "./roles.js";

export interface SessionContext {
  user: User;
  session: UserSession;
  organization: Organization | null;
  membership: Membership | null;
  role: Role | null;
}
