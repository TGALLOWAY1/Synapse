import { describe, expect, it } from 'vitest';
import type { DecisionImpactPreview, PlanningAlignmentHint, PlanningRecord, StructuredPRD } from '../../../types';
import { appendDecisionEvent } from '../decisionProjection';
import {
    applyPlanningTargetValue,
    alignmentProposalReviews,
    buildDecisionImpact,
    buildReviewedDecisionImpact,
    integrateAlignmentHintIntoPreview,
    readPlanningTargetValue,
    validateAlignmentProposalContract,
} from '../decisionImpact';
import { alignmentProposalContentHash } from '../proposalIntegrity';

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
    reasoningConfidence: 'high', evidenceCharacter: 'direct',
    analysisMethod: 'model', model: 'reasoner-pro', provider: 'gemini', analysisStatus: 'bounded_applicable',
});

const build = (record: PlanningRecord) => {
    const result = buildDecisionImpact({ projectId: 'p1', record, baselineSpineVersionId: 's1', structuredPRD: prd, now: () => 10 });
    if (!result.ok) throw new Error(result.reason);
    return result;
};

describe('alignment proposal safety contract', () => {
    it('separates bounded, aligned, not-applicable, needs-input, rejected, and failed analysis without model self-acceptance', () => {
        const result = build(makeRecord([
            exactModelHint(),
            { target: { kind: 'claim', section: 'Architecture', label: 'Architecture', jsonPath: '$.architecture' }, operation: 'replace', reason: 'Current architecture already reflects the decision.', analysisStatus: 'already_aligned', analysisMethod: 'model', model: 'reasoner-pro', provider: 'gemini', reasoningConfidence: 'high', evidenceCharacter: 'supported_inference' },
            { target: { kind: 'constraint', section: 'Constraints', label: 'Unrelated constraint', jsonPath: '$.constraints[0]' }, operation: 'replace', reason: 'This constraint is unrelated.', analysisStatus: 'not_applicable', analysisMethod: 'model', model: 'reasoner-pro', provider: 'gemini', reasoningConfidence: 'medium', evidenceCharacter: 'direct' },
            { target: { kind: 'constraint', section: 'Constraints', label: 'Constraint' }, operation: 'replace', reason: 'Missing target/value', analysisStatus: 'needs_input', analysisMethod: 'model', model: 'reasoner-pro', provider: 'gemini' },
            { target: { kind: 'section', section: 'Features', label: 'All features', jsonPath: '$.features' }, operation: 'replace', proposedValue: [], proposedSummary: 'Replace all features', reason: 'Too broad', analysisMethod: 'model', model: 'reasoner-pro', provider: 'gemini' },
            { target: { kind: 'api_expectation', section: 'Architecture', label: 'API rule', jsonPath: '$.architecture' }, operation: 'replace', reason: 'Provider failed', analysisStatus: 'failed', analysisMethod: 'model', model: 'reasoner-pro', provider: 'gemini', failureReason: 'Invalid response' },
        ]));
        expect(result.preview.proposalContractVersion).toBe(1);
        expect(result.preview.alignmentProposals?.map(item => item.contract?.analysisStatus).slice(0, 6)).toEqual([
            'bounded_applicable', 'already_aligned', 'not_applicable', 'needs_input', 'rejected', 'failed',
        ]);
        expect(result.preview.alignmentProposals?.[0]).toMatchObject({
            reasoningConfidence: 'high', evidenceCharacter: 'direct',
            contract: { reasoningConfidence: 'high', evidenceCharacter: 'direct' },
        });
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

    it('records aligned and not-affected confirmations explicitly and returns changed analysis to pending', () => {
        const alignedHint: PlanningAlignmentHint = {
            target: { kind: 'claim', section: 'Architecture', label: 'Architecture', jsonPath: '$.architecture' },
            operation: 'replace', reason: 'The current architecture already reflects the decision.',
            analysisStatus: 'already_aligned', analysisMethod: 'model', model: 'reasoner-pro', provider: 'gemini',
            reasoningConfidence: 'high', evidenceCharacter: 'supported_inference',
        };
        const record = makeRecord([alignedHint]);
        const result = build(record);
        const proposal = result.preview.alignmentProposals![0];
        const withAssessment: PlanningRecord = { ...record, assessments: [result.assessment] };
        const wrongMeaning = appendDecisionEvent(withAssessment, {
            id: 'wrong-meaning', planningRecordId: record.id, type: 'alignment_change_reviewed', actor: 'user',
            impactPreviewId: result.preview.id, proposalId: proposal.id, disposition: 'confirmed_not_applicable',
            proposalContentHash: proposal.contract?.proposalContentHash, at: 11,
        });
        expect(wrongMeaning).toMatchObject({ ok: false, reason: expect.stringMatching(/not-applicable analysis/i) });

        const confirmed = appendDecisionEvent(withAssessment, {
            id: 'confirm-aligned', planningRecordId: record.id, type: 'alignment_change_reviewed', actor: 'user',
            impactPreviewId: result.preview.id, proposalId: proposal.id, disposition: 'confirmed_aligned',
            proposalContentHash: proposal.contract?.proposalContentHash, at: 11,
        });
        if (!confirmed.ok) throw new Error(confirmed.reason);
        expect(alignmentProposalReviews(confirmed.record, result.preview)[0].disposition).toBe('confirmed_aligned');

        const changedBase = { ...proposal, reason: 'Changed reasoning after confirmation.' };
        const changedProposal = {
            ...changedBase,
            contract: { ...proposal.contract!, proposalContentHash: alignmentProposalContentHash(changedBase) },
        };
        const changedPreview: DecisionImpactPreview = {
            ...result.preview,
            alignmentProposals: [changedProposal],
        };
        expect(alignmentProposalReviews(confirmed.record, changedPreview)[0].disposition).toBe('pending');

        const changedRecord: PlanningRecord = {
            ...confirmed.record,
            assessments: confirmed.record.assessments?.map(assessment => assessment.impactPreview?.id === result.preview.id
                ? { ...assessment, impactPreview: changedPreview }
                : assessment),
        };
        const reconfirmed = appendDecisionEvent(changedRecord, {
            id: 'reconfirm-aligned', planningRecordId: record.id, type: 'alignment_change_reviewed', actor: 'user',
            impactPreviewId: changedPreview.id, proposalId: changedProposal.id, disposition: 'confirmed_aligned',
            proposalContentHash: changedProposal.contract.proposalContentHash, at: 12,
        });
        if (!reconfirmed.ok) throw new Error(reconfirmed.reason);
        expect(reconfirmed.duplicate).toBe(false);
        expect(alignmentProposalReviews(reconfirmed.record, changedPreview)[0].disposition).toBe('confirmed_aligned');
    });

    it('binds acceptance to the exact reviewed proposal even when proposal and patch are changed together', () => {
        const record = makeRecord([exactModelHint()]);
        const result = build(record);
        const proposal = result.preview.alignmentProposals![0];
        const withAssessment: PlanningRecord = { ...record, assessments: [result.assessment] };
        const accepted = appendDecisionEvent(withAssessment, {
            id: 'accept-exact', planningRecordId: record.id, type: 'alignment_change_reviewed', actor: 'user',
            impactPreviewId: result.preview.id, proposalId: proposal.id, disposition: 'accepted',
            proposalContentHash: proposal.contract?.proposalContentHash, at: 11,
        });
        if (!accepted.ok) throw new Error(accepted.reason);

        const changedBase = { ...proposal, proposedValue: 'Manage tampered projects', proposedSummary: 'Manage tampered projects' };
        const changedProposal = {
            ...changedBase,
            contract: { ...proposal.contract!, proposalContentHash: alignmentProposalContentHash(changedBase) },
        };
        const changedPreview: DecisionImpactPreview = {
            ...result.preview,
            alignmentProposals: [changedProposal],
            proposedPrdPatch: result.preview.proposedPrdPatch?.map(patch => ({ ...patch, value: 'Manage tampered projects' })),
        };
        const reviewed = buildReviewedDecisionImpact({ record: accepted.record, preview: changedPreview, structuredPRD: prd });
        expect(reviewed.nextPrd).toBeUndefined();
        expect(reviewed.rejectedProposalIds).toEqual([proposal.id]);
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
        expect(applyPlanningTargetValue(prd, { ...location, jsonPath: '$.uxPages[0].id' }, 'tampered')).toBeUndefined();
        expect(applyPlanningTargetValue({ ...prd, features: [{ id: 'f1', name: 'Feature', description: '', userValue: '', complexity: 'low', confirmed: true }] }, { ...location, jsonPath: '$.features[0].confirmed' }, false)).toBeUndefined();
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
