import { describe, expect, it } from 'vitest';
import type { DecisionImpactPreview, PlanningAlignmentHint, PlanningRecord, StructuredPRD } from '../../../types';
import { appendDecisionEvent } from '../decisionProjection';
import {
    applyPlanningTargetValue,
    buildDecisionImpact,
    buildReviewedDecisionImpact,
    integrateAlignmentHintIntoPreview,
    readPlanningTargetValue,
    validateAlignmentProposalContract,
} from '../decisionImpact';

const prd: StructuredPRD = {
    vision: 'Help enterprise administrators plan.',
    targetUsers: ['Enterprise administrators'],
    coreProblem: 'Planning is inconsistent.',
    architecture: 'Web application',
    risks: [],
    features: [],
    constraints: ['Cloud synchronized'],
    uxPages: [{ id: 'home', name: 'Home', purpose: 'Manage shared projects', components: [], interactions: [] }],
};

const evidence = {
    id: 'evidence-1', sourceType: 'spine' as const, sourceId: 'prd', sourceVersionId: 's1',
    locator: { section: 'UX Pages', jsonPath: '$.uxPages[0].purpose', entityType: 'ux_page', entityId: 'home' },
    excerpt: 'Manage shared projects', excerptHash: 'evidence-hash', verified: true,
};

const makeRecord = (hints: PlanningAlignmentHint[]): PlanningRecord => ({
    id: 'decision', projectId: 'p1', type: 'decision', status: 'confirmed', title: 'Project ownership',
    statement: 'Projects should be local-only', evidence: [evidence], sourceFindingIds: [], createdBy: 'user',
    createdAt: 1, updatedAt: 2,
    events: [{ id: 'verdict', planningRecordId: 'decision', type: 'custom_answered', actor: 'user', answer: 'Local-only projects', at: 2 }],
    alignmentHints: hints,
});

const exactModelHint = (): PlanningAlignmentHint => ({
    target: { kind: 'behavior', section: 'UX Pages', label: 'Home purpose', jsonPath: '$.uxPages[0].purpose', entityType: 'ux_page', entityId: 'home' },
    operation: 'replace', proposedValue: 'Manage local projects', proposedSummary: 'Manage local projects',
    reason: 'Shared-project wording conflicts with the local-only decision.', confidence: 'definite',
    analysisMethod: 'model', model: 'reasoner-pro', provider: 'gemini', analysisStatus: 'bounded_applicable',
});

const build = (record: PlanningRecord) => {
    const result = buildDecisionImpact({ projectId: 'p1', record, baselineSpineVersionId: 's1', structuredPRD: prd, now: () => 10 });
    if (!result.ok) throw new Error(result.reason);
    return result;
};

describe('alignment proposal safety contract', () => {
    it('separates bounded, needs-input, rejected, and failed analysis without model self-acceptance', () => {
        const result = build(makeRecord([
            exactModelHint(),
            { target: { kind: 'constraint', section: 'Constraints', label: 'Constraint' }, operation: 'replace', reason: 'Missing target/value', analysisStatus: 'needs_input', analysisMethod: 'model', model: 'reasoner-pro', provider: 'gemini' },
            { target: { kind: 'section', section: 'Features', label: 'All features', jsonPath: '$.features' }, operation: 'replace', proposedValue: [], proposedSummary: 'Replace all features', reason: 'Too broad', analysisMethod: 'model', model: 'reasoner-pro', provider: 'gemini' },
            { target: { kind: 'api_expectation', section: 'Architecture', label: 'API rule', jsonPath: '$.architecture' }, operation: 'replace', reason: 'Provider failed', analysisStatus: 'failed', analysisMethod: 'model', model: 'reasoner-pro', provider: 'gemini', failureReason: 'Invalid response' },
        ]));
        expect(result.preview.proposalContractVersion).toBe(1);
        expect(result.preview.alignmentProposals?.map(item => item.contract?.analysisStatus).slice(0, 4)).toEqual([
            'bounded_applicable', 'needs_input', 'rejected', 'failed',
        ]);
        expect(result.preview.proposedPrdPatch).toHaveLength(1);

        const withAssessment = { ...makeRecord(result.preview.alignmentProposals ? [exactModelHint()] : []), assessments: [result.assessment] };
        const unsafe = { id: 'ai-accept', planningRecordId: 'decision', type: 'alignment_change_reviewed', actor: 'synapse', impactPreviewId: result.preview.id, proposalId: result.preview.alignmentProposals![0].id, disposition: 'accepted', at: 11 };
        expect(appendDecisionEvent(withAssessment, unsafe as never)).toMatchObject({ ok: false, reason: 'Only a user may review an alignment change.' });
    });

    it('requires contracts on stamped previews and rejects tampered values', () => {
        const record = makeRecord([exactModelHint()]);
        const result = build(record);
        const proposal = result.preview.alignmentProposals![0];
        expect(validateAlignmentProposalContract({ record, preview: result.preview, proposal: { ...proposal, contract: undefined }, structuredPRD: prd })).toMatchObject({ ok: false });
        expect(validateAlignmentProposalContract({ record, preview: result.preview, proposal: { ...proposal, proposedValue: 'Tampered' }, structuredPRD: prd })).toMatchObject({ ok: false, reason: 'Proposal value was changed after analysis.' });
        expect(validateAlignmentProposalContract({ record, preview: result.preview, proposal: { ...proposal, contract: { ...proposal.contract!, baselineSpineContentHash: 'tampered' } }, structuredPRD: prd })).toMatchObject({ ok: false });
    });

    it('rejects stale evidence and changed verdicts at review/apply time', () => {
        const record = makeRecord([exactModelHint()]);
        const result = build(record);
        const proposal = result.preview.alignmentProposals![0];
        const staleEvidence = { ...record, evidence: [{ ...evidence, sourceVersionId: 's2' }] };
        expect(validateAlignmentProposalContract({ record: staleEvidence, preview: result.preview, proposal, structuredPRD: prd })).toMatchObject({ ok: false, reason: 'Proposal source evidence is stale.' });
        const changedVerdict: PlanningRecord = {
            ...record,
            events: [...record.events!, { id: 'revision', planningRecordId: 'decision', type: 'revised', actor: 'user', previousEventId: 'verdict', answer: 'Cloud projects', at: 3 }],
        };
        expect(validateAlignmentProposalContract({ record: changedVerdict, preview: result.preview, proposal, structuredPRD: prd })).toMatchObject({ ok: false, reason: 'Decision verdict changed after analysis.' });
    });

    it('applies one indexed scalar leaf and preserves every sibling', () => {
        const location = exactModelHint().target;
        expect(readPlanningTargetValue(prd, location)).toEqual({ found: true, value: 'Manage shared projects' });
        const next = applyPlanningTargetValue(prd, location, 'Manage local projects');
        expect(next?.uxPages?.[0]).toEqual({ ...prd.uxPages![0], purpose: 'Manage local projects' });
        expect(next?.constraints).toBe(prd.constraints);
        expect(applyPlanningTargetValue(prd, { ...location, jsonPath: '$.__proto__.polluted' }, 'yes')).toBeUndefined();
        expect(applyPlanningTargetValue(prd, location, ['wrong type'])).toBeUndefined();
    });

    it('keeps exact Phase 1 legacy previews compatible while rejecting broad legacy patches', () => {
        const record = makeRecord([exactModelHint()]);
        const built = build(record);
        const proposal = { ...built.preview.alignmentProposals![0], contract: undefined };
        const legacy: DecisionImpactPreview = { ...built.preview, proposalContractVersion: undefined, alignmentProposals: [proposal] };
        const withAssessment: PlanningRecord = { ...record, assessments: [{ ...built.assessment, impactPreview: legacy }] };
        const accepted = appendDecisionEvent(withAssessment, {
            id: 'accept', planningRecordId: 'decision', type: 'alignment_change_reviewed', actor: 'user', impactPreviewId: legacy.id, proposalId: proposal.id, disposition: 'accepted', at: 11,
        });
        if (!accepted.ok) throw new Error(accepted.reason);
        expect(buildReviewedDecisionImpact({ record: accepted.record, preview: legacy, structuredPRD: prd }).nextPrd?.uxPages?.[0].purpose).toBe('Manage local projects');

        const broad = { ...legacy, proposedPrdPatch: [{ proposalId: proposal.id, section: 'Features', operation: 'replace' as const, jsonPath: '$.features', value: [] }] };
        expect(validateAlignmentProposalContract({ record, preview: broad, proposal: { ...proposal, target: { ...proposal.target, kind: 'section', jsonPath: '$.features' } }, structuredPRD: prd })).toMatchObject({ ok: false });
    });

    it('integrates one refined model leaf without mutating the existing review preview', () => {
        const broadRecord: PlanningRecord = {
            ...makeRecord([]),
            affectedPlanLocations: [{ kind: 'behavior', section: 'UX Pages', label: 'Home behavior', jsonPath: '$.uxPages' }],
        };
        const built = build(broadRecord);
        const original = structuredClone(built.preview);
        const targetId = built.preview.alignmentProposals![0].id;
        const integrated = integrateAlignmentHintIntoPreview({
            record: broadRecord, preview: built.preview, targetProposalId: targetId,
            hint: exactModelHint(), structuredPRD: prd,
        });
        if (!integrated.ok) throw new Error(integrated.reason);
        expect(integrated.proposal.contract?.analysisStatus).toBe('bounded_applicable');
        expect(integrated.preview.alignmentProposals?.some(item => item.id === targetId)).toBe(false);
        expect(integrated.preview.proposedPrdPatch).toHaveLength(1);
        expect(built.preview).toEqual(original);

        const failed = integrateAlignmentHintIntoPreview({
            record: broadRecord, preview: built.preview, targetProposalId: targetId,
            hint: { ...exactModelHint(), model: undefined }, structuredPRD: prd,
        });
        expect(failed).toMatchObject({ ok: false, analysisStatus: 'failed' });
        expect(built.preview).toEqual(original);
    });
});
