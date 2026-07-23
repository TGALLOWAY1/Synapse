import { describe, it, expect } from 'vitest';
import { buildTraceHtmlReport } from '../trace/traceExport';
import type { LlmTraceCall } from '../trace/traceTypes';

const call: LlmTraceCall = {
    id: 'a',
    createdAt: 1000,
    provider: 'gemini',
    model: 'gemini-3.6-flash',
    mode: 'json',
    status: 'success',
    startedAt: 1000,
    endedAt: 2000,
    durationMs: 1000,
    systemInstruction: 'You are a PRD writer.',
    promptText: 'Generate the Features section.',
    messages: [],
    requestBody: '{"model":"gemini-3.6-flash"}',
    requestUrl: 'https://generativelanguage.googleapis.com',
    rawResponse: '{"features":[]}',
    parsedJson: { features: [] },
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    retryCount: 0,
    finishReason: 'STOP',
    meta: { stage: 'PRD', purpose: 'Generate Features', artifact: 'features', inputs: ['Product idea'] },
};

describe('buildTraceHtmlReport', () => {
    it('produces a self-contained HTML document embedding call details', () => {
        const html = buildTraceHtmlReport([call]);
        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html).toContain('Generate Features');
        expect(html).toContain('gemini-3.6-flash');
        expect(html).toContain('You are a PRD writer.');
        expect(html).toContain('Generate the Features section.');
        // No external resource references (works offline).
        expect(html).not.toMatch(/<script\s+src=/i);
        expect(html).not.toMatch(/<link[^>]+href="http/i);
    });

    it('escapes angle brackets from model content', () => {
        const evil = { ...call, rawResponse: '<img src=x onerror=alert(1)>' };
        const html = buildTraceHtmlReport([evil]);
        expect(html).not.toContain('<img src=x onerror=alert(1)>');
        expect(html).toContain('&lt;img');
    });

    it('renders an empty report without throwing', () => {
        expect(buildTraceHtmlReport([])).toContain('No traces');
    });
});
