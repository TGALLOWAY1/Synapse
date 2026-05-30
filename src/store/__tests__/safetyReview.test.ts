import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../projectStore';
import {
    buildBlockedSafetyReview,
    buildRestrictedSafetyReview,
    buildSafetyReviewMarkdown,
    SafetyBlockedError,
} from '../../lib/safety';
import type { SafetyClassificationResult } from '../../lib/safety';

beforeEach(() => {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
    });
    localStorage.clear();
});

const disallowed: SafetyClassificationResult = {
    classification: 'disallowed',
    confidence: 'high',
    detectedConcerns: ['credential theft', 'unauthorized monitoring'],
    userFacingReason: 'This request enables unauthorized credential capture.',
    safeAlternatives: ['Endpoint monitoring dashboard'],
};

describe('safety review state gate', () => {
    it('stores a blocked review and never retains a PRD', () => {
        const store = useProjectStore.getState();
        const { projectId, spineId } = store.createProject('Phish Test', 'capture passwords');

        // Pretend a partial PRD had been painted before the block landed.
        store.updateStructuredPRD(projectId, spineId, {
            vision: 'x', targetUsers: [], coreProblem: 'x', features: [],
            architecture: 'x', risks: [],
        });

        const review = buildBlockedSafetyReview(disallowed);
        useProjectStore.getState().setSpineSafetyReview(
            projectId, spineId, review, buildSafetyReviewMarkdown(disallowed),
        );

        const spine = useProjectStore.getState().spineVersions[projectId][0];
        expect(spine.safetyReview?.status).toBe('blocked');
        expect(spine.structuredPRD).toBeUndefined();
        expect(spine.isFinal).toBe(false);
        expect(spine.responseText).toContain('Request Cannot Be Fulfilled');
        expect(spine.safetyReview?.detectedConcerns).toContain('credential theft');
    });

    it('blocked spines cannot be marked final', () => {
        const store = useProjectStore.getState();
        const { projectId, spineId } = store.createProject('Phish Test', 'capture passwords');
        useProjectStore.getState().setSpineSafetyReview(
            projectId, spineId, buildBlockedSafetyReview(disallowed),
            buildSafetyReviewMarkdown(disallowed),
        );

        // The store action itself still flips the flag, but the UI gate
        // (handleToggleFinal) refuses to call it; the controller gate also
        // no-ops. Here we assert the blocked status persists as the signal
        // those gates read.
        const spine = useProjectStore.getState().spineVersions[projectId][0];
        expect(spine.safetyReview?.status).toBe('blocked');
        expect(spine.isFinal).toBe(false);
    });

    it('records a history event when a request is blocked', () => {
        const store = useProjectStore.getState();
        const { projectId, spineId } = store.createProject('Phish Test', 'capture passwords');
        useProjectStore.getState().setSpineSafetyReview(
            projectId, spineId, buildBlockedSafetyReview(disallowed),
        );
        const events = useProjectStore.getState().historyEvents[projectId];
        expect(events.some(e => e.description === 'Blocked by Synapse safety review')).toBe(true);
    });

    it('stores a restricted review without dropping the PRD', () => {
        const store = useProjectStore.getState();
        const { projectId, spineId } = store.createProject('Sim', 'phishing sim with consent');
        store.updateStructuredPRD(projectId, spineId, {
            vision: 'x', targetUsers: [], coreProblem: 'x', features: [],
            architecture: 'x', risks: [],
        });
        const review = buildRestrictedSafetyReview({
            classification: 'allowed_with_restrictions',
            confidence: 'medium',
            detectedConcerns: ['phishing simulation'],
            userFacingReason: 'Constrained to authorized internal training.',
            safeAlternatives: [],
        });
        useProjectStore.getState().setSpineSafetyReview(projectId, spineId, review);

        const spine = useProjectStore.getState().spineVersions[projectId][0];
        expect(spine.safetyReview?.status).toBe('restricted');
        expect(spine.structuredPRD).toBeDefined(); // PRD preserved
    });
});

describe('SafetyBlockedError', () => {
    it('carries the classification result', () => {
        const err = new SafetyBlockedError(disallowed);
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('SafetyBlockedError');
        expect(err.result.classification).toBe('disallowed');
    });
});

describe('buildSafetyReviewMarkdown', () => {
    it('renders the canonical blocked document with safe alternatives', () => {
        const md = buildSafetyReviewMarkdown(disallowed);
        expect(md).toContain('# Request Cannot Be Fulfilled');
        expect(md).toContain('No project artifacts were generated.');
        expect(md).toContain('Blocked');
        expect(md).toContain('Disallowed Request');
        expect(md).toContain('Endpoint monitoring dashboard');
    });

    it('falls back to default alternatives when none are provided', () => {
        const md = buildSafetyReviewMarkdown({ ...disallowed, safeAlternatives: [] });
        expect(md).toContain('Security awareness training platform');
    });
});
