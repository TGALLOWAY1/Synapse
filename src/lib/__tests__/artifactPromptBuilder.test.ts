import { describe, it, expect } from 'vitest';
import {
    buildArtifactPrompt,
    detectStaleFeatureNames,
    detectDegradedDependencies,
    type ArtifactSourceConflict,
} from '../artifactPromptBuilder';
import { buildCanonicalPrdSpine, buildCanonicalSpinePromptSection } from '../canonicalPrdSpine';
import type { StructuredPRD } from '../../types';

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

const spine = () => buildCanonicalPrdSpine(PRD, { now: () => 1 });
const spineSection = () => buildCanonicalSpinePromptSection(spine());

const baseInputs = (overrides: Partial<Parameters<typeof buildArtifactPrompt>[0]> = {}) => ({
    userPrefix: 'Create User Flows from this PRD:',
    guardrails: 'Output requirements: be concrete.',
    spineSection: spineSection(),
    dependencyContext: 'No dependency artifacts available yet.',
    presetSection: '',
    mockupSection: '',
    prdMarkdown: '# MoodTune PRD\n\nMood Capture and Resonance Playlist described here.',
    conflicts: [] as ArtifactSourceConflict[],
    ...overrides,
});

describe('buildArtifactPrompt — source hierarchy', () => {
    it('marks the canonical spine authoritative and the full PRD a secondary appendix', () => {
        const prompt = buildArtifactPrompt(baseInputs());
        // Explicit source-hierarchy preamble present.
        expect(prompt).toContain('SOURCE HIERARCHY');
        expect(prompt).toMatch(/CANONICAL PRD SPINE — authoritative/);
        // The spine's own authoritative header survives.
        expect(prompt).toMatch(/Canonical PRD Spine \(AUTHORITATIVE/);
        // Full PRD demoted to a clearly-labeled secondary appendix.
        expect(prompt).toMatch(/APPENDIX — Full PRD markdown \(SECONDARY reference only/);
        expect(prompt).toMatch(/MUST NEVER override a canonical spine field/);
        // Structured sources precede the prose appendix.
        expect(prompt.indexOf('CANONICAL PRD SPINE')).toBeLessThan(prompt.indexOf('APPENDIX — Full PRD'));
        expect(prompt.indexOf('STRUCTURED DEPENDENCY SUMMARIES')).toBeLessThan(prompt.indexOf('APPENDIX — Full PRD'));
    });

    it('instructs the model to prefer the spine over a conflicting dependency artifact', () => {
        const prompt = buildArtifactPrompt(baseInputs({
            dependencyContext: '### screen_inventory\nScreens: Capture Mood, Playlist.',
        }));
        expect(prompt).toMatch(/PREFER THE SPINE — unless the dependency is explicitly marked newer and valid/);
    });

    it('renders a visible KNOWN CONFLICTS / STALENESS block when conflicts exist', () => {
        const conflicts: ArtifactSourceConflict[] = [
            { kind: 'stale_feature_name', detail: 'Feature "f1" canonical name mismatch.' },
        ];
        const prompt = buildArtifactPrompt(baseInputs({ conflicts }));
        expect(prompt).toContain('KNOWN CONFLICTS / STALENESS');
        expect(prompt).toContain('Feature "f1" canonical name mismatch.');
    });

    it('omits the conflict block when there are no conflicts', () => {
        const prompt = buildArtifactPrompt(baseInputs({ conflicts: [] }));
        expect(prompt).not.toContain('KNOWN CONFLICTS / STALENESS');
    });
});

describe('detectStaleFeatureNames', () => {
    it('flags a canonical feature name that is absent from stale PRD prose', () => {
        // Prose renames "Resonance Playlist" to an older "Smart Mix" — the
        // canonical name no longer appears, so it must be flagged as stale.
        const staleProse = '# MoodTune\n\nMood Capture lets users log a vibe. The Smart Mix builds a queue.';
        const conflicts = detectStaleFeatureNames(spine(), staleProse);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].kind).toBe('stale_feature_name');
        expect(conflicts[0].detail).toContain('Resonance Playlist');
        expect(conflicts[0].detail).toContain('f2');
    });

    it('returns no conflicts when every canonical name appears in the prose', () => {
        const goodProse = '# MoodTune\n\nMood Capture and Resonance Playlist are the core features.';
        expect(detectStaleFeatureNames(spine(), goodProse)).toEqual([]);
    });

    it('ignores trivially short prose (nothing to compare against)', () => {
        expect(detectStaleFeatureNames(spine(), 'tiny')).toEqual([]);
    });
});

describe('detectDegradedDependencies', () => {
    it('flags a required dependency reported MISSING', () => {
        const depContext = '### screen_inventory (REQUIRED)\n**MISSING — this required dependency was unavailable at generation time.**';
        const conflicts = detectDegradedDependencies(depContext);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].kind).toBe('degraded_dependency');
        expect(conflicts[0].detail).toContain('screen_inventory');
    });

    it('returns no conflicts when required dependencies are present', () => {
        const depContext = '### screen_inventory (REQUIRED)\nScreens: Home, Detail.';
        expect(detectDegradedDependencies(depContext)).toEqual([]);
    });
});
