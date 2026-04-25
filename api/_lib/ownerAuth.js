import crypto from 'crypto';
import { json } from './response.js';

const MIN_TOKEN_LEN = 24;

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// Extracts the bearer token from `Authorization: Bearer <token>`. Falls back
// to the `x-owner-token` header so a stray Authorization stripper (some
// proxies) doesn't lock the owner out.
function extractToken(req) {
  const auth = req.headers?.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const hdr = req.headers?.['x-owner-token'];
  if (typeof hdr === 'string') return hdr.trim();
  return '';
}

/**
 * Gate the request behind SYNAPSE_OWNER_TOKEN. Returns true if the request
 * was rejected (the handler should bail). The token is single-tenant: the
 * Synapse owner sets it once in their Vercel project env, and only requests
 * carrying that token can read/write snapshots.
 */
export function requireOwner(req, res) {
  const expected = process.env.SYNAPSE_OWNER_TOKEN;
  if (!expected || expected.length < MIN_TOKEN_LEN) {
    console.warn('[snapshots] SYNAPSE_OWNER_TOKEN unset or shorter than 24 chars; rejecting.');
    json(res, 401, { error: 'unauthorized' });
    return true;
  }
  const provided = extractToken(req);
  if (!provided || !constantTimeEqual(provided, expected)) {
    json(res, 401, { error: 'unauthorized' });
    return true;
  }
  return false;
}
