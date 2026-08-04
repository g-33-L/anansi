/**
 * Shared query parsing for newest-first, date-keyset console feeds.
 *
 * Keep the grammar deliberately small and predictable: `limit` is an integer
 * from 1 to 500 and `before` is an ISO-8601 instant. Handlers turn parser
 * failures into the uniform `{ error }` response used by the console BFF.
 */
export interface KeysetPagination {
  limit: number;
  before?: Date;
}

export type KeysetPaginationResult =
  | { ok: true; value: KeysetPagination }
  | { ok: false; error: string };

export function parseKeysetPagination(
  query: (name: string) => string | undefined,
  options: { defaultLimit?: number; maxLimit?: number } = {}
): KeysetPaginationResult {
  const defaultLimit = options.defaultLimit ?? 100;
  const maxLimit = options.maxLimit ?? 500;
  const limitRaw = query("limit");
  let limit = defaultLimit;

  if (limitRaw !== undefined) {
    // Number("1.5") and Number("") are both surprising pagination inputs.
    if (!/^\d+$/.test(limitRaw)) {
      return { ok: false, error: `limit must be an integer between 1 and ${maxLimit}` };
    }
    limit = Number(limitRaw);
    if (limit < 1 || limit > maxLimit) {
      return { ok: false, error: `limit must be an integer between 1 and ${maxLimit}` };
    }
  }

  const beforeRaw = query("before");
  if (beforeRaw === undefined) return { ok: true, value: { limit } };

  // Date.parse accepts browser-dependent prose such as "tomorrow". The BFF
  // contract accepts only a real ISO instant, which gives clients a stable cursor
  // representation and prevents accidental locale-dependent paging.
  if (!/^\d{4}-\d{2}-\d{2}T/.test(beforeRaw)) {
    return { ok: false, error: "before must be an ISO-8601 timestamp" };
  }
  const before = new Date(beforeRaw);
  if (Number.isNaN(before.getTime())) {
    return { ok: false, error: "before must be an ISO-8601 timestamp" };
  }
  return { ok: true, value: { limit, before } };
}
