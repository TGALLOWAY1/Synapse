import { json, methodNotAllowed } from '../_lib/response.js';
import { parseJsonBody } from '../_lib/validate.js';
import { requireUser } from '../_lib/requireUser.js';
import { isVaultConfigured } from '../_lib/cryptoVault.js';
import { getDecryptedProviderKey } from '../_lib/providerKeys.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';

// Server-side proxy for OpenAI image generation (gpt-image-2).
//
// The user's OpenAI key is decrypted ONLY here, server-side, used for the
// outbound call, and never returned to the browser. This is the fully-secure
// path: the key material never reaches the client. The image is a synchronous
// call, so it fits comfortably inside the serverless duration budget below.

// gpt-image-2 high quality can take ~60s; give the function room. (Vercel Hobby
// allows up to 60s.) The client wraps this with its own retry/timeout logic.
export const config = { maxDuration: 60 };

const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';
const OPENAI_IMAGE_MODEL = 'gpt-image-2';
const ALLOWED_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024', 'auto']);
const ALLOWED_QUALITY = new Set(['low', 'medium', 'high']);
const MAX_PROMPT_LEN = 32_000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const user = await requireUser(req, res);
  if (!user) return; // 401 already sent

  // Per-user throttle so a compromised session can't burn the user's OpenAI
  // balance with a flood of paid image requests.
  if (
    enforceRateLimit(req, res, {
      scope: 'image_generate',
      limit: 30,
      windowMs: 60_000,
      keyFn: () => `image|${user.userId}`,
      errorBody: { error: 'rate_limited', message: 'Too many image requests — slow down a moment.' },
    })
  ) {
    return;
  }

  if (!isVaultConfigured()) {
    return json(res, 503, {
      error: 'vault_not_configured',
      message: 'Encrypted key storage is not configured on this deployment.',
    });
  }

  const body = await parseJsonBody(req);
  const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
  const size = ALLOWED_SIZES.has(body?.size) ? body.size : '1024x1024';
  const quality = ALLOWED_QUALITY.has(body?.quality) ? body.quality : 'low';
  if (prompt.trim().length === 0 || prompt.length > MAX_PROMPT_LEN) {
    return json(res, 400, { error: 'invalid_prompt' });
  }

  let key;
  try {
    key = await getDecryptedProviderKey(user.userId, 'openai');
  } catch {
    key = null;
  }
  if (!key) {
    // Clear, user-friendly missing-key error.
    return json(res, 400, {
      error: 'no_openai_key',
      message: 'Add an OpenAI API key in Settings to generate mockups.',
    });
  }

  let upstream;
  try {
    upstream = await fetch(OPENAI_IMAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model: OPENAI_IMAGE_MODEL, prompt, size, quality, n: 1 }),
    });
  } catch {
    return json(res, 502, { error: 'upstream_unreachable', message: 'Could not reach OpenAI. Try again.' });
  }

  if (!upstream.ok) {
    // Forward a sanitized error: status + provider message, never the key.
    const data = await upstream.json().catch(() => null);
    const message = data?.error?.message;
    const code = data?.error?.code || data?.error?.type;
    // Log only the status/code — never the request body or key.
    console.error('[image/generate] OpenAI error', upstream.status, code || '');
    return json(res, upstream.status === 401 ? 400 : upstream.status, {
      error: 'openai_error',
      // Pass through the provider message so the client can show specific
      // guidance (quota / moderation / bad key), but keep it bounded.
      message: typeof message === 'string' ? message.slice(0, 300) : `OpenAI error (${upstream.status}).`,
      code: typeof code === 'string' ? code : undefined,
    });
  }

  const data = await upstream.json().catch(() => null);
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    return json(res, 502, { error: 'no_image', message: 'OpenAI returned no image. Please try again.' });
  }
  return json(res, 200, { b64 });
}
