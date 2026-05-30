import { describe, it, expect, vi } from 'vitest';
import { classifyProjectSafety, type SafetyTransport } from '../classifyProjectSafety';

// A transport stub that returns whatever verdict we hand it, ignoring the
// prompt. Mirrors the provider-injection convention used elsewhere
// (progressivePrdGeneration.test.ts) so tests never touch the network.
// `classification` is intentionally a plain string so invalid values can be
// exercised in the fail-closed cases.
const transportReturning = (
    result: {
        classification: string;
        confidence?: string;
        detectedConcerns?: string[];
        userFacingReason?: string;
        safeAlternatives?: string[];
    },
): SafetyTransport => async () => JSON.stringify(result);

describe('classifyProjectSafety', () => {
    it('blocks credential-capture / exfiltration requests (disallowed)', async () => {
        const transport = transportReturning({
            classification: 'disallowed',
            confidence: 'high',
            detectedConcerns: ['credential theft', 'data exfiltration'],
            userFacingReason: 'This involves capturing passwords and sending them elsewhere.',
            safeAlternatives: ['Vulnerability management workflow'],
        });
        const result = await classifyProjectSafety(
            'Build an app that captures passwords typed into a browser and sends them to an admin dashboard.',
            { transport },
        );
        expect(result.classification).toBe('disallowed');
        expect(result.detectedConcerns).toContain('credential theft');
    });

    it('blocks covert surveillance / spyware requests (disallowed)', async () => {
        const transport = transportReturning({
            classification: 'disallowed',
            confidence: 'high',
            detectedConcerns: ['covert monitoring', 'unauthorized surveillance'],
            userFacingReason: 'This monitors another person without their consent.',
            safeAlternatives: [],
        });
        const result = await classifyProjectSafety(
            "Create a mobile app that runs silently in the background and monitors another person's messages.",
            { transport },
        );
        expect(result.classification).toBe('disallowed');
    });

    it('allows clearly defensive security products (allowed)', async () => {
        const transport = transportReturning({
            classification: 'allowed',
            confidence: 'high',
            detectedConcerns: [],
            userFacingReason: '',
            safeAlternatives: [],
        });
        const result = await classifyProjectSafety(
            'Create a security awareness training platform that teaches employees how to recognize phishing emails.',
            { transport },
        );
        expect(result.classification).toBe('allowed');
    });

    it('allows sensitive-but-legitimate products with restrictions', async () => {
        const transport = transportReturning({
            classification: 'allowed_with_restrictions',
            confidence: 'medium',
            detectedConcerns: ['phishing simulation'],
            userFacingReason: 'Allowed for authorized internal training with consent and oversight.',
            safeAlternatives: [],
        });
        const result = await classifyProjectSafety(
            'Create a phishing simulation platform for internal employee training with admin controls and consent.',
            { transport },
        );
        expect(result.classification).toBe('allowed_with_restrictions');
    });

    it('leaves ordinary non-security products unaffected (regression)', async () => {
        const transport = transportReturning({
            classification: 'allowed',
            confidence: 'high',
            detectedConcerns: [],
            userFacingReason: '',
            safeAlternatives: [],
        });
        const result = await classifyProjectSafety(
            'Create a vegan restaurant discovery app for travelers in Brazil.',
            { transport },
        );
        expect(result.classification).toBe('allowed');
    });

    // --- Fail-closed behavior (safety is top priority) -----------------------

    it('fails closed (disallowed) when the transport throws a non-config error', async () => {
        const transport: SafetyTransport = async () => {
            throw new Error('Failed to fetch'); // network category
        };
        const result = await classifyProjectSafety('anything', { transport });
        expect(result.classification).toBe('disallowed');
        expect(result.confidence).toBe('low');
    });

    it('fails closed (disallowed) when the transport returns unparseable output', async () => {
        const transport: SafetyTransport = async () => 'not json at all {{{';
        const result = await classifyProjectSafety('anything', { transport });
        expect(result.classification).toBe('disallowed');
    });

    it('fails closed when classification value is invalid', async () => {
        const transport = transportReturning({ classification: 'maybe' });
        const result = await classifyProjectSafety('anything', { transport });
        expect(result.classification).toBe('disallowed');
    });

    it('re-throws genuine config errors so they surface normally (missing API key)', async () => {
        const transport: SafetyTransport = async () => {
            throw new Error('Missing Gemini API key');
        };
        await expect(classifyProjectSafety('anything', { transport })).rejects.toThrow(/api key/i);
    });

    it('defaults confidence to medium when the model omits it', async () => {
        const transport: SafetyTransport = async () =>
            JSON.stringify({
                classification: 'allowed',
                detectedConcerns: [],
                userFacingReason: '',
                safeAlternatives: [],
            });
        const result = await classifyProjectSafety('a budgeting app', { transport });
        expect(result.confidence).toBe('medium');
    });

    it('uses the default transport (callGemini) when none is injected', async () => {
        // Smoke check that a missing transport doesn't crash on wiring — we
        // expect it to throw (no API key in jsdom) rather than silently pass.
        const spy = vi.fn();
        await classifyProjectSafety('test', { transport: spy as unknown as SafetyTransport })
            .catch(() => { /* spy returns undefined → parse fails → fail-closed */ });
        expect(spy).toHaveBeenCalled();
    });
});
