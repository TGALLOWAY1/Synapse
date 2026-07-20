import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReviewContextManifest } from '../useReviewContextManifest';
import type { Project, SpineVersion, StructuredPRD } from '../../../types';

const structuredPRD: StructuredPRD = {
    vision: 'Match music to mood.',
    targetUsers: ['Commuters'],
    coreProblem: 'Slow music picking.',
    features: [
        { id: 'f1', name: 'Mood Capture', description: 'Capture a mood.', userValue: 'Speed', complexity: 'medium' },
    ],
    architecture: 'Local-first SPA.',
    risks: ['Quality'],
};

const project: Project = {
    id: 'p1',
    name: 'MoodTune',
    createdAt: 0,
    platform: 'web',
    designSystemPreset: 'saas_minimal',
};

// An edited latest spine deliberately carries NO persisted canonicalSpine
// (mobile localStorage quota — fix c9df7c5); the review context must rebuild it.
const editedSpine: SpineVersion = {
    id: 'spine-edited',
    projectId: 'p1',
    promptText: '',
    responseText: 'edited md',
    createdAt: 1,
    isLatest: true,
    isFinal: false,
    prdVersion: 2,
    structuredPRD,
    canonicalSpine: undefined,
};

describe('useReviewContextManifest — lazy canonicalSpine reconstruction', () => {
    it('rebuilds the canonicalSpine for a spine that no longer persists one', () => {
        const { result } = renderHook(() => useReviewContextManifest({
            projectId: 'p1',
            project,
            spines: [editedSpine],
            artifacts: [],
            artifactVersions: [],
            reviewRuns: [],
        }));

        const manifest = result.current.currentManifest;
        expect(manifest).toBeDefined();
        // The authoritative spine block is present even though it was never
        // persisted on the edit version, and it is bound to that version id.
        expect(manifest?.canonicalSpine).toBeDefined();
        expect(manifest?.canonicalSpine?.meta.sourceSpineVersionId).toBe('spine-edited');
        expect(manifest?.canonicalSpine?.features.map(f => f.id)).toEqual(['f1']);
        expect(manifest?.canonicalSpine?.identity.productName).toBe('MoodTune');
    });
});
