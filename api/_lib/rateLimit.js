// Lightweight in-memory sliding-window rate limiter.
//
// IMPORTANT: Vercel serverless functions are stateless across warm
// instances, so this limiter is *best effort only* — counters live in
// the process memory of whichever instance services the request. It
// materially slows casual abuse and single-host brute-force attempts
// but will not defend against a distributed attacker.
//
// For production-grade rate limiting, wire this module up to a shared
// store (Upstash Ratelimit, Redis, Vercel KV). The public API here is
// intentionally compatible with that kind of drop-in replacement.

const BUCKETS = new Map();

// Cap the bucket map so a flood of unique keys can't exhaust memory.
// When we hit the cap, drop the oldest entries.
const MAX_KEYS = 10_000;

function prune(now) {
  if (BUCKETS.size < MAX_KEYS) return;
  // Evict any fully-expired entries first.
  for (const [key, value] of BUCKETS) {
    if (now - value.windowStart > value.windowMs * 2) BUCKETS.delete(key);
    if (BUCKETS.size < MAX_KEYS * 0.9) return;
  }
  // Still too full — drop oldest insertions.
  const overflow = BUCKETS.size - Math.floor(MAX_KEYS * 0.9);
  const iter = BUCKETS.keys();
  for (let i = 0; i < overflow; i += 1) {
    const next = iter.next();
    if (next.done) break;
    BUCKETS.delete(next.value);
  }
}

/**
 * Extract a stable client identifier. Prefers the leftmost entry in
 * x-forwarded-for (the client-facing value on Vercel), falling back to
 * the raw socket address. Coerces to string; strips port if present.
 */
export function getClientKey(req) {
  const xff = req.headers?.['x-forwarded-for'];
  let ip = null;
  if (typeof xff === 'string' && xff.length > 0) {
    ip = xff.split(',')[0].trim();
  } else if (Array.isArray(xff) && xff.length > 0) {
    ip = String(xff[0]).trim();
  } else {
    ip = req.socket?.remoteAddress || 'unknown';
  }
  // Strip IPv6 zone / port
  if (typeof ip === 'string' && ip.includes(']:')) {
    ip = ip.split(']:')[0].replace('[', '');
  } else if (typeof ip === 'string' && ip.match(/^\d+\.\d+\.\d+\.\d+:\d+$/)) {
    ip = ip.split(':')[0];
  }
  return ip || 'unknown';
}

/**
 * Allow or deny a request under a fixed-window counter.
 *   key: stable per-client string (scope-prefix your usage).
 *   limit: maximum requests per window.
 *   windowMs: window size in milliseconds.
 * Returns `{ allowed, remaining, resetMs }`.
 */
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  prune(now);

  const existing = BUCKETS.get(key);
  if (!existing || now - existing.windowStart >= windowMs) {
    BUCKETS.set(key, { count: 1, windowStart: now, windowMs });
    return { allowed: true, remaining: limit - 1, resetMs: windowMs };
  }

  existing.count += 1;
  const resetMs = windowMs - (now - existing.windowStart);
  if (existing.count > limit) {
    return { allowed: false, remaining: 0, resetMs };
  }
  return { allowed: true, remaining: Math.max(0, limit - existing.count), resetMs };
}

/**
 * Convenience: enforce a rate limit on a Vercel-style (req, res) handler.
 * Responds with 429 JSON and `Retry-After` if the caller exceeds it, and
 * returns `true` in that case so the handler can bail out early.
 */
export function enforceRateLimit(req, res, options) {
  const {
    scope,
    limit,
    windowMs,
    keyFn,
    errorBody = { error: 'rate_limited' },
  } = options;
  const clientKey = keyFn ? keyFn(req) : getClientKey(req);
  const bucketKey = `${scope}:${clientKey}`;
  const result = rateLimit(bucketKey, limit, windowMs);
  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil(result.resetMs / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', '0');
    res.status(429).setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(errorBody));
    return true;
  }
  return false;
}

// Test-only helper. Not exported through index; internal usage.
export function __resetRateLimitForTests() {
  BUCKETS.clear();
}
