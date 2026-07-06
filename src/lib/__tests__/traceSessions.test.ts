import { describe, it, expect } from 'vitest';
import { groupIntoSessions, filterTraces, diffCalls } from '../trace/traceSessions';
import type { LlmTraceCall } from '../trace/traceTypes';

const makeCall = (over: Partial<LlmTraceCall> & { id: string; createdAt: number }): LlmTraceCall => ({
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    mode: 'json',
    status: 'success',
    startedAt: over.createdAt,
    endedAt: over.createdAt + 1000,
    durationMs: 1000,
    systemInstruction: '',
    promptText: 'prompt',
    messages: [],
    requestBody: '{}',
    requestUrl: 'https://example',
    rawResponse: 'resp',
    retryCount: 0,
    meta: {},
    ...over,
});

describe('groupIntoSessions', () => {
    it('groups by explicit sessionId regardless of time gap', () => {
        const calls = [
            makeCall({ id: 'a', createdAt: 1_000, meta: { sessionId: 's1', stage: 'PRD' } }),
            makeCall({ id: 'b', createdAt: 9_000_000, meta: { sessionId: 's1', stage: 'PRD' } }),
            makeCall({ id: 'c', createdAt: 2_000, meta: { sessionId: 's2', stage: 'Artifact' } }),
        ];
        const sessions = groupIntoSessions(calls);
        const s1 = sessions.find((s) => s.calls.some((c) => c.id === 'a'));
        expect(s1?.calls.map((c) => c.id).sort()).toEqual(['a', 'b']);
        expect(sessions).toHaveLength(2);
    });

    it('splits heuristic sessions on a long idle gap', () => {
        const calls = [
            makeCall({ id: 'a', createdAt: 0, meta: { stage: 'PRD', projectId: 'p1' } }),
            makeCall({ id: 'b', createdAt: 5_000, meta: { stage: 'PRD', projectId: 'p1' } }),
            makeCall({ id: 'c', createdAt: 5_000_000, meta: { stage: 'PRD', projectId: 'p1' } }),
        ];
        const sessions = groupIntoSessions(calls);
        expect(sessions).toHaveLength(2);
    });

    it('returns sessions newest-first', () => {
        const calls = [
            makeCall({ id: 'old', createdAt: 1_000, meta: { sessionId: 'a' } }),
            makeCall({ id: 'new', createdAt: 9_000_000, meta: { sessionId: 'b' } }),
        ];
        const sessions = groupIntoSessions(calls);
        expect(sessions[0].calls[0].id).toBe('new');
    });
});

describe('filterTraces', () => {
    const calls = [
        makeCall({ id: 'ok', createdAt: 1, model: 'gemini-3.5-flash', meta: { stage: 'PRD', purpose: 'Generate Features' } }),
        makeCall({ id: 'err', createdAt: 2, status: 'error', error: 'boom', meta: { stage: 'Artifact' } }),
        makeCall({ id: 'retry', createdAt: 3, retryCount: 2, meta: { stage: 'PRD' } }),
    ];

    it('filters by stage', () => {
        expect(filterTraces(calls, { stage: 'Artifact' }).map((c) => c.id)).toEqual(['err']);
    });
    it('filters errors only', () => {
        expect(filterTraces(calls, { onlyErrors: true }).map((c) => c.id)).toEqual(['err']);
    });
    it('filters retries only', () => {
        expect(filterTraces(calls, { onlyRetries: true }).map((c) => c.id)).toEqual(['retry']);
    });
    it('full-text searches purpose', () => {
        expect(filterTraces(calls, { text: 'features' }).map((c) => c.id)).toEqual(['ok']);
    });
});

describe('diffCalls', () => {
    it('marks changed and unchanged fields', () => {
        const a = makeCall({ id: 'a', createdAt: 1, model: 'gemini-3.5-flash', promptText: 'X' });
        const b = makeCall({ id: 'b', createdAt: 2, model: 'gemini-3.5-flash', promptText: 'Y' });
        const rows = diffCalls(a, b);
        expect(rows.find((r) => r.field === 'Model')?.changed).toBe(false);
        expect(rows.find((r) => r.field === 'Prompt')?.changed).toBe(true);
    });
});
