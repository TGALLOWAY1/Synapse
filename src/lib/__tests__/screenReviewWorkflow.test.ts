import { describe, it, expect } from 'vitest';
import type { Feature, ScreenItem } from '../../types';
import {
    deriveScreenReviewIssues,
    buildScreenReviewModel,
    buildScreenArtifactReviewReadiness,
    compareReviewFreshness,
    buildScreenReviewSignature,
    computeScreenReviewHash,
    type ScreenReviewSignals,
    type ScreenReviewModel,
} from '../screenReviewWorkflow';

const FEATURES: Feature[] = [
    { id: 'F1', name: 'Activity feed', description: '', userValue: '', complexity: 'low' },
];

/** A screen with no review issues at all. */
const cleanScreen: ScreenItem = {
    id: 'scr-clean',
    name: 'Home Dashboard',
    priority: 'P0',
    purpose: 'Landing surface summarizing recent activity.',
    userIntent: 'See what changed',
    featureRefs: ['F1: Activity feed'],
    states: [{ name: 'Default', description: 'Shows the feed', trigger: 'data loads', type: 'default' }],
    entryPoints: ['App launch'],
    exitPaths: [{ label: 'Open item', target: 'Item Detail' }],
    coreUIElements: ['Activity feed', 'Header'],
    acceptanceCriteria: ['Feed renders latest activity'],
};

function cleanSignals(overrides: Partial<ScreenReviewSignals> = {}): ScreenReviewSignals {
    return {
        screen: cleanScreen,
        hasMockup: true,
        flowRefCount: 1,
        features: FEATURES,
        ...overrides,
    };
}

describe('deriveScreenReviewIssues', () => {
    it('a clean screen has no issues and can be accepted', () => {
        const model = buildScreenReviewModel(cleanSignals());
        expect(model.issues).toHaveLength(0);
        expect(model.systemReadiness).toBe('ready');
        expect(model.blockingCount).toBe(0);
    });

    it('a P0 screen with no derivable acceptance criteria has a blocking issue', () => {
        const bare: ScreenItem = { id: 's', name: 'Bare', priority: 'P0', purpose: '' };
        const issues = deriveScreenReviewIssues({ screen: bare, hasMockup: true, flowRefCount: 1 });
        const acceptance = issues.find(i => i.id === 'acceptance_missing');
        expect(acceptance?.severity).toBe('blocking');
    });

    it('a P0 screen missing its default mockup has a blocking issue', () => {
        const issues = deriveScreenReviewIssues(cleanSignals({ hasMockup: false }));
        expect(issues.find(i => i.id === 'mockup_missing_p0')?.severity).toBe('blocking');
    });

    it('a missing mobile mockup is optional info — never reduces readiness', () => {
        const issues = deriveScreenReviewIssues(cleanSignals({ mobileMockupMissing: true }));
        const mobile = issues.find(i => i.id === 'mockup_mobile_missing');
        // Additional mockup variants (mobile / responsive) are optional design
        // enrichment — they surface as info and must not push the screen to
        // blocking OR review-recommended.
        expect(mobile?.severity).toBe('info');
        expect(issues.some(i => i.severity === 'blocking' || i.severity === 'review')).toBe(false);
    });

    it('a stale mockup creates a review issue', () => {
        const issues = deriveScreenReviewIssues(cleanSignals({ freshnessStale: 1 }));
        expect(issues.find(i => i.id === 'mockup_freshness_stale')?.severity).toBe('review');
    });

    it('a high-severity unresolved risk on a P0 screen is blocking', () => {
        const screen: ScreenItem = {
            ...cleanScreen,
            riskDetails: [{ description: 'Data loss on refresh', severity: 'high' }],
        };
        const issues = deriveScreenReviewIssues(cleanSignals({ screen }));
        expect(issues.find(i => i.id === 'risk_high_unresolved')?.severity).toBe('blocking');
    });

    it('a high-severity risk with proposed handling is not a blocker', () => {
        const screen: ScreenItem = {
            ...cleanScreen,
            riskDetails: [{ description: 'Data loss', severity: 'high', proposedHandling: 'Autosave every 5s' }],
        };
        const issues = deriveScreenReviewIssues(cleanSignals({ screen }));
        expect(issues.some(i => i.severity === 'blocking')).toBe(false);
    });

    it('missing PRD traceability blocks a primary screen but only warns a supporting one', () => {
        const primary: ScreenItem = { ...cleanScreen, featureRefs: [] };
        const supporting: ScreenItem = { ...cleanScreen, priority: 'P3', featureRefs: [] };
        const pIssue = deriveScreenReviewIssues(cleanSignals({ screen: primary }))
            .find(i => i.id === 'traceability_missing');
        const sIssue = deriveScreenReviewIssues({ screen: supporting, hasMockup: true, flowRefCount: 1 })
            .find(i => i.id === 'traceability_missing');
        expect(pIssue?.severity).toBe('blocking');
        expect(sIssue?.severity).toBe('review');
    });

    it('freshness unknown is info, never a blocker', () => {
        const issues = deriveScreenReviewIssues(cleanSignals({ freshnessUnknown: 1 }));
        const unknown = issues.find(i => i.id === 'mockup_freshness_unknown');
        expect(unknown?.severity).toBe('info');
        expect(issues.some(i => i.severity === 'blocking' || i.severity === 'review')).toBe(false);
    });
});

describe('buildScreenReviewModel', () => {
    it('records acceptedOverWarnings when a user accepts a screen with open issues', () => {
        const model = buildScreenReviewModel(cleanSignals({
            hasMockup: false, // introduces a blocking issue
            userStatus: 'accepted',
        }));
        expect(model.userStatus).toBe('accepted');
        expect(model.systemReadiness).toBe('blocked');
        expect(model.acceptedOverWarnings).toBe(true);
    });

    it('keeps user status distinct from system readiness', () => {
        // Draft user status, but the system says it's ready to accept.
        const model = buildScreenReviewModel(cleanSignals({ userStatus: 'draft' }));
        expect(model.userStatus).toBe('draft');
        expect(model.systemReadiness).toBe('ready');
    });

    it('preserves legacy review metadata without deriving unused checklist progress', () => {
        const model = buildScreenReviewModel(cleanSignals({
            reviewMeta: {
                checklist: { purposeMatchesPrd: true },
                notes: 'Legacy note',
            },
        }));

        expect(model).not.toHaveProperty('checklist');
        expect(model).not.toHaveProperty('checklistProgress');
        expect(model.reviewMeta?.notes).toBe('Legacy note');
        expect(model.reviewMeta?.checklist?.purposeMatchesPrd).toBe(true);
    });
});

describe('review freshness', () => {
    it('is unknown when the review has no stored signature (legacy record)', () => {
        expect(compareReviewFreshness(undefined, cleanScreen)).toBe('unknown');
    });

    it('is current when the stored signature matches the screen', () => {
        const sig = buildScreenReviewSignature(cleanScreen, { prdVersionId: 'prd-1' });
        expect(compareReviewFreshness(sig, cleanScreen)).toBe('current');
    });

    it('is outdated when the screen contract changes after sign-off', () => {
        const sig = buildScreenReviewSignature(cleanScreen);
        const changed: ScreenItem = { ...cleanScreen, purpose: 'A completely different purpose now.' };
        expect(compareReviewFreshness(sig, changed)).toBe('outdated');
    });

    it('a display rename alone does NOT make the review outdated', () => {
        const sig = buildScreenReviewSignature(cleanScreen);
        const renamed: ScreenItem = { ...cleanScreen, name: 'Renamed Dashboard' };
        expect(compareReviewFreshness(sig, renamed)).toBe('current');
        // Sanity: the hash is stable across the rename.
        expect(computeScreenReviewHash(renamed)).toBe(computeScreenReviewHash(cleanScreen));
    });
});

describe('buildScreenArtifactReviewReadiness', () => {
    function modelWith(overrides: Partial<ScreenReviewSignals>): ScreenReviewModel {
        return buildScreenReviewModel(cleanSignals(overrides));
    }

    it('is ready when every P0 screen is accepted and no blockers remain', () => {
        const readiness = buildScreenArtifactReviewReadiness([
            { id: 'a', name: 'A', isP0: true, model: modelWith({ userStatus: 'accepted' }) },
            { id: 'b', name: 'B', isP0: true, model: modelWith({ userStatus: 'implementation_ready' }) },
            { id: 'c', name: 'C', isP0: false, model: modelWith({ userStatus: 'draft' }) },
        ]);
        expect(readiness.ready).toBe(true);
        expect(readiness.reasons).toHaveLength(0);
        expect(readiness.message).toMatch(/Ready for implementation planning/);
    });

    it('is not ready when a P0 screen still needs changes', () => {
        const readiness = buildScreenArtifactReviewReadiness([
            { id: 'a', name: 'A', isP0: true, model: modelWith({ userStatus: 'accepted' }) },
            { id: 'b', name: 'Checkout', isP0: true, model: modelWith({ userStatus: 'needs_review' }) },
        ]);
        expect(readiness.ready).toBe(false);
        expect(readiness.p0.notSignedOff.map(s => s.name)).toContain('Checkout');
        expect(readiness.reasons.join(' ')).toMatch(/not been accepted/);
    });

    it('is not ready when a P0 screen has blocking issues even if accepted', () => {
        const readiness = buildScreenArtifactReviewReadiness([
            { id: 'a', name: 'A', isP0: true, model: modelWith({ userStatus: 'accepted', hasMockup: false }) },
        ]);
        expect(readiness.ready).toBe(false);
        expect(readiness.p0.withBlockers).toBe(1);
        expect(readiness.reasons.join(' ')).toMatch(/blocking issues/);
    });
});
