/*
 * Per-organization completion marker for the first-run wizard. It is local to
 * the browser deliberately: setup state contains no authority, and all actual
 * completion work is independently enforced by the console API. The in-memory
 * fallback keeps a private-browsing/session with blocked localStorage usable.
 */
const STORAGE_PREFIX = "anansi:first-run:v1:";
const memoryCompletions = new Set<string>();

function key(organizationId: string): string {
  return `${STORAGE_PREFIX}${organizationId}`;
}

export function hasCompletedFirstRun(organizationId: string): boolean {
  if (memoryCompletions.has(organizationId)) return true;
  try {
    return window.localStorage.getItem(key(organizationId)) === "complete";
  } catch {
    return false;
  }
}

export function markFirstRunComplete(organizationId: string): void {
  memoryCompletions.add(organizationId);
  try {
    window.localStorage.setItem(key(organizationId), "complete");
  } catch {
    // Completion remains available for this tab if persistent storage is blocked.
  }
}
