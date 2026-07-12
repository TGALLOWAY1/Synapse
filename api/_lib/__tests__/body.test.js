import { describe, expect, it } from 'vitest';
import { readJsonBody } from '../body.js';

// A minimal async-iterable stand-in for a Node IncomingMessage when
// `req.body` hasn't been pre-parsed (mirrors how Vercel delivers a body under
// some content-types).
function streamReq(chunks) {
  return {
    body: undefined,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

describe('readJsonBody', () => {
  it('returns an already-parsed object body as-is', async () => {
    const req = { body: { a: 1 } };
    await expect(readJsonBody(req)).resolves.toEqual({ a: 1 });
  });

  it('parses a raw string body', async () => {
    const req = { body: '{"a":1}' };
    await expect(readJsonBody(req)).resolves.toEqual({ a: 1 });
  });

  it('resolves {} for an empty string body', async () => {
    const req = { body: '' };
    await expect(readJsonBody(req)).resolves.toEqual({});
  });

  it('resolves {} for an unparseable string body (never throws)', async () => {
    const req = { body: 'not json' };
    await expect(readJsonBody(req)).resolves.toEqual({});
  });

  it('parses a streamed body', async () => {
    const req = streamReq([Buffer.from('{"a":'), Buffer.from('2}')]);
    await expect(readJsonBody(req)).resolves.toEqual({ a: 2 });
  });

  it('resolves {} for an unparseable streamed body (never throws)', async () => {
    const req = streamReq([Buffer.from('not json')]);
    await expect(readJsonBody(req)).resolves.toEqual({});
  });

  it('resolves {} for an empty stream', async () => {
    const req = streamReq([]);
    await expect(readJsonBody(req)).resolves.toEqual({});
  });

  it('throws a payload_too_large-coded error once maxBytes is exceeded', async () => {
    const req = streamReq([Buffer.from('a'.repeat(10)), Buffer.from('b'.repeat(10))]);
    await expect(readJsonBody(req, { maxBytes: 15 })).rejects.toMatchObject({
      code: 'payload_too_large',
      message: 'payload_too_large',
    });
  });

  it('does not enforce a cap when maxBytes is omitted', async () => {
    const req = streamReq([Buffer.from(JSON.stringify({ big: 'x'.repeat(1000) }))]);
    const result = await readJsonBody(req);
    expect(result.big).toHaveLength(1000);
  });
});
