import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { generateCoreArtifact } from '../coreArtifactService';
import { buildCanonicalPrdSpine } from '../../canonicalPrdSpine';
import { callGeminiStream } from '../../geminiClient';
import type { StructuredPRD } from '../../../types';

// Keep the real module (model resolution, retry helpers) but stub the two
// transport functions so we can capture the assembled user prompt.
vi.mock('../../geminiClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../geminiClient')>();
    return {
        ...actual,
        callGemini: vi.fn(),
        callGeminiStream: vi.fn(),
    };
});

const streamMock = callGeminiStream as unknown as Mock;

const PRD: StructuredPRD = {
    productName: 'MoodTune',
    vision: 'Match music to mood in seconds.',
    coreProblem: 'Picking music for a mood is slow.',
    targetUsers: ['Commuters'],
    architecture: 'Local-first SPA.',
    features: [
        { id: 'f1', name: 'Mood Capture', description: 'Capture a mood fast.', userValue: 'Speed', complexity: 'medium', priority: 'must' },
        { id: 'f2', name: 'Resonance Playlist', description: 'Playlist from mood.', userValue: 'Fit', complexity: 'high' },
    ],
    risks: ['Quality'],
};

const PRD_MARKDOWN = '# MoodTune PRD\n\nFull rendered PRD markdown body.';

// user_flows has no JSON schema → plain markdown stream path (simplest to
// assert against). The mock returns a heading so normalizeArtifactMarkdown keeps it.
const lastUserPrompt = (): string => streamMock.mock.calls[0][1] as string;

beforeEach(() => {
    streamMock.mockReset();
    streamMock.mockResolvedValue('### Flow: Onboarding\nStep one.');
});

describe('generateCoreArtifact — canonical spine prompt', () => {
    it('leads with the authoritative Canonical PRD Spine and demotes full PRD to a fallback', async () => {
        const spine = buildCanonicalPrdSpine(PRD, { now: () => 1 });
        await generateCoreArtifact('user_flows', PRD_MARKDOWN, PRD, { canonicalSpine: spine, allowMissingDependencies: true });

        const prompt = lastUserPrompt();
        expect(prompt).toMatch(/Canonical PRD Spine \(AUTHORITATIVE/);
        expect(prompt).toMatch(/"id": "f1"/);
        // Full PRD present but demoted to the clearly-labeled secondary appendix.
        expect(prompt).toContain('## APPENDIX — FULL PRD MARKDOWN (SECONDARY REFERENCE ONLY)');
        expect(prompt).toContain('Full rendered PRD markdown body.');
        // The authoritative spine section must appear before the PRD appendix.
        expect(prompt.indexOf('CANONICAL PRD SPINE')).toBeLessThan(prompt.indexOf('APPENDIX — FULL PRD MARKDOWN'));
        // The redundant standalone glossary/summary headers are gone (spine path).
        expect(prompt).not.toContain('Canonical Feature Glossary:');
        expect(prompt).not.toContain('Vision: Match music to mood');
    });

    it('records spineContextUsed + spineSchemaVersion in the returned metadata', async () => {
        const spine = buildCanonicalPrdSpine(PRD, { now: () => 1 });
        const result = await generateCoreArtifact('user_flows', PRD_MARKDOWN, PRD, { canonicalSpine: spine, allowMissingDependencies: true });
        expect(result.metadata?.spineContextUsed).toBe(true);
        expect(result.metadata?.spineSchemaVersion).toBe(spine.meta.schemaVersion);
    });

    it('rebuilds a spine when the caller passes none (old projects without a saved spine)', async () => {
        const result = await generateCoreArtifact('user_flows', PRD_MARKDOWN, PRD, { allowMissingDependencies: true });
        expect(result.metadata?.spineContextUsed).toBe(true);
        expect(lastUserPrompt()).toMatch(/Canonical PRD Spine \(AUTHORITATIVE/);
    });

    it('falls back to the legacy summary prompt when the PRD has no features', async () => {
        const prdNoFeatures: StructuredPRD = { ...PRD, features: [] };
        const result = await generateCoreArtifact('user_flows', PRD_MARKDOWN, prdNoFeatures, { allowMissingDependencies: true });
        const prompt = lastUserPrompt();
        expect(result.metadata?.spineContextUsed).toBe(false);
        expect(prompt).toContain('Canonical Feature Glossary:');
        expect(prompt).toContain('Vision: Match music to mood');
        expect(prompt).not.toMatch(/Canonical PRD Spine \(AUTHORITATIVE/);
        // Legacy path still includes the full PRD.
        expect(prompt).toContain('Full rendered PRD markdown body.');
    });
});
