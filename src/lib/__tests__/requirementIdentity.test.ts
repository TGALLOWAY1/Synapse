import { describe, expect, it } from 'vitest';
import type { Feature, StructuredPRD } from '../../types';
import {
    buildRequirementIndex,
    criterionIdFor,
    normalizeCriterionText,
    resolveCriterionRefs,
} from '../requirementIdentity';

// --- Fixtures -----------------------------------------------------------------

const EXPORT_CRITERION = 'The user can export the monthly report as PDF.';

const exportFeature: Feature = {
    id: 'F1',
    name: 'Report export',
    description: 'Export monthly activity reports for sharing.',
    userValue: 'Users can share results outside the app.',
    complexity: 'medium',
    priority: 'must',
    acceptanceCriteria: [
        EXPORT_CRITERION,
        'Export completes within 5 seconds for reports under 100 pages.',
        'A failed export shows a retry option.',
    ],
};

const inviteFeature: Feature = {
    id: 'F2',
    name: 'Team invites',
    description: 'Invite teammates by email.',
    userValue: 'Teams collaborate in one workspace.',
    complexity: 'low',
    acceptanceCriteria: [
        'An invited teammate receives an email with a join link.',
        'Expired invite links show a clear error page.',
    ],
};

/** Criterion-less feature — must still yield a RequirementId. */
const bareFeature: Feature = {
    id: 'F3',
    name: 'Dark mode',
    description: 'Theme toggle.',
    userValue: 'Comfortable night use.',
    complexity: 'low',
};

function makePrd(features: Feature[]): StructuredPRD {
    return {
        vision: 'v',
        targetUsers: ['u'],
        coreProblem: 'p',
        features,
        architecture: 'a',
        risks: [],
    };
}

// --- Index building -----------------------------------------------------------

describe('buildRequirementIndex', () => {
    it('yields a RequirementId (the Feature.id) for every feature, including criterion-less ones', () => {
        const index = buildRequirementIndex(makePrd([exportFeature, inviteFeature, bareFeature]));
        expect(index.requirements.map(r => r.id)).toEqual(['F1', 'F2', 'F3']);
        const bare = index.requirements[2];
        expect(bare.name).toBe('Dark mode');
        expect(bare.criteria).toEqual([]);
    });

    it('accepts a full StructuredPRD without adaptation', () => {
        // Type-level check: StructuredPRD is assignable to the builder input.
        const prd: StructuredPRD = makePrd([exportFeature]);
        expect(buildRequirementIndex(prd).criteria).toHaveLength(3);
    });

    it('yields a deterministic CriterionId of the documented shape for every criterion string', () => {
        const index = buildRequirementIndex(makePrd([exportFeature, inviteFeature]));
        expect(index.criteria).toHaveLength(5);
        for (const entry of index.criteria) {
            expect(entry.id).toMatch(new RegExp(`^${entry.requirementId}\\.AC\\.[0-9a-f]{8}$`));
            expect(entry.id).toBe(criterionIdFor(entry.requirementId, entry.text));
            expect(index.byCriterionId.get(entry.id)).toBe(entry);
        }
        // Deterministic across independent builds (no time/random inputs).
        const again = buildRequirementIndex(makePrd([exportFeature, inviteFeature]));
        expect(again.criteria.map(c => c.id)).toEqual(index.criteria.map(c => c.id));
        // Distinct criteria get distinct ids.
        expect(new Set(index.criteria.map(c => c.id)).size).toBe(5);
    });

    it('does not change any id when acceptanceCriteria are reordered', () => {
        const reordered: Feature = {
            ...exportFeature,
            acceptanceCriteria: [...(exportFeature.acceptanceCriteria ?? [])].reverse(),
        };
        const before = buildRequirementIndex(makePrd([exportFeature]));
        const after = buildRequirementIndex(makePrd([reordered]));
        const byText = (idx: ReturnType<typeof buildRequirementIndex>) =>
            new Map(idx.criteria.map(c => [c.text, c.id]));
        expect(byText(after)).toEqual(byText(before));
        expect(new Set(after.criteria.map(c => c.id))).toEqual(new Set(before.criteria.map(c => c.id)));
    });

    it('changes exactly one id when exactly one criterion is reworded', () => {
        const edited: Feature = {
            ...exportFeature,
            acceptanceCriteria: [
                EXPORT_CRITERION,
                'Export completes within 10 seconds for reports under 100 pages.', // reworded
                'A failed export shows a retry option.',
            ],
        };
        const before = buildRequirementIndex(makePrd([exportFeature]));
        const after = buildRequirementIndex(makePrd([edited]));
        const beforeIds = before.criteria.map(c => c.id);
        const afterIds = after.criteria.map(c => c.id);
        expect(afterIds[0]).toBe(beforeIds[0]);
        expect(afterIds[2]).toBe(beforeIds[2]);
        expect(afterIds[1]).not.toBe(beforeIds[1]);
    });

    it('scopes ids per feature: identical text under two features yields two ids', () => {
        const shared = 'The action is confirmed with an undo toast.';
        const a: Feature = { ...exportFeature, acceptanceCriteria: [shared] };
        const b: Feature = { ...inviteFeature, acceptanceCriteria: [shared] };
        const index = buildRequirementIndex(makePrd([a, b]));
        expect(index.criteria).toHaveLength(2);
        expect(index.criteria[0].id).not.toBe(index.criteria[1].id);
        expect(index.byNormalizedText.get(normalizeCriterionText(shared))).toHaveLength(2);
    });

    it('indexes the premium criterion lists with their kinds', () => {
        const premium: Feature = {
            ...bareFeature,
            successCriteria: ['Toggling theme persists across sessions.'],
            edgeCases: ['System theme changes mid-session are picked up.'],
            failureModes: ['Storage failure falls back to light theme.'],
            uiAcceptanceCriteria: ['The toggle reflects the active theme.'],
        };
        const index = buildRequirementIndex(makePrd([premium]));
        expect(index.criteria.map(c => c.kind)).toEqual(['success', 'edge_case', 'failure_mode', 'ui']);
        expect(index.requirements[0].criteria).toHaveLength(4);
    });

    it('skips blank strings and dedupes normalization-identical text within a feature', () => {
        const noisy: Feature = {
            ...exportFeature,
            acceptanceCriteria: [EXPORT_CRITERION, '   ', ''],
            // Same sentence up to decoration/case — premium list duplicate.
            successCriteria: ['the user can export the monthly report as PDF'],
        };
        const index = buildRequirementIndex(makePrd([noisy]));
        expect(index.criteria).toHaveLength(1);
        expect(index.criteria[0].kind).toBe('acceptance');
        expect(index.criteria[0].text).toBe(EXPORT_CRITERION);
    });
});

// --- Normalization & id stability ----------------------------------------------

describe('normalizeCriterionText / criterionIdFor', () => {
    it('maps decoration-only variants to the same id', () => {
        const variants = [
            EXPORT_CRITERION,
            'the user can export the monthly report as pdf',       // case + no period
            '  The user can export   the monthly report as PDF. ', // whitespace
            '- [ ] The user can export the monthly report as PDF', // DoD checkbox bullet
            '* **The user can export the monthly report as PDF.**', // bullet + emphasis
            '"The user can export the monthly report as PDF."',     // quoted
        ];
        const ids = new Set(variants.map(v => criterionIdFor('F1', v)));
        expect(ids.size).toBe(1);
    });

    it('gives different text a different id', () => {
        expect(criterionIdFor('F1', EXPORT_CRITERION))
            .not.toBe(criterionIdFor('F1', 'The user can export the weekly report as PDF.'));
    });

    it('is pure and repeatable', () => {
        expect(criterionIdFor('F1', EXPORT_CRITERION)).toBe(criterionIdFor('F1', EXPORT_CRITERION));
        expect(normalizeCriterionText('- [x] Done.  ')).toBe('done');
    });
});

// --- Reference resolution -------------------------------------------------------

describe('resolveCriterionRefs', () => {
    const index = buildRequirementIndex(makePrd([exportFeature, inviteFeature, bareFeature]));
    const exportId = criterionIdFor('F1', EXPORT_CRITERION);

    it('resolves verbatim prose as exact', () => {
        const res = resolveCriterionRefs(EXPORT_CRITERION, index);
        expect(res).toEqual({
            confidence: 'exact', id: exportId, requirementId: 'F1', text: EXPORT_CRITERION,
        });
    });

    it('resolves decoration/case variants (e.g. a DoD checkbox line) as normalized', () => {
        const res = resolveCriterionRefs('- [x] the user can export the monthly report as PDF', index);
        expect(res.confidence).toBe('normalized');
        expect(res.id).toBe(exportId);
        expect(res.requirementId).toBe('F1');
    });

    it('resolves a lightly re-cast restatement as fuzzy', () => {
        // Shape produced by taskExtractor.asObservableCriterion over a
        // deliverable: recase + reorder of the same content words.
        const res = resolveCriterionRefs('Show a retry option after a failed export.', index);
        expect(res.confidence).toBe('fuzzy');
        expect(res.id).toBe(criterionIdFor('F1', 'A failed export shows a retry option.'));
    });

    it('resolves a lead-in-decorated quote as fuzzy', () => {
        const res = resolveCriterionRefs(
            'Given the reports dashboard, the user can export the monthly report as PDF',
            index,
        );
        expect(res.confidence).toBe('fuzzy');
        expect(res.id).toBe(exportId);
    });

    it('reports unrelated prose as first-class unmatched with the text preserved', () => {
        const prose = 'The onboarding tour highlights the three core panels.';
        const res = resolveCriterionRefs(prose, index);
        expect(res).toEqual({ confidence: 'unmatched', id: null, requirementId: null, text: prose });
    });

    it('reports empty and whitespace-only input as unmatched', () => {
        expect(resolveCriterionRefs('', index).confidence).toBe('unmatched');
        expect(resolveCriterionRefs('   ', index).confidence).toBe('unmatched');
    });

    it('stays conservative: thin token overlap does not fuzzy-match', () => {
        // Shares only "export" + "report" content with F1's criteria (2 < 3
        // minimum shared tokens).
        const res = resolveCriterionRefs('Export the report', index);
        expect(res.confidence).toBe('unmatched');
        expect(res.id).toBeNull();
    });

    it('stays conservative: a ref missing a criterion content word fails criterion coverage', () => {
        // Drops most of "within 5 seconds for reports under 100 pages".
        const res = resolveCriterionRefs('Export completes quickly.', index);
        expect(res.confidence).toBe('unmatched');
    });

    it('resolves duplicate text across features to the earliest feature, deterministically', () => {
        const shared = 'The action is confirmed with an undo toast.';
        const a: Feature = { ...exportFeature, acceptanceCriteria: [shared] };
        const b: Feature = { ...inviteFeature, acceptanceCriteria: [shared] };
        const dupIndex = buildRequirementIndex(makePrd([a, b]));
        const res = resolveCriterionRefs(shared, dupIndex);
        expect(res.confidence).toBe('exact');
        expect(res.requirementId).toBe('F1');
        expect(res.id).toBe(criterionIdFor('F1', shared));
    });

    it('surfaces every confidence level across a realistic ref batch', () => {
        const refs = [
            EXPORT_CRITERION,                                          // exact
            '- expired invite links show a clear error page',          // normalized
            'Show a retry option after a failed export.',              // fuzzy
            'Set up the CI pipeline and configure linting.',           // unmatched
        ];
        const confidences = refs.map(r => resolveCriterionRefs(r, index).confidence);
        expect(confidences).toEqual(['exact', 'normalized', 'fuzzy', 'unmatched']);
    });
});
