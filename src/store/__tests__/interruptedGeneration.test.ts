import { describe, it, expect } from 'vitest';
import { markInterruptedGenerations, markInterruptedOutputRuns } from '../interruptedGeneration';
import type { Project, SpineVersion, StructuredPRD, PreflightSession } from '../../types';

const baseSpine = (overrides: Partial<SpineVersion>): SpineVersion => ({
    id: 'v1',
    projectId: 'p1',
    promptText: 'Build a thing',
    responseText: '',
    createdAt: 1,
    isLatest: true,
    isFinal: false,
    ...overrides,
});

const partialPrd = { vision: 'partial' } as unknown as StructuredPRD;

const openPreflight: PreflightSession = {
    mode: 'quick',
    originalIdea: 'Build a thing',
    questions: [],
    currentQuestionIndex: 0,
    status: 'answering',
    completed: false,
};

describe('markInterruptedGenerations', () => {
    it('converts a legacy stuck placeholder spine into an interrupted error', () => {
        const versions = {
            p1: [baseSpine({ responseText: 'Generating PRD...' })],
        };
        const changed = markInterruptedGenerations(versions);
        expect(changed).toBe(true);
        const spine = versions.p1[0];
        expect(spine.generationError?.category).toBe('interrupted');
        expect(spine.generationPhase).toBe('complete');
        // Placeholder cleared so isPRDGenerating stops being true.
        expect(spine.responseText).toBe('');
    });

    it('converts a mid-run spine (partial PRD, phase still running) into an interrupted error', () => {
        const versions = {
            p1: [baseSpine({
                responseText: '# Partial markdown',
                structuredPRD: partialPrd,
                generationPhase: 'running',
            })],
        };
        expect(markInterruptedGenerations(versions)).toBe(true);
        const spine = versions.p1[0];
        expect(spine.generationError?.category).toBe('interrupted');
        // The partial content is preserved — only the run state settles.
        expect(spine.structuredPRD).toBe(partialPrd);
        expect(spine.responseText).toBe('# Partial markdown');
    });

    it('leaves settled spines untouched', () => {
        const completed = baseSpine({
            responseText: '# Done',
            structuredPRD: partialPrd,
            generationPhase: 'complete',
        });
        const errored = baseSpine({
            id: 'v2',
            generationError: { message: 'boom', category: 'unknown', timestamp: 2 },
        });
        const legacyNoMarker = baseSpine({
            id: 'v3',
            responseText: '# Old project markdown',
            structuredPRD: partialPrd,
        });
        const versions = { p1: [completed, errored, legacyNoMarker] };
        expect(markInterruptedGenerations(versions)).toBe(false);
        expect(versions.p1[0]).toBe(completed);
        expect(versions.p1[1]).toBe(errored);
        expect(versions.p1[2]).toBe(legacyNoMarker);
    });

    it('skips spines with an open preflight session — generation never started', () => {
        const versions = {
            p1: [baseSpine({
                responseText: 'Generating PRD...',
                preflightSession: openPreflight,
            })],
        };
        expect(markInterruptedGenerations(versions)).toBe(false);
        expect(versions.p1[0].generationError).toBeUndefined();
    });

    it('skips safety-blocked spines', () => {
        const versions = {
            p1: [baseSpine({
                generationPhase: 'running',
                safetyReview: {
                    status: 'blocked',
                    classification: 'disallowed',
                    detectedConcerns: [],
                    userFacingReason: 'nope',
                    safeAlternatives: [],
                    reviewedAt: 3,
                },
            })],
        };
        expect(markInterruptedGenerations(versions)).toBe(false);
        expect(versions.p1[0].generationError).toBeUndefined();
    });
});

describe('markInterruptedOutputRuns', () => {
    const project = (overrides: Partial<Project>): Project => ({ id: 'p1', name: 'P', createdAt: 1, ...overrides });

    it('turns a leftover running output-run marker into interrupted (a page load killed the run)', () => {
        const projects = {
            p1: project({ outputRun: { spineVersionId: 's1', runId: 'r1', startedAt: 5, phase: 'running' } }),
        };
        expect(markInterruptedOutputRuns(projects)).toBe(true);
        expect(projects.p1.outputRun).toEqual({ spineVersionId: 's1', runId: 'r1', startedAt: 5, phase: 'interrupted' });
    });

    // The output-run lease: a second tab loading while the first tab is still
    // generating must not flip that live run to interrupted.
    const NOW = 10_000_000;
    const liveMarker = (ownerTabId: string, heartbeatAt: number) =>
        ({ spineVersionId: 's1', runId: 'r1', startedAt: NOW - 120_000, phase: 'running' as const, ownerTabId, heartbeatAt });

    it('keeps another tab\'s live run running when its heartbeat is fresh', () => {
        const projects = { p1: project({ outputRun: liveMarker('first-tab', NOW - 5_000) }) };
        expect(markInterruptedOutputRuns(projects, { now: NOW, tabId: 'second-tab' })).toBe(false);
        expect(projects.p1.outputRun?.phase).toBe('running');
    });

    it('interrupts another tab\'s run once its heartbeat is stale (the owner died)', () => {
        const projects = { p1: project({ outputRun: liveMarker('first-tab', NOW - 46_000) }) };
        expect(markInterruptedOutputRuns(projects, { now: NOW, tabId: 'second-tab' })).toBe(true);
        expect(projects.p1.outputRun?.phase).toBe('interrupted');
    });

    it('interrupts this same tab\'s run on its own reload, even with a fresh heartbeat', () => {
        const projects = { p1: project({ outputRun: liveMarker('this-tab', NOW - 1_000) }) };
        expect(markInterruptedOutputRuns(projects, { now: NOW, tabId: 'this-tab' })).toBe(true);
        expect(projects.p1.outputRun?.phase).toBe('interrupted');
    });

    it('leaves projects without a running marker untouched', () => {
        const interrupted = project({ outputRun: { spineVersionId: 's1', runId: 'r1', startedAt: 5, phase: 'interrupted' } });
        const legacy = project({ id: 'p2' });
        const projects = { p1: interrupted, p2: legacy };
        expect(markInterruptedOutputRuns(projects)).toBe(false);
        expect(projects.p1).toBe(interrupted);
        expect(projects.p2).toBe(legacy);
    });
});
