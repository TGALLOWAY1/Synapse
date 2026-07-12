// Shared JSON body reader for Vercel Node serverless functions.
//
// Vercel delivers `req.body` already parsed for some content types, sometimes
// as a raw string, and sometimes leaves the request as a readable stream
// depending on the content-type header — handle all three. This was
// previously duplicated (with size caps) in api/projects.js and
// api/snapshots.js, and a fourth, cap-less variant lived in
// api/_lib/validate.js as `parseJsonBody`; this is the one shared
// implementation for both.
//
// - Pass `maxBytes` to enforce a body size cap while streaming; a body that
//   exceeds it throws an Error with `.code === 'payload_too_large'` (and a
//   matching `.message`) so callers can map it to their existing 413 path.
//   Omit `maxBytes` for callers that don't need a cap (mirrors the old
//   `parseJsonBody`, which never enforced one).
// - Unparseable JSON always resolves to `{}` rather than throwing — callers
//   validate the resulting shape downstream anyway, and a malformed body
//   should read the same as an empty one.
export async function readJsonBody(req, { maxBytes } = {}) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    if (req.body.length === 0) return {};
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (maxBytes && total > maxBytes) {
      const err = new Error('payload_too_large');
      err.code = 'payload_too_large';
      throw err;
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
