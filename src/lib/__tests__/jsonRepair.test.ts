import { describe, expect, it } from 'vitest';
import { repairTruncatedJson } from '../jsonRepair';

describe('repairTruncatedJson', () => {
    it('returns valid input unchanged with repaired=false', () => {
        const input = '{"a":1,"b":[1,2,3]}';
        const out = repairTruncatedJson(input);
        expect(out).toEqual({ text: input, repaired: false });
    });

    it('closes an unterminated string and missing braces', () => {
        // Truncated mid-value of a string property.
        const input = '{"vision":"A product that helps users';
        const out = repairTruncatedJson(input);
        expect(out.repaired).toBe(true);
        expect(() => JSON.parse(out.text)).not.toThrow();
        const parsed = JSON.parse(out.text);
        expect(parsed.vision).toBe('A product that helps users');
    });

    it('closes nested arrays/objects in LIFO order', () => {
        const input = '{"features":[{"id":"f1","name":"Sign in","desc":"Lets users';
        const out = repairTruncatedJson(input);
        expect(out.repaired).toBe(true);
        const parsed = JSON.parse(out.text);
        expect(parsed.features[0].id).toBe('f1');
        expect(parsed.features[0].desc).toBe('Lets users');
    });

    it('strips a trailing comma before closing', () => {
        const input = '{"a":1,"b":2,';
        const out = repairTruncatedJson(input);
        expect(out.repaired).toBe(true);
        expect(JSON.parse(out.text)).toEqual({ a: 1, b: 2 });
    });

    it('strips a dangling key with colon and no value', () => {
        const input = '{"a":1,"b":';
        const out = repairTruncatedJson(input);
        expect(out.repaired).toBe(true);
        expect(JSON.parse(out.text)).toEqual({ a: 1 });
    });

    it('strips a dangling key inside a nested object', () => {
        const input = '{"outer":{"a":1,"b":';
        const out = repairTruncatedJson(input);
        expect(out.repaired).toBe(true);
        expect(JSON.parse(out.text)).toEqual({ outer: { a: 1 } });
    });

    it('handles a dangling first key (no preceding comma)', () => {
        const input = '{"name":';
        const out = repairTruncatedJson(input);
        expect(out.repaired).toBe(true);
        expect(JSON.parse(out.text)).toEqual({});
    });

    it('drops a trailing escape backslash before closing the string', () => {
        // Truncation right after a backslash: closing with `"` would
        // escape the quote and produce another unterminated string.
        const input = '{"v":"foo\\';
        const out = repairTruncatedJson(input);
        expect(out.repaired).toBe(true);
        const parsed = JSON.parse(out.text);
        expect(parsed.v).toBe('foo');
    });

    it('does not get confused by colons inside strings', () => {
        const input = '{"a":"x: y","b":';
        const out = repairTruncatedJson(input);
        expect(out.repaired).toBe(true);
        expect(JSON.parse(out.text)).toEqual({ a: 'x: y' });
    });

    it('repairs a realistic truncated PRD shape', () => {
        const input =
            '{"vision":"Help teams ship faster","targetUsers":["PMs","designers"],' +
            '"features":[{"id":"f1","name":"Login","description":"Email + password","userValue":"Access account","complexity":"low","priority":"must","acceptanceCriteria":["valid email accepted","invalid email rejected"]},' +
            '{"id":"f2","name":"Onboarding","description":"Walks';
        const out = repairTruncatedJson(input);
        expect(out.repaired).toBe(true);
        const parsed = JSON.parse(out.text);
        expect(parsed.features).toHaveLength(2);
        expect(parsed.features[1].description).toBe('Walks');
    });

    it('returns repaired=false when nothing can salvage the input', () => {
        // Garbage that is not even close to JSON.
        const input = 'this is not json at all';
        const out = repairTruncatedJson(input);
        expect(out.repaired).toBe(false);
        expect(out.text).toBe(input);
    });
});
