// Pure secret-redaction for the LLM Trace Viewer.
//
// Traces capture the exact request payload and headers-adjacent material. We
// MUST never store or display provider API keys, bearer tokens, session
// cookies, encryption secrets, or passwords — even though the viewer is
// owner-only. Redaction is applied at capture time (defense in depth) so a
// secret never lands in the in-memory registry or IndexedDB in the first place.
//
// This module is pure (no DOM / store / network) and unit-tested.

const MASK = '«redacted»';

// Key names whose VALUES are always secret, matched case-insensitively against
// JSON object keys and `key: value` / `key=value` textual forms.
const SECRET_KEY_PATTERNS: RegExp[] = [
    /api[_-]?key/i,
    /x-goog-api-key/i,
    /authorization/i,
    /bearer/i,
    /access[_-]?token/i,
    /refresh[_-]?token/i,
    /id[_-]?token/i,
    /session[_-]?(id|cookie|token|secret)/i,
    /\bcookie\b/i,
    /client[_-]?secret/i,
    /encryption[_-]?secret/i,
    /owner[_-]?token/i,
    /\bpassword\b/i,
    /\bsecret\b/i,
    /private[_-]?key/i,
];

// Value shapes that look like credentials regardless of their key, redacted
// wherever they appear in free text.
const SECRET_VALUE_PATTERNS: { re: RegExp; replace: string }[] = [
    // Google AI Studio / Gemini keys.
    { re: /AIza[0-9A-Za-z_-]{16,}/g, replace: MASK },
    // OpenAI keys (sk-..., sk-proj-...).
    { re: /sk-(?:proj-)?[A-Za-z0-9_-]{16,}/g, replace: MASK },
    // GitHub tokens.
    { re: /gh[posur]_[A-Za-z0-9]{16,}/g, replace: MASK },
    // Generic Bearer header values.
    { re: /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/g, replace: `Bearer ${MASK}` },
];

const isSecretKey = (key: string): boolean =>
    SECRET_KEY_PATTERNS.some((re) => re.test(key));

/** Redact credential-shaped substrings from any free text. */
export const redactText = (text: string): string => {
    if (!text) return text;
    let out = text;
    for (const { re, replace } of SECRET_VALUE_PATTERNS) {
        out = out.replace(re, replace);
    }
    return out;
};

/**
 * Deep-redact an arbitrary JSON-ish value: mask the values of secret-named keys
 * and scrub credential-shaped strings everywhere else. Non-mutating.
 */
export const redactValue = (value: unknown): unknown => {
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) return value.map(redactValue);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = isSecretKey(k) ? MASK : redactValue(v);
        }
        return out;
    }
    return value;
};

/** Redact and pretty-print a request/response body object to a JSON string. */
export const redactJsonString = (value: unknown): string => {
    try {
        return JSON.stringify(redactValue(value), null, 2);
    } catch {
        return redactText(String(value));
    }
};

export const REDACTION_MASK = MASK;
