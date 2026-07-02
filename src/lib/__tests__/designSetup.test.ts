import { describe, expect, it } from 'vitest';
import { shouldShowDesignSetup } from '../designSetup';
import { DEMO_PROJECT_ID } from '../../data/demoProject';
import type { PreflightSession, Project, SpineVersion, StructuredPRD } from '../../types';

const baseProject = (overrides: Partial<Project> = {}): Project => ({
    id: 'p1',
    name: 'Test',
    createdAt: 1,
    needsDesignSetup: true,
    ...overrides,
});

const baseSpine = (overrides: Partial<SpineVersion> = {}): SpineVersion => ({
    id: 'v1',
    projectId: 'p1',
    promptText: 'Build a music app',
    responseText: 'Generating PRD...',
    createdAt: 1,
    isLatest: true,
    isFinal: false,
    ...overrides,
});

const activePreflight = (overrides: Partial<PreflightSession> = {}): PreflightSession => ({
    mode: 'quick',
    originalIdea: 'Build a music app',
    questions: [],
    currentQuestionIndex: 0,
    status: 'answering',
    completed: false,
    ...overrides,
});

const fakePrd = { vision: 'v' } as StructuredPRD;

describe('shouldShowDesignSetup', () => {
    it('shows for a fresh project while the PRD generates in the background', () => {
        expect(shouldShowDesignSetup(baseProject(), baseSpine())).toBe(true);
    });

    it('keeps showing after the PRD completes, until the user picks or skips', () => {
        expect(shouldShowDesignSetup(baseProject(), baseSpine({ structuredPRD: fakePrd })))
            .toBe(true);
    });

    it('waits for clarification: hidden while a preflight session is still open', () => {
        const spine = baseSpine({ preflightSession: activePreflight() });
        expect(shouldShowDesignSetup(baseProject(), spine)).toBe(false);
    });

    it('takes over once clarification answers are submitted (session completed)', () => {
        // "Generate PRD" marks the session completed and starts generation —
        // the design step must appear at that transition, before any PRD lands.
        const spine = baseSpine({
            preflightSession: activePreflight({ status: 'completed', completed: true }),
        });
        expect(shouldShowDesignSetup(baseProject(), spine)).toBe(true);
    });

    it('hides once a preset is chosen', () => {
        const project = baseProject({ designSystemPreset: 'creative_studio' });
        expect(shouldShowDesignSetup(project, baseSpine())).toBe(false);
    });

    it('hides when setup was explicitly skipped', () => {
        expect(shouldShowDesignSetup(baseProject({ needsDesignSetup: false }), baseSpine()))
            .toBe(false);
    });

    it('never shows for legacy projects without the setup flag', () => {
        expect(shouldShowDesignSetup(baseProject({ needsDesignSetup: undefined }), baseSpine()))
            .toBe(false);
    });

    it('never shows for the demo project', () => {
        const project = baseProject({ id: DEMO_PROJECT_ID });
        expect(shouldShowDesignSetup(project, baseSpine({ projectId: DEMO_PROJECT_ID })))
            .toBe(false);
    });

    it('yields to the safety review screen for blocked spines', () => {
        const spine = baseSpine({
            safetyReview: {
                status: 'blocked',
                classification: 'disallowed',
                detectedConcerns: [],
                userFacingReason: 'no',
                safeAlternatives: [],
                reviewedAt: 1,
            },
        });
        expect(shouldShowDesignSetup(baseProject(), spine)).toBe(false);
    });

    it('yields to the incomplete-PRD banner on a partial-failure run', () => {
        // Some sections failed but the pipeline returned a partial PRD — no
        // generationError is set; the failure lives in generationMeta. The PRD
        // view owns the recovery UI (per-section "Run again"), so the setup
        // step must not cover it.
        const meta = { passes: [], totalMs: 100, revised: false, schemaVersion: 2 };
        const spine = baseSpine({
            structuredPRD: fakePrd,
            generationMeta: { ...meta, failedSections: ['ux_design'] },
        });
        expect(shouldShowDesignSetup(baseProject(), spine)).toBe(false);
        // An empty failed list is a clean run — the step shows normally.
        const cleanSpine = baseSpine({
            structuredPRD: fakePrd,
            generationMeta: { ...meta, failedSections: [] },
        });
        expect(shouldShowDesignSetup(baseProject(), cleanSpine)).toBe(true);
    });

    it('yields to the error card when generation failed', () => {
        const spine = baseSpine({
            generationError: { message: 'boom', category: 'network', timestamp: 1 },
        });
        expect(shouldShowDesignSetup(baseProject(), spine)).toBe(false);
    });

    it('handles missing project or spine', () => {
        expect(shouldShowDesignSetup(undefined, baseSpine())).toBe(false);
        expect(shouldShowDesignSetup(baseProject(), undefined)).toBe(false);
    });
});
