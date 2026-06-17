import { json, methodNotAllowed } from './_lib/response.js';
import { parseJsonBody } from './_lib/validate.js';
import { requireUser } from './_lib/requireUser.js';
import { isVaultConfigured } from './_lib/cryptoVault.js';
import {
  isSupportedProvider,
  validateProviderKey,
  setProviderKey,
  deleteProviderKey,
  getProviderKeyStatus,
  getDecryptedProviderKey,
} from './_lib/providerKeys.js';

// Manage a user's encrypted provider API keys. Every route is session-gated via
// requireUser and operates only on the authenticated user's own keys — the
// client can never name another user's row.
//
//   GET    /api/provider-keys           -> masked status for all providers
//   PUT    /api/provider-keys           -> { provider, key } set/update a key
//   DELETE /api/provider-keys?provider= -> remove a key
//   POST   /api/provider-keys?action=test { provider } -> live connection test
//
// Responses NEVER include key material. The masked `last4` preview is the only
// key-derived value that leaves the server.

const VAULT_NOT_CONFIGURED = {
  error: 'vault_not_configured',
  message:
    'Encrypted key storage is not configured on this deployment. Set SYNAPSE_KEY_ENCRYPTION_SECRET in the environment.',
};

async function testGemini(key) {
  const resp = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models',
    { headers: { 'x-goog-api-key': key } },
  );
  return resp.ok;
}

async function testOpenAI(key) {
  const resp = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  return resp.ok;
}

export default async function handler(req, res) {
  if (!['GET', 'PUT', 'DELETE', 'POST'].includes(req.method)) {
    return methodNotAllowed(res, ['GET', 'PUT', 'DELETE', 'POST']);
  }

  const user = await requireUser(req, res);
  if (!user) return; // 401 already sent

  if (!isVaultConfigured()) {
    return json(res, 503, VAULT_NOT_CONFIGURED);
  }

  try {
    if (req.method === 'GET') {
      // Runtime key material for the Gemini client. This is the one, narrowly
      // scoped place a key is returned to the browser — a deliberate tradeoff
      // documented in docs/AUTH_AND_PROVIDER_KEYS.md: the 60–90s Gemini
      // streaming pipeline can't be proxied through serverless without hitting
      // duration limits, so the authenticated user fetches their own key into
      // memory at call time (never persisted client-side). Only `gemini` is
      // exposed this way; the OpenAI key is fully proxied and never returned.
      if (req.query?.material === 'gemini') {
        let key = null;
        try {
          key = await getDecryptedProviderKey(user.userId, 'gemini');
        } catch {
          key = null;
        }
        // 200 with key:null when none is stored, so the client can fall back
        // cleanly to a local key without treating it as an error.
        return json(res, 200, { provider: 'gemini', key: key || null });
      }
      const status = await getProviderKeyStatus(user.userId);
      return json(res, 200, { status, vaultConfigured: true });
    }

    if (req.method === 'PUT') {
      const body = await parseJsonBody(req);
      const provider = body?.provider;
      if (!isSupportedProvider(provider)) {
        return json(res, 400, { error: 'unsupported_provider' });
      }
      const check = validateProviderKey(body?.key);
      if (!check.ok) {
        return json(res, 400, { error: 'invalid_key', message: check.error });
      }
      const result = await setProviderKey(user.userId, provider, check.value);
      // result carries only masked metadata — never the key.
      return json(res, 200, { provider, ...result });
    }

    if (req.method === 'DELETE') {
      const provider = req.query?.provider;
      if (!isSupportedProvider(provider)) {
        return json(res, 400, { error: 'unsupported_provider' });
      }
      const deleted = await deleteProviderKey(user.userId, provider);
      return json(res, 200, { provider, deleted });
    }

    // POST -> connection test
    if (req.query?.action !== 'test') {
      return json(res, 400, { error: 'unknown_action' });
    }
    const body = await parseJsonBody(req);
    const provider = body?.provider;
    if (!isSupportedProvider(provider)) {
      return json(res, 400, { error: 'unsupported_provider' });
    }
    let key;
    try {
      key = await getDecryptedProviderKey(user.userId, provider);
    } catch {
      // Decrypt failure (e.g. rotated secret) — treat as "no usable key".
      key = null;
    }
    if (!key) {
      return json(res, 200, { ok: false, message: 'No key saved for this provider yet.' });
    }
    let ok = false;
    try {
      ok = provider === 'gemini' ? await testGemini(key) : await testOpenAI(key);
    } catch {
      ok = false;
    }
    return json(res, 200, {
      ok,
      message: ok
        ? 'Connection succeeded.'
        : 'The provider rejected this key. Check that it is valid and active.',
    });
  } catch (error) {
    // Never include the error detail verbatim — it could echo request data.
    console.error('[provider-keys]', error?.name || 'error');
    return json(res, 500, { error: 'provider_keys_failed' });
  }
}
