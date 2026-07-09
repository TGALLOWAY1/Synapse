import { describe, it, expect } from 'vitest';
import {
    buildScreenDownstreamImpact,
    buildScreensDownstreamImpactRollup,
    buildRecommendedNextActions,
    buildScreensPreflight,
    type DownstreamScreenInput,
} from '../screenDownstreamImpact';
import type { ScreenArtifactReviewReadiness } from '../screenReviewWorkflow';

function input(overrides: Partial<DownstreamScreenInput> = {}): DownstreamScreenInput {
    return {
        screenId: 's',
        title: 'Screen',
        isP0: false,
        userStatus: undefined,
        reviewFreshness: 'current',
        blockingCount: 0,
        blockingTitles: [],
        mockupFreshnessStale: false,
        mockupFreshnessUnknown: false,
        hasDataRequirements: false,
        ...overrides,
    };
}

/** A minimal "ready" artifact-review gate for rollup/preflight tests. */
function gate(overrides: Partial<ScreenArtifactReviewReadiness> = {}): ScreenArtifactReviewReadiness {
    return {
        ready: true,
        totalScreens: 1,
        accepted: 1,
        implementationReady: 0,
        needsReview: 0,
        draft: 0,
        blockers: 0,
        reviewItems: 0,
        p0: { total: 1, signedOff: 1, withBlockers: 0, notSignedOff: [] },
        reasons: [],
        message: 'Ready',
        ...overrides,
    };
}

describe('buildScreenDownstreamImpact', () => {
    it('1. an accepted screen changed after sign-off creates downstream impacts', () => {
        const impact = buildScreenDownstreamImpact(input({
            userStatus: 'accepted',
            reviewFreshness: 'outdated',
            hasDataRequirements: true,
        }));
        const kinds = impact.impactedArtifacts.map(a => a.kind);
        expect(kinds).toContain('mockups');
        expect(kinds).toContain('implementation_plan');
        expect(kinds).toContain('data_model');
        expect(kinds).toContain('prompt_pack');
        expect(impact.summary.reviewCount).toBeGreaterThan(0);
    });

    it('2. a draft screen with outdated/unknown review does NOT create the sign-off impacts', () => {
        const impact = buildScreenDownstreamImpact(input({
            userStatus: 'draft',
            reviewFreshness: 'outdated',
            hasDataRequirements: true,
        }));
        // No sign-off → no change-driven impacts at all.
        expect(impact.impactedArtifacts).toHaveLength(0);
    });

    it('3. a P0 screen with a blocker creates a blocking implementation impact', () => {
        const impact = buildScreenDownstreamImpact(input({
            isP0: true,
            blockingCount: 1,
            blockingTitles: ['No acceptance criteria'],
        }));
        const impl = impact.impactedArtifacts.find(a => a.kind === 'implementation_plan');
        expect(impl?.severity).toBe('blocking');
        expect(impl?.evidence).toContain('No acceptance criteria');
        expect(impact.summary.hasBlockingImpact).toBe(true);
    });

    it('4. stale mockup variants create a mockup review impact', () => {
        const impact = buildScreenDownstreamImpact(input({ mockupFreshnessStale: true }));
        const m = impact.impactedArtifacts.find(a => a.kind === 'mockups');
        expect(m?.severity).toBe('review');
    });

    it('5. unknown mockup freshness creates an info impact, not a blocker', () => {
        const impact = buildScreenDownstreamImpact(input({ mockupFreshnessUnknown: true }));
        const m = impact.impactedArtifacts.find(a => a.kind === 'mockups');
        expect(m?.severity).toBe('info');
        expect(impact.summary.hasBlockingImpact).toBe(false);
    });

    it('a non-data screen changed after sign-off does not impact the data model', () => {
        const impact = buildScreenDownstreamImpact(input({
            userStatus: 'accepted',
            reviewFreshness: 'outdated',
            hasDataRequirements: false,
        }));
        expect(impact.impactedArtifacts.some(a => a.kind === 'data_model')).toBe(false);
    });
});

describe('buildScreensDownstreamImpactRollup', () => {
    it('6. is ready when the gate is ready and there are no P0 downstream blockers', () => {
        const rollup = buildScreensDownstreamImpactRollup(
            [input({ isP0: true, userStatus: 'accepted' })],
            gate(),
        );
        expect(rollup.overallStatus).toBe('ready');
        expect(rollup.totalImpactedScreens).toBe(0);
    });

    it('7. is not ready when a P0 accepted screen is outdated', () => {
        const rollup = buildScreensDownstreamImpactRollup(
            [input({ isP0: true, userStatus: 'accepted', reviewFreshness: 'outdated' })],
            gate(),
        );
        expect(rollup.overallStatus).toBe('not_ready');
        expect(rollup.impactedP0Screens).toBe(1);
    });

    it('8. is review recommended for a non-P0 outdated accepted screen (P0 gate clean)', () => {
        const rollup = buildScreensDownstreamImpactRollup(
            [
                input({ screenId: 'p0', isP0: true, userStatus: 'accepted' }),
                input({ screenId: 'sup', isP0: false, userStatus: 'accepted', reviewFreshness: 'outdated' }),
            ],
            gate(),
        );
        expect(rollup.overallStatus).toBe('review_recommended');
        expect(rollup.byArtifact.mockups.review).toBeGreaterThan(0);
    });

    it('is not ready when the Phase 4A gate itself is not ready', () => {
        const rollup = buildScreensDownstreamImpactRollup(
            [input({ isP0: true, userStatus: 'draft' })],
            gate({ ready: false, p0: { total: 1, signedOff: 0, withBlockers: 0, notSignedOff: [{ id: 'p0', name: 'P0' }] } }),
        );
        expect(rollup.overallStatus).toBe('not_ready');
    });
});

describe('buildRecommendedNextActions', () => {
    it('9. prioritizes P0 blockers first', () => {
        const actions = buildRecommendedNextActions([
            input({ screenId: 'sup', title: 'Settings', isP0: false, userStatus: 'accepted', reviewFreshness: 'outdated' }),
            input({ screenId: 'p0', title: 'Checkout', isP0: true, blockingCount: 1, blockingTitles: ['No purpose'] }),
        ]);
        expect(actions[0]).toMatch(/Resolve blockers on Checkout/);
    });

    it('10. caps the action list to a small useful size (<= 5)', () => {
        const inputs = Array.from({ length: 12 }, (_, i) => input({
            screenId: `p${i}`, title: `P0 ${i}`, isP0: true, blockingCount: 1, blockingTitles: ['x'],
        }));
        const actions = buildRecommendedNextActions(inputs);
        expect(actions.length).toBeLessThanOrEqual(5);
        expect(actions.length).toBeGreaterThan(0);
    });
});

describe('buildScreensPreflight', () => {
    it('reports ready with no blockers when the gate is clean', () => {
        const pre = buildScreensPreflight([input({ isP0: true, userStatus: 'accepted' })], gate());
        expect(pre.status).toBe('ready');
        expect(pre.blocking).toHaveLength(0);
        expect(pre.headline).toMatch(/Ready for implementation planning/);
    });

    it('surfaces blockers, review items, and recommended next steps', () => {
        const pre = buildScreensPreflight(
            [
                input({ screenId: 'p0', title: 'Dashboard', isP0: true, blockingCount: 1, blockingTitles: ['No acceptance criteria'] }),
                input({ screenId: 'sup', title: 'Settings', isP0: false, userStatus: 'accepted', reviewFreshness: 'outdated' }),
            ],
            gate({ ready: false, p0: { total: 1, signedOff: 0, withBlockers: 1, notSignedOff: [{ id: 'p0', name: 'Dashboard' }] } }),
        );
        expect(pre.status).toBe('not_ready');
        expect(pre.blocking.length).toBeGreaterThan(0);
        expect(pre.review.length).toBeGreaterThan(0);
        expect(pre.recommendedNextActions.length).toBeGreaterThan(0);
    });
});
