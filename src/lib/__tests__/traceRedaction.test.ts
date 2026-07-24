import { describe, it, expect } from 'vitest';
import { redactText, redactValue, redactJsonString, REDACTION_MASK } from '../trace/traceRedaction';

describe('traceRedaction', () => {
    it('redacts Gemini / OpenAI / GitHub key shapes in free text', () => {
        const text = 'key=AIzaSyA1234567890abcdefghijklmnop and sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const out = redactText(text);
        expect(out).not.toContain('AIzaSyA1234567890abcdefghijklmnop');
        expect(out).not.toContain('sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX');
        expect(out).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
        expect(out).toContain(REDACTION_MASK);
    });

    it('masks values of secret-named keys but keeps other data', () => {
        const redacted = redactValue({
            'x-goog-api-key': 'AIzaSyABCDEFGHIJKLMNOPQRST',
            authorization: 'Bearer sometoken12345',
            model: 'gemini-3.6-flash',
            prompt: 'hello world',
            nested: { password: 'hunter2', keep: 'visible' },
        }) as Record<string, unknown>;
        expect(redacted['x-goog-api-key']).toBe(REDACTION_MASK);
        expect(redacted.authorization).toBe(REDACTION_MASK);
        expect(redacted.model).toBe('gemini-3.6-flash');
        expect(redacted.prompt).toBe('hello world');
        const nested = redacted.nested as Record<string, unknown>;
        expect(nested.password).toBe(REDACTION_MASK);
        expect(nested.keep).toBe('visible');
    });

    it('redactJsonString produces valid JSON with no leaked secret', () => {
        const s = redactJsonString({ apiKey: 'AIzaSyLEAKED0000000000000', body: { text: 'ok' } });
        expect(s).not.toContain('AIzaSyLEAKED0000000000000');
        const parsed = JSON.parse(s) as { apiKey: string; body: { text: string } };
        expect(parsed.apiKey).toBe(REDACTION_MASK);
        expect(parsed.body.text).toBe('ok');
    });

    it('leaves ordinary text untouched', () => {
        expect(redactText('Generate the Permissions & Roles section.')).toBe('Generate the Permissions & Roles section.');
    });
});
