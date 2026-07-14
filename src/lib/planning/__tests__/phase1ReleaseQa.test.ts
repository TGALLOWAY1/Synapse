import { describe, expect, it } from 'vitest';
import type {
    Artifact,
    ArtifactVersion,
    PlanningRecord,
    SpineVersion,
    StructuredPRD,
} from '../../../types';
import { buildDecisionImpact } from '../decisionImpact';
import { appendDecisionEvent, projectDecision } from '../decisionProjection';
import { recordConsequentialPrdEdit } from '../consequentialEditRecognition';
import { deriveProjectOutputAlignment } from '../outputAlignment';

const prd = (overrides: Partial<StructuredPRD> = {}): StructuredPRD => ({
    vision: 'Help enterprise teams coordinate work.',
    targetUsers: ['Enterprise administrators'],
    coreProblem: 'Shared planning is fragmented across tools.',
    features: [{
        id: 'collaboration',
        name: 'Shared workspaces',
        description: 'Invite teammates into a shared workspace.',
        userValue: 'Keep a team aligned.',
        complexity: 'medium',
        tier: 'mvp',
        confirmed: true,
    }],
    architecture: 'Cloud-synchronized web application.',
    risks: ['Adoption'],
    successMetrics: [{ name: 'Administrator activation', target: '60%' }],
    ...overrides,
});

const spine = (id: string, structuredPRD: StructuredPRD, isLatest: boolean): SpineVersion => ({
    id,
    projectId: 'p1',
    promptText: 'prompt',
    responseText: 'prd',
    createdAt: id === 's1' ? 100 : 200,
    isLatest,
    isFinal: false,
    structuredPRD,
});

const artifact = (id: string, subtype: Artifact['subtype']): Artifact => ({
    id,
    projectId: 'p1',
    type: 'core_artifact',
    subtype,
    title: subtype ?? id,
    status: 'active',
    currentVersionId: `${id}-v1`,
    createdAt: 100,
    updatedAt: 100,
});

const artifactVersion = (artifactId: string, sourceSpineId?: string, content = 'Saved output'): ArtifactVersion => ({
    id: `${artifactId}-v1`,
    artifactId,
    versionNumber: 1,
    parentVersionId: null,
    content,
    metadata: {},
    sourceRefs: sourceSpineId ? [{
        id: `ref-${artifactId}`,
        sourceArtifactId: 'p1',
        sourceArtifactVersionId: sourceSpineId,
        sourceType: 'spine',
    }] : [],
    generationPrompt: '',
    isPreferred: true,
    createdAt: 100,
});

describe('Phase 1 adversarial release scenarios', () => {
    it('keeps a primary-user change possibly affected instead of claiming saved outputs are invalid', () => {
        const screens = artifact('screens', 'screen_inventory');
        const result = deriveProjectOutputAlignment({
            artifacts: [screens],
            artifactVersions: [artifactVersion(screens.id, 's1', 'Enterprise administrator dashboard')],
            spineVersions: [
                spine('s1', prd(), false),
                spine('s2', prd({ targetUsers: ['Independent creators'] }), true),
            ],
        });

        expect(result.outputs[0]).toMatchObject({
            state: 'possibly_affected',
            confidence: 'possible',
            usefulForExploration: true,
            blocksBuildReadiness: true,
        });
        expect(result.outputs[0].summary.toLowerCase()).not.toContain('invalid');
    });

    it('treats uncertain cloud-to-local impact as reviewable, not a definite contradiction', () => {
        const dataModel = artifact('data', 'data_model');
        const result = deriveProjectOutputAlignment({
            artifacts: [dataModel],
            artifactVersions: [artifactVersion(dataModel.id, 's1', 'Cloud-backed project records')],
            spineVersions: [
                spine('s1', prd(), false),
                spine('s2', prd({ architecture: 'Local-only desktop application.' }), true),
            ],
        });

        expect(result.outputs[0]).toMatchObject({
            state: 'possibly_affected',
            confidence: 'possible',
            usefulForExploration: true,
            blocksBuildReadiness: true,
        });
        expect(result.outputs[0].nextAction).toContain('Review');
    });

    it('does not treat a removed-feature mention as proof that an output still assumes it', () => {
        const screens = artifact('screens', 'screen_inventory');
        const result = deriveProjectOutputAlignment({
            artifacts: [screens],
            artifactVersions: [artifactVersion(
                screens.id,
                's1',
                'Shared workspaces are explicitly out of scope for this release.',
            )],
            spineVersions: [
                spine('s1', prd(), false),
                spine('s2', prd({ features: [] }), true),
            ],
        });

        expect(result.outputs[0]).toMatchObject({
            state: 'possibly_affected',
            confidence: 'possible',
            blocksBuildReadiness: true,
            usefulForExploration: true,
        });
        expect(result.outputs[0].summary).toContain('cannot determine from text alone');
    });

    it('keeps missing legacy provenance advisory rather than manufacturing alignment certainty', () => {
        const implementation = artifact('implementation', 'implementation_plan');
        const result = deriveProjectOutputAlignment({
            artifacts: [implementation],
            artifactVersions: [artifactVersion(implementation.id)],
            spineVersions: [spine('s1', prd(), true)],
        });

        expect(result.outputs[0]).toMatchObject({
            state: 'possibly_affected',
            confidence: 'unknown',
            blocksBuildReadiness: false,
            usefulForExploration: true,
        });
    });

    it('does not duplicate direct-edit verdicts or conflict records when the same save is replayed', () => {
        const existing: PlanningRecord = {
            id: 'audience-decision',
            projectId: 'p1',
            type: 'decision',
            status: 'confirmed',
            title: 'Primary audience',
            statement: 'The product serves Enterprise administrators.',
            resolution: 'Enterprise administrators',
            evidence: [],
            sourceFindingIds: [],
            createdBy: 'user',
            createdAt: 1,
            updatedAt: 2,
            confirmedAt: 2,
            events: [{
                id: 'audience-verdict',
                planningRecordId: 'audience-decision',
                type: 'custom_answered',
                actor: 'user',
                answer: 'Enterprise administrators',
                at: 2,
            }],
        };
        let nextId = 0;
        const idFactory = () => `qa-${++nextId}`;
        const input = {
            projectId: 'p1',
            before: prd(),
            after: prd({ targetUsers: ['Independent creators'] }),
            at: 100,
            idFactory,
        };
        const first = recordConsequentialPrdEdit({
            ...input,
            sourceSpineVersionId: 's2',
            existingRecords: [existing],
        });
        const second = recordConsequentialPrdEdit({
            ...input,
            sourceSpineVersionId: 's3',
            existingRecords: first.records,
            at: 101,
        });

        expect(second.records.filter(record => record.type === 'conflict')).toHaveLength(1);
        const editRecord = second.records.find(record => record.sources?.some(source => source.key === 'prd_edit:targetUsers'));
        expect(editRecord).toBeDefined();
        expect(editRecord?.events?.filter(event => event.type === 'custom_answered' || event.type === 'revised')).toHaveLength(1);
        expect(projectDecision(existing).answer).toBe('Enterprise administrators');
    });

    it('refuses to turn a legacy machine-authored confirmed field into applicable user authority', () => {
        const legacy: PlanningRecord = {
            id: 'legacy',
            projectId: 'p1',
            type: 'decision',
            status: 'confirmed',
            title: 'Account requirement',
            statement: 'Require an account first',
            resolution: 'Require an account first',
            evidence: [],
            sourceFindingIds: [],
            createdBy: 'synapse',
            createdAt: 1,
            updatedAt: 1,
        };

        expect(projectDecision(legacy).status).toBe('proposed');
        expect(buildDecisionImpact({
            projectId: 'p1',
            record: legacy,
            baselineSpineVersionId: 's1',
            structuredPRD: prd(),
        })).toMatchObject({ ok: false });
    });

    it('keeps stale decision previews refresh-only and deduplicates repeated review clicks', () => {
        const decision: PlanningRecord = {
            id: 'platform',
            projectId: 'p1',
            type: 'decision',
            status: 'confirmed',
            title: 'Platform',
            statement: 'Choose the launch platform.',
            evidence: [],
            sourceFindingIds: [],
            createdBy: 'user',
            createdAt: 1,
            updatedAt: 2,
            events: [{
                id: 'platform-verdict',
                planningRecordId: 'platform',
                type: 'custom_answered',
                actor: 'user',
                answer: 'Web application',
                at: 2,
            }],
            alignmentHints: [{
                target: {
                    kind: 'claim',
                    section: 'Architecture',
                    label: 'Architecture approach',
                    jsonPath: '$.architecture',
                    excerpt: 'Cloud-synchronized web application.',
                },
                operation: 'replace',
                proposedValue: 'Web application',
                proposedSummary: 'Web application',
                reason: 'This exact claim expresses the platform choice.',
                confidence: 'definite',
            }],
        };
        const impact = buildDecisionImpact({
            projectId: 'p1',
            record: decision,
            baselineSpineVersionId: 's1',
            structuredPRD: prd(),
            now: () => 3,
        });
        if (!impact.ok) throw new Error(impact.reason);
        const proposalId = impact.preview.alignmentProposals?.[0].id;
        const proposalContentHash = impact.preview.alignmentProposals?.[0].contract?.proposalContentHash;
        if (!proposalId) throw new Error('Expected a proposal');
        const withPreview: PlanningRecord = { ...decision, assessments: [impact.assessment] };
        const firstReview = appendDecisionEvent(withPreview, {
            id: 'review-once',
            planningRecordId: decision.id,
            type: 'alignment_change_reviewed',
            actor: 'user',
            impactPreviewId: impact.preview.id,
            proposalId,
            disposition: 'accepted',
            proposalContentHash,
            at: 4,
        });
        if (!firstReview.ok) throw new Error(firstReview.reason);
        const repeatedReview = appendDecisionEvent(firstReview.record, {
            id: 'review-twice',
            planningRecordId: decision.id,
            type: 'alignment_change_reviewed',
            actor: 'user',
            impactPreviewId: impact.preview.id,
            proposalId,
            disposition: 'accepted',
            proposalContentHash,
            at: 5,
        });
        expect(repeatedReview).toMatchObject({ ok: true, duplicate: true });

        const revised = appendDecisionEvent(firstReview.record, {
            id: 'new-platform-verdict',
            planningRecordId: decision.id,
            type: 'revised',
            actor: 'user',
            previousEventId: 'platform-verdict',
            answer: 'Native desktop application',
            at: 5,
        });
        if (!revised.ok) throw new Error(revised.reason);
        const staleReview = appendDecisionEvent(revised.record, {
            id: 'review-old-preview',
            planningRecordId: decision.id,
            type: 'alignment_change_reviewed',
            actor: 'user',
            impactPreviewId: impact.preview.id,
            proposalId,
            disposition: 'rejected',
            at: 6,
        });
        expect(staleReview).toEqual({
            ok: false,
            reason: 'The decision changed after this impact preview was created.',
        });
    });

    it('preserves explicit target-user output precision instead of fanning back out from the PRD', () => {
        const directEdit: PlanningRecord = {
            id: 'target-user-edit',
            projectId: 'p1',
            type: 'decision',
            status: 'confirmed',
            title: 'Primary users',
            statement: 'Enterprise administrators → Independent creators',
            resolution: 'Independent creators',
            evidence: [],
            sourceFindingIds: [],
            createdBy: 'user',
            createdAt: 1,
            updatedAt: 2,
            resultingSpineVersionId: 's2',
            sources: [{
                key: 'prd_edit:targetUsers',
                sourceType: 'prd',
                sourceId: 'targetUsers',
                sourceVersionId: 's2',
                locator: { section: 'Target Users', entityType: 'claim', jsonPath: '$.targetUsers' },
            }],
            affectedPlanLocations: [
                { kind: 'claim', section: 'Target Users', label: 'Primary users', jsonPath: '$.targetUsers' },
                { kind: 'flow_step', section: 'UX Pages', label: 'User experience', jsonPath: '$.uxPages' },
            ],
            affectedArtifactSlots: [
                'screen_inventory',
                'user_flows',
                'component_inventory',
                'implementation_plan',
                'mockup',
            ],
            events: [{
                id: 'target-user-verdict',
                planningRecordId: 'target-user-edit',
                type: 'custom_answered',
                actor: 'user',
                answer: 'Independent creators',
                at: 2,
            }],
        };
        const impact = buildDecisionImpact({
            projectId: 'p1',
            record: directEdit,
            baselineSpineVersionId: 's2',
            structuredPRD: prd({ targetUsers: ['Independent creators'] }),
            now: () => 3,
        });
        if (!impact.ok) throw new Error(impact.reason);

        expect(impact.preview.affectedArtifactSlots).toEqual(expect.arrayContaining([
            'screen_inventory',
            'user_flows',
            'implementation_plan',
            'mockup',
        ]));
        expect(impact.preview.affectedArtifactSlots).not.toContain('data_model');
        expect(impact.preview.affectedArtifactSlots).not.toContain('design_system');
    });
});
