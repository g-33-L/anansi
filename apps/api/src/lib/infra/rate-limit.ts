import { redis } from "./queue.js";

const DEFAULT_WINDOW_MS = 60_000; // 1-minute sliding window

// Sliding-window rate limiter using a Redis sorted set.
// Each request adds a member scored by its timestamp (ms). Old members outside
// the window are trimmed atomically before counting.
//
// Lua script (atomic — Redis is single-threaded):
//   KEYS[1] = sorted-set key (e.g. "rl:ingest:dev123")
//   ARGV[1] = current timestamp in ms (string)
//   ARGV[2] = window size in ms (string)
//   ARGV[3] = cost (units to add; 1 for single requests, N for batch)
//   ARGV[4] = max requests allowed in window
//
// Returns 1 if the request is allowed (within limit), 0 if denied.
const SLIDING_WINDOW_LUA = `
local now      = tonumber(ARGV[1])
local window   = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])
local limit    = tonumber(ARGV[4])
local cutoff   = now - window

-- Remove entries that have fallen outside the sliding window
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)

-- Count current entries
local current = redis.call('ZCARD', KEYS[1])

if current + cost > limit then
  return 0
end

-- Add cost entries, each scored by current time + a tiny jitter to keep members unique
for i = 1, cost do
  redis.call('ZADD', KEYS[1], now + i - 1, now .. ':' .. i .. ':' .. math.random(1000000))
end

-- Keep the key alive for one full window beyond the last entry
redis.call('PEXPIRE', KEYS[1], window)
return 1
`;

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs = DEFAULT_WINDOW_MS,
  cost = 1,
): Promise<boolean> {
  const setKey = `rl2:${key}`;
  const now = Date.now();
  try {
    // ioredis eval: (script, numkeys, ...keys, ...args)
    const allowed = await redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      setKey,
      String(now),
      String(windowMs),
      String(cost),
      String(maxRequests),
    ) as number;
    return allowed === 1;
  } catch (err) {
    // Redis unavailable: fail OPEN (allow) instead of 500-ing the whole /v1 surface.
    // Per-minute rate limiting is a burst guard, not the primary abuse control —
    // monthly quotas are enforced in Postgres (checkAndIncrementApiCall) and still
    // apply. A brief Redis blip shouldn't take the entire API down.
    console.warn(`[rate-limit] Redis error for "${key}", allowing request:`, (err as Error).message);
    return true;
  }
}
