import { describe, it, expect } from 'vitest';
import type { DataModelContent, Feature, ScreenItem, StructuredImplementationPlan } from '../../types';
import type { ScreenExperienceItem } from '../screenExperience';
import type {
    ScreenReviewModel, SystemReadinessStatus, ScreenReviewFreshnessStatus,
} from '../screenReviewWorkflow';
import { buildScreenArtifactReviewReadiness } from '../screenReviewWorkflow';
import type { DerivedMockupVariant } from '../mockupVariants';
import {
    buildScreenImplementationHandoff, buildScreensHandoffRollup, buildHandoffPreflightContribution,
} from '../screenImplementationHandoff';
import { buildScreensPreflight, screenDownstreamInputFromModel } from '../screenDownstreamImpact';
import {
    buildScreensHandoffExportPackage, deriveScreensExportStatus,
    renderScreensHandoffExportMarkdown, renderScreensHandoffExportJson,
    screensHandoffExportFilename, SCREENS_HANDOFF_EXPORT_CAVEATS,
    type ScreensHandoffExportInput,
} from '../screenHandoffExport';

// --- Fixtures ----------------------------------------------------------------

function screen(overrides: Partial<ScreenItem> = {}): ScreenItem {
    return {
        name: 'Landing & Role Selection',
        priority: 'P0',
        purpose: 'Entry point where the user picks a target role.',
        userIntent: 'Select a target role and start an evaluation',
        featureRefs: ['F1'],
        states: [
            { name: 'Default', description: 'Roles shown', trigger: 'load', type: 'default', required: true },
        ],
        entryPoints: ['App launch'],
        exitPaths: [{ label: 'Start evaluation', target: 'Dashboard' }],
        coreUIElements: ['Hero banner', 'Role selection grid'],
        outputData: ['selected role id'],
        acceptanceCriteria: ['User can select exactly one target role.'],
        handoff: { route: '/', dataDependencies: ['Evaluation'] },
        ...overrides,
    };
}

function reviewModel(overrides: Partial<ScreenReviewModel> = {}): ScreenReviewModel {
    return {
        userStatus: 'accepted',
        systemReadiness: 'ready' as SystemReadinessStatus,
        issues: [],
        blockingCount: 0,
        reviewCount: 0,
        infoCount: 0,
        acceptedOverWarnings: false,
        freshness: 'current' as ScreenReviewFreshnessStatus,
        checklist: {},
        checklistProgress: { checked: 0, total: 8 },
        ...overrides,
    };
}

function variant(overrides: Partial<DerivedMockupVariant> = {}): DerivedMockupVariant {
    return {
        id: 'default',
        screenId: 'scr-landing',
        viewport: 'desktop',
        stateName: 'Default',
        stateType: 'default',
        status: 'generated',
        required: true,
        userSet: false,
        source: 'legacy',
        coverageStatus: 'unknown',
        coverageEstimated: true,
        notes: [],
        ...overrides,
    };
}

function item(scr: ScreenItem, id = 'scr-landing'): ScreenExperienceItem {
    return {
        id,
        slug: 'landing-role-selection',
        screen: scr,
        baseScreen: scr,
        isEdited: false,
        sectionTitle: 'Main',
        relatedFlows: [],
    };
}

const FEATURES: Feature[] = [
    { id: 'F1', name: 'Role selection', description: '', userValue: '', complexity: 'low' },
];

const DATA_MODEL: DataModelContent = {
    entities: [
        {
            name: 'Evaluation',
            description: 'A stored evaluation',
            fields: [
                { name: 'id', type: 'string', required: true, description: '' },
                { name: 'roleId', type: 'string', required: true, description: '' },
            ],
            relationships: [],
            featureRefs: ['F1'],
        },
    ],
};

const UNRELATED_DATA_MODEL: DataModelContent = {
    entities: [{ name: 'Unrelated', description: '', fields: [], relationships: [] }],
};

const PLAN: StructuredImplementationPlan = {
    milestones: [
        {
            id: 'm1',
            name: 'Landing shell',
            goal: 'Build the landing page',
            tasks: [],
            linkedArtifacts: { screens: ['Landing & Role Selection'] },
        },
    ],
};

/** Build a real export package from screens + review models, wiring the real
 * Phase 4B preflight + Phase 5A/5B handoff rollup. */
function buildPackage(opts: {
    screens: Array<{ item: ScreenExperienceItem; model: ScreenReviewModel; variants?: DerivedMockupVariant[] }>;
    dataModel?: DataModelContent | null;
    plan?: StructuredImplementationPlan | null;
    manifest?: ScreensHandoffExportInput['manifest'];
    projectName?: string;
}) {
    const reviewModels = new Map<string, ScreenReviewModel>();
    const p0Ids = new Set<string>();
    const handoffs = opts.screens.map(s => {
        reviewModels.set(s.item.id, s.model);
        if (s.item.screen.priority === 'P0' || s.item.screen.priority === 'core') p0Ids.add(s.item.id);
        return buildScreenImplementationHandoff({
            item: s.item,
            reviewModel: s.model,
            variants: s.variants ?? [variant({ screenId: s.item.id })],
            features: FEATURES,
            dataModel: opts.dataModel,
            implementationPlan: opts.plan,
        });
    });

    const artifactReview = buildScreenArtifactReviewReadiness(
        opts.screens.map(s => ({
            id: s.item.id,
            name: s.item.screen.name ?? s.item.id,
            isP0: s.item.screen.priority === 'P0' || s.item.screen.priority === 'core',
            model: s.model,
        })),
    );
    const inputs = opts.screens.map(s => screenDownstreamInputFromModel(s.item, s.model));
    const contribution = buildHandoffPreflightContribution(handoffs, p0Ids);
    const preflight = buildScreensPreflight(inputs, artifactReview, contribution);
    const handoffRollup = buildScreensHandoffRollup(handoffs, p0Ids);

    return buildScreensHandoffExportPackage({
        projectName: opts.projectName ?? 'Recruiter Portal',
        exportedAt: '2026-07-09T00:00:00.000Z',
        handoffs,
        reviewModels,
        preflight,
        handoffRollup,
        p0Ids,
        manifest: opts.manifest,
    });
}

// --- Tests -------------------------------------------------------------------

describe('buildScreensHandoffExportPackage', () => {
    it('1. includes schemaVersion', () => {
        const pkg = buildPackage({ screens: [{ item: item(screen()), model: reviewModel() }] });
        expect(pkg.schemaVersion).toBe(1);
    });

    it('2. includes all screens', () => {
        const pkg = buildPackage({
            screens: [
                { item: item(screen(), 'a'), model: reviewModel() },
                { item: item(screen({ name: 'Dashboard', priority: 'P1' }), 'b'), model: reviewModel() },
            ],
        });
        expect(pkg.screens).toHaveLength(2);
        expect(pkg.screens.map(s => s.screenId).sort()).toEqual(['a', 'b']);
    });

    it('3. is ready when the preflight and P0 handoff are ready', () => {
        const pkg = buildPackage({
            screens: [{ item: item(screen()), model: reviewModel({ userStatus: 'implementation_ready' }) }],
            dataModel: DATA_MODEL,
            plan: PLAN,
            manifest: { dataModelPresent: true, implementationPlanPresent: true },
        });
        expect(pkg.status).toBe('ready');
    });

    it('4. is review_recommended for a weak/estimated trace without blockers', () => {
        // Data Model present but no entity matches this screen's data deps →
        // handoff readiness becomes review_recommended (no blocker).
        const scr = screen({ featureRefs: ['F9'], handoff: { route: '/', dataDependencies: ['Widget'] } });
        const pkg = buildPackage({
            screens: [{ item: item(scr), model: reviewModel({ userStatus: 'accepted' }) }],
            dataModel: UNRELATED_DATA_MODEL,
            plan: PLAN,
            manifest: { dataModelPresent: true, implementationPlanPresent: true },
        });
        expect(pkg.status).toBe('review_recommended');
    });

    it('5. is not_ready when a P0 screen has blockers', () => {
        const pkg = buildPackage({
            screens: [{
                item: item(screen()),
                model: reviewModel({
                    userStatus: 'draft',
                    systemReadiness: 'blocked',
                    blockingCount: 1,
                    issues: [{ id: 'x', severity: 'blocking', category: 'purpose', title: 'No purpose recorded', description: '' }],
                }),
            }],
        });
        expect(pkg.status).toBe('not_ready');
    });

    it('6. does not become not_ready just because the Data Model artifact is absent', () => {
        const pkg = buildPackage({
            screens: [{ item: item(screen()), model: reviewModel({ userStatus: 'implementation_ready' }) }],
            dataModel: null,
            plan: null,
            manifest: { dataModelPresent: false, implementationPlanPresent: false },
        });
        expect(pkg.status).not.toBe('not_ready');
        // Absence is surfaced as a manifest caveat, never a blocking preflight item.
        expect(pkg.manifest.caveats.some(c => /No Data Model artifact/.test(c))).toBe(true);
        expect(pkg.preflight.blocking).toHaveLength(0);
    });

    it('7. surfaces a present-but-unmatched Data Model trace as a review item', () => {
        const scr = screen({ featureRefs: ['F9'], handoff: { route: '/', dataDependencies: ['Widget'] } });
        const pkg = buildPackage({
            screens: [{ item: item(scr), model: reviewModel({ userStatus: 'accepted' }) }],
            dataModel: UNRELATED_DATA_MODEL,
            plan: PLAN,
            manifest: { dataModelPresent: true, implementationPlanPresent: true },
        });
        const reviewText = pkg.preflight.review.join(' ').toLowerCase();
        expect(reviewText).toContain('data model');
    });

    it('7b. manifest trace confidence is per-artifact, not the overall rollup', () => {
        // Data Model fails to match (F9 / Widget vs. "Unrelated") but the plan
        // matches the screen by name → the Data Model entry must NOT inherit the
        // plan's strong confidence.
        const scr = screen({ featureRefs: ['F9'], handoff: { route: '/', dataDependencies: ['Widget'] } });
        const pkg = buildPackage({
            screens: [{ item: item(scr), model: reviewModel({ userStatus: 'accepted' }) }],
            dataModel: UNRELATED_DATA_MODEL,
            plan: PLAN,
            manifest: { dataModelPresent: true, implementationPlanPresent: true },
        });
        const dm = pkg.manifest.includedArtifacts.find(a => a.kind === 'data_model');
        const plan = pkg.manifest.includedArtifacts.find(a => a.kind === 'implementation_plan');
        expect(dm?.traceConfidence).toBe('No matches across traced screens');
        expect(plan?.traceConfidence).not.toBe('No matches across traced screens');
    });

    it('8. is not_ready when an accepted P0 screen is outdated', () => {
        const pkg = buildPackage({
            screens: [{
                item: item(screen()),
                model: reviewModel({ userStatus: 'implementation_ready', freshness: 'outdated' }),
            }],
            dataModel: DATA_MODEL,
            plan: PLAN,
            manifest: { dataModelPresent: true, implementationPlanPresent: true },
        });
        expect(pkg.status).toBe('not_ready');
        // The per-screen stale-review signal must survive into the export (a
        // review-freshness label, not the mockup-freshness map which lacks it).
        expect(pkg.screens[0].reviewFreshness).toBe('Changed after sign-off');
    });

    it('9. treats legacy unknown mockup freshness as a caveat, not a blocker', () => {
        const pkg = buildPackage({
            screens: [{
                item: item(screen()),
                model: reviewModel({ userStatus: 'implementation_ready' }),
                variants: [variant({ freshness: { status: 'unknown', reasons: [], severity: 'info', estimated: true } })],
            }],
            dataModel: DATA_MODEL,
            plan: PLAN,
            manifest: { dataModelPresent: true, implementationPlanPresent: true },
        });
        expect(pkg.status).not.toBe('not_ready');
        expect(pkg.summary.mockups.unknownFreshness).toBeGreaterThan(0);
        expect(pkg.preflight.blocking).toHaveLength(0);
    });

    it('13. never includes binary image data', () => {
        const pkg = buildPackage({
            screens: [{ item: item(screen()), model: reviewModel() }],
            dataModel: DATA_MODEL,
            plan: PLAN,
            manifest: { dataModelPresent: true, implementationPlanPresent: true },
        });
        const json = renderScreensHandoffExportJson(pkg);
        expect(json).not.toContain('data:image');
        expect(json).not.toContain('base64');
        // Mockup references carry labels only.
        for (const s of pkg.screens) {
            for (const m of s.mockupReferences) {
                expect(m).not.toHaveProperty('dataUrl');
                expect(typeof m.label).toBe('string');
            }
        }
    });

    it('14. caps recommended next actions and always carries honesty caveats', () => {
        const pkg = buildPackage({
            screens: [{ item: item(screen()), model: reviewModel() }],
        });
        expect(pkg.preflight.recommendedNextActions.length).toBeLessThanOrEqual(6);
        for (const caveat of SCREENS_HANDOFF_EXPORT_CAVEATS) {
            expect(pkg.manifest.caveats).toContain(caveat);
        }
    });

    it('15. does not throw on legacy / incomplete screens', () => {
        const bare: ScreenItem = { name: 'Legacy', priority: 'P2', purpose: '' };
        expect(() => buildPackage({
            screens: [{ item: item(bare, 'legacy'), model: reviewModel({ userStatus: undefined, freshness: 'unknown' }), variants: [] }],
        })).not.toThrow();
    });
});

describe('deriveScreensExportStatus', () => {
    const preflight = (status: 'ready' | 'review_recommended' | 'not_ready') =>
        ({ status, headline: '', blocking: [], review: [], info: [], recommendedNextActions: [], caveats: [] });
    const rollup = (status: 'ready' | 'review_recommended' | 'blocked') =>
        ({ total: 0, ready: 0, reviewRecommended: 0, blocked: 0, p0Ready: 0, p0Total: 0, status, message: '', trace: null });

    it('folds to the more conservative status', () => {
        expect(deriveScreensExportStatus(preflight('ready'), rollup('ready'))).toBe('ready');
        expect(deriveScreensExportStatus(preflight('ready'), rollup('review_recommended'))).toBe('review_recommended');
        expect(deriveScreensExportStatus(preflight('review_recommended'), rollup('blocked'))).toBe('not_ready');
        expect(deriveScreensExportStatus(preflight('ready'), rollup('blocked'))).toBe('not_ready');
        expect(deriveScreensExportStatus(preflight('not_ready'), rollup('ready'))).toBe('not_ready');
    });
});

describe('renderScreensHandoffExportMarkdown', () => {
    it('10. includes summary, preflight, manifest, and screen sections', () => {
        const pkg = buildPackage({
            screens: [{ item: item(screen()), model: reviewModel() }],
            dataModel: DATA_MODEL,
            plan: PLAN,
            manifest: { dataModelPresent: true, implementationPlanPresent: true, prdVersionId: 'prd-1', screensArtifactVersionId: 'scr-1' },
        });
        const md = renderScreensHandoffExportMarkdown(pkg);
        expect(md).toContain('# Screens Implementation Handoff');
        expect(md).toContain('## Summary');
        expect(md).toContain('## Preflight');
        expect(md).toContain('## Export Manifest');
        expect(md).toContain('# Screen: Landing & Role Selection');
        expect(md).toContain('## Route');
    });

    it('11. includes Data Model and Implementation Plan trace sections', () => {
        const pkg = buildPackage({
            screens: [{ item: item(screen()), model: reviewModel() }],
            dataModel: DATA_MODEL,
            plan: PLAN,
            manifest: { dataModelPresent: true, implementationPlanPresent: true },
        });
        const md = renderScreensHandoffExportMarkdown(pkg);
        expect(md).toContain('## Data Model Support');
        expect(md).toContain('## Related Implementation Plan Items');
        // The matched entity/task should appear.
        expect(md).toContain('Evaluation');
    });
});

describe('renderScreensHandoffExportJson', () => {
    it('12. includes schemaVersion and manifest, pretty-printed', () => {
        const pkg = buildPackage({
            screens: [{ item: item(screen()), model: reviewModel() }],
            manifest: { dataModelPresent: false, implementationPlanPresent: false },
        });
        const json = renderScreensHandoffExportJson(pkg);
        const parsed = JSON.parse(json);
        expect(parsed.schemaVersion).toBe(1);
        expect(parsed.manifest).toBeTruthy();
        expect(parsed.manifest.caveats.length).toBeGreaterThan(0);
        // Pretty-printed (two-space indent).
        expect(json).toContain('\n  "schemaVersion": 1');
    });
});

describe('screensHandoffExportFilename', () => {
    it('builds a safe filename per format', () => {
        const pkg = buildPackage({ screens: [{ item: item(screen()), model: reviewModel() }], projectName: 'My App!!' });
        expect(screensHandoffExportFilename(pkg, 'markdown')).toBe('my-app-screens-handoff.md');
        expect(screensHandoffExportFilename(pkg, 'json')).toBe('my-app-screens-handoff.json');
    });
});
