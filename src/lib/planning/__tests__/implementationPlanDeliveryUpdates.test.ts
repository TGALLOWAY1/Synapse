import { describe, expect, it } from 'vitest';
import type { Artifact, ArtifactVersion, SpineVersion, StructuredImplementationPlan, StructuredPRD } from '../../../types';
import { hashReviewValue } from '../../review/hash';
import { extractStructuredPlan } from '../../services/implementationPlanParser';
import { sealDownstreamArtifactUpdateReviewEvent } from '../downstreamArtifactUpdateProposal';
import { deriveDownstreamUpdatePlans } from '../downstreamUpdatePlanGeneration';
import { sealDownstreamUpdatePlan, type DownstreamUpdatePlan, type DownstreamUpdatePlanItem } from '../downstreamUpdatePlan';
import {
    applyImplementationPlanArtifactUpdate,
    deriveImplementationPlanArtifactUpdateProposal,
    parseUserGroundedImplementationPlanChange,
} from '../implementationPlanArtifactUpdates';

const projectId = 'delivery-project';
const planArtifact: Artifact = {
    id: 'implementation', projectId, type: 'core_artifact', subtype: 'implementation_plan', title: 'Implementation Plan',
    status: 'active', currentVersionId: 'implementation-v1', createdAt: 1, updatedAt: 1,
};

const basePlan: StructuredImplementationPlan = {
    overview: { summary: 'Manual plan context.' },
    milestones: [
        {
            id: 'workflow', name: 'Workflow workstream [feature:f1]', objective: 'Revise the creator workflow [feature:f1].',
            tasks: [
                { id: 'workflow-task', title: 'Implement creator workflow [feature:f1]', status: 'todo' },
                { id: 'migration-task', title: 'Migrate membership API [feature:f3]', status: 'todo' },
            ],
            definitionOfDone: ['Creator workflow follows the validated branch [feature:f1].'],
        },
        {
            id: 'release', name: 'Release', tasks: [{ id: 'release-task', title: 'Ship release', status: 'todo', dependencies: ['migration-task'] }],
            dependencies: ['workflow'], validationCommands: ['npm test'],
        },
    ],
    risks: [{ description: 'Legacy collaboration migration [feature:f3]', mitigation: 'Run a bounded migration.' }],
    summary: { criticalPath: ['workflow', 'release'] },
    architecture: ['Local-only storage.'],
};

const content = (plan: StructuredImplementationPlan = basePlan) => `# Implementation Plan

Manual prose before the fence must remain byte-for-byte unchanged.

\`\`\`json synapse-plan
${JSON.stringify(plan, null, 2)}
\`\`\`

Manual appendix after the fence must remain byte-for-byte unchanged.`;

const artifactVersion = (plan: StructuredImplementationPlan = basePlan): ArtifactVersion => ({
    id: 'implementation-v1', artifactId: planArtifact.id, versionNumber: 1, parentVersionId: null,
    content: content(plan), metadata: { manual: true }, generationPrompt: '', isPreferred: true, createdAt: 1,
    sourceRefs: [{ id: 'ref', sourceArtifactId: projectId, sourceArtifactVersionId: 'spine-1', sourceType: 'spine' }],
});

const prd = (features: StructuredPRD['features']): StructuredPRD => ({
    vision: 'Plan safely.', coreProblem: 'Uncertain scope.', targetUsers: ['Creators'], architecture: 'Local-only.', risks: [], features,
});

const feature = (id: string, name: string, description: string) => ({
    id, name, description, userValue: description, complexity: 'medium' as const,
});

const spine = (id: string, structuredPRD: StructuredPRD, isLatest: boolean): SpineVersion => ({
    id, projectId, promptText: 'Plan', responseText: JSON.stringify(structuredPRD), structuredPRD,
    createdAt: isLatest ? 2 : 1, isLatest, isFinal: isLatest,
});

function derive(before: StructuredPRD, after: StructuredPRD, version = artifactVersion()) {
    return deriveDownstreamUpdatePlans({
        projectId, artifacts: [planArtifact], artifactVersions: [version],
        spineVersions: [spine('spine-1', before, false), spine('spine-2', after, true)],
        planningRecords: [], createdAt: 10,
    })[0];
}

const directEvidence = [{
    id: 'trace', kind: 'structured_trace' as const, quality: 'direct' as const, summary: 'Explicit feature trace.',
}];

function boundPlan(version: ArtifactVersion, item: DownstreamUpdatePlanItem): DownstreamUpdatePlan {
    return sealDownstreamUpdatePlan({
        schemaVersion: 1, id: `plan-${item.id}`, projectId, authoredBy: 'synapse', createdAt: 10,
        source: {
            kind: 'planning_change', summary: 'Confirmed planning change.', sourceSpineVersionId: 'spine-1',
            targetSpineVersionId: 'spine-2', targetSpineContentHash: 'spine-hash', planningContextHash: 'context', confirmed: true,
        },
        artifact: {
            artifactId: planArtifact.id, artifactVersionId: version.id, artifactContentHash: hashReviewValue(version.content),
            slot: 'implementation_plan', title: planArtifact.title,
        },
        items: [item], preservedArtifactSummary: 'Everything outside the exact entry remains unchanged.',
    });
}

function acceptedReview(plan: DownstreamUpdatePlan, proposal: Extract<ReturnType<typeof deriveImplementationPlanArtifactUpdateProposal>, { ok: true }>['proposal']) {
    return sealDownstreamArtifactUpdateReviewEvent({
        schemaVersion: 1, id: `review-${proposal.id}`, projectId, proposalId: proposal.id, actor: 'user', at: 30,
        expectedProposalIntegrityHash: proposal.integrityHash, expectedPlanIntegrityHash: plan.integrityHash,
        expectedItemIntegrityHash: proposal.updatePlanBinding.itemIntegrityHash,
        expectedRegionContentHash: proposal.currentRegionContentHash, action: 'accepted',
    });
}

describe('bounded implementation-plan delivery updates', () => {
    it('represents a revised workflow as separate workstream, task, and acceptance-criterion reviews', () => {
        const before = prd([feature('f1', 'Creator workflow', 'Old branch')]);
        const after = prd([feature('f1', 'Creator workflow', 'Validated branch')]);
        const plan = derive(before, after);
        const delivery = plan.items.filter(item => item.region.kind === 'implementation_plan' && item.region.section === 'delivery');
        expect(delivery).toEqual(expect.arrayContaining([
            expect.objectContaining({ region: expect.objectContaining({ aspect: 'workstream', milestoneId: 'workflow' }), certainty: 'likely' }),
            expect.objectContaining({ region: expect.objectContaining({ aspect: 'task', taskId: 'workflow-task' }), certainty: 'likely' }),
            expect.objectContaining({ region: expect.objectContaining({ aspect: 'acceptance_criterion', collection: 'definition_of_done' }), certainty: 'likely' }),
        ]));
        expect(new Set(delivery.map(item => item.id)).size).toBe(delivery.length);
    });

    it('targets an exact migration/API task when its related entity behavior changes', () => {
        const before = prd([feature('f3', 'Membership relationship', 'Team membership')]);
        const after = prd([feature('f3', 'Membership relationship', 'No team membership')]);
        const plan = derive(before, after);
        expect(plan.items).toContainEqual(expect.objectContaining({
            region: expect.objectContaining({
                section: 'delivery', collection: 'tasks', taskId: 'migration-task', aspect: 'technical_prerequisite',
            }),
            certainty: 'likely',
        }));
    });

    it('targets only the dependent milestone prerequisite identified by an explicit trace', () => {
        const tracedPlan: StructuredImplementationPlan = {
            ...basePlan,
            milestones: basePlan.milestones.map(milestone => milestone.id === 'release'
                ? { ...milestone, dependencies: ['Security prerequisite [feature:f2]'] }
                : milestone),
        };
        const before = prd([feature('f2', 'Security prerequisite', 'Required before release')]);
        const after = prd([]);
        const plan = derive(before, after, artifactVersion(tracedPlan));
        const prerequisiteItems = plan.items.filter(item => item.region.kind === 'implementation_plan'
            && item.region.section === 'delivery' && item.region.collection === 'dependencies');
        expect(prerequisiteItems).toEqual([expect.objectContaining({
            region: expect.objectContaining({ milestoneId: 'release', entryIndex: 0 }), certainty: 'definite',
        })]);
        expect(plan.items.some(item => item.region.kind === 'implementation_plan'
            && item.region.section === 'delivery' && item.region.milestoneId === 'workflow'
            && item.region.collection === 'dependencies')).toBe(false);
    });

    it('adds a security prerequisite only from explicit structured user context', () => {
        const version = artifactVersion();
        const item: DownstreamUpdatePlanItem = {
            id: 'security-prerequisite',
            region: {
                kind: 'implementation_plan', section: 'delivery', aspect: 'milestone', collection: 'milestones',
                milestoneId: 'workflow', entryIndex: 0, entryLabel: basePlan.milestones[0].name, label: basePlan.milestones[0].name,
            },
            currentInterpretation: basePlan.milestones[0].name, whyAffected: 'Security constraint changed.', certainty: 'possible',
            evidence: [{ id: 'inferred', kind: 'plan_diff', quality: 'incomplete', summary: 'Review only.' }],
            recommendedAction: 'review_implementation_plan', recommendation: 'Review.', preservedScope: ['Release milestone'],
            recommendedPriority: 1, implementationCritical: false,
        };
        const plan = boundPlan(version, item);
        const initial = deriveImplementationPlanArtifactUpdateProposal({ projectId, plan, item, artifactVersion: version, createdAt: 20 });
        expect(initial.ok && initial.proposal.operation).toBe('review_only');
        const context = 'add: {"collection":"dependencies","value":"security-review"}';
        const change = parseUserGroundedImplementationPlanChange(context);
        const derived = deriveImplementationPlanArtifactUpdateProposal({
            projectId, plan, item, artifactVersion: version, userGroundedChange: change, createdAt: 21,
        });
        expect(derived.ok).toBe(true);
        if (!derived.ok) return;
        expect(derived.proposal).toMatchObject({ operation: 'add', resultingRegion: { collection: 'dependencies', entryLabel: 'security-review' } });
        const applied = applyImplementationPlanArtifactUpdate({ proposal: derived.proposal, review: acceptedReview(plan, derived.proposal), artifactVersion: version });
        expect(applied.ok).toBe(true);
        if (!applied.ok) return;
        expect(extractStructuredPlan(applied.content)?.milestones[0].dependencies).toEqual(['security-review']);
        expect(extractStructuredPlan(applied.content)?.milestones[1]).toEqual(basePlan.milestones[1]);
        expect(applied.content.split('```json synapse-plan')[0]).toBe(version.content.split('```json synapse-plan')[0]);
        expect(applied.content.split('```').at(-1)).toBe(version.content.split('```').at(-1));
    });

    it('removes one direct leaf entry while preserving unrelated structured entries and outside markdown', () => {
        const version = artifactVersion();
        const item: DownstreamUpdatePlanItem = {
            id: 'remove-migration',
            region: {
                kind: 'implementation_plan', section: 'delivery', aspect: 'technical_prerequisite', collection: 'tasks',
                milestoneId: 'workflow', taskId: 'migration-task', entryIndex: 1,
                entryLabel: basePlan.milestones[0].tasks[1].title, label: basePlan.milestones[0].tasks[1].title,
            },
            currentInterpretation: basePlan.milestones[0].tasks[1].title, whyAffected: 'Membership was removed.', certainty: 'definite',
            evidence: directEvidence, recommendedAction: 'review_implementation_plan', recommendation: 'Remove exact task.',
            preservedScope: ['Workflow task', 'Release milestone'], recommendedPriority: 1, implementationCritical: true,
        };
        const plan = boundPlan(version, item);
        const derived = deriveImplementationPlanArtifactUpdateProposal({ projectId, plan, item, artifactVersion: version, createdAt: 20 });
        // Release still depends on this task, so even a direct trace cannot manufacture a safe removal.
        expect(derived.ok && derived.proposal.operation).toBe('review_only');
        const safePlan = { ...basePlan, milestones: basePlan.milestones.map(milestone => ({
            ...milestone,
            tasks: milestone.tasks.map(task => task.id === 'release-task' ? { ...task, dependencies: [] } : task),
        })) };
        const safeVersion = artifactVersion(safePlan);
        const safeBound = boundPlan(safeVersion, item);
        const safe = deriveImplementationPlanArtifactUpdateProposal({ projectId, plan: safeBound, item, artifactVersion: safeVersion, createdAt: 21 });
        expect(safe.ok && safe.proposal.operation).toBe('remove');
        if (!safe.ok) return;
        const applied = applyImplementationPlanArtifactUpdate({ proposal: safe.proposal, review: acceptedReview(safeBound, safe.proposal), artifactVersion: safeVersion });
        expect(applied.ok).toBe(true);
        if (!applied.ok) return;
        const after = extractStructuredPlan(applied.content)!;
        expect(after.milestones[0].tasks.map(task => task.id)).toEqual(['workflow-task']);
        expect(after.milestones[1]).toEqual(safePlan.milestones[1]);
        expect(after.risks).toEqual(safePlan.risks);
        expect(applied.content.split('```json synapse-plan')[0]).toBe(safeVersion.content.split('```json synapse-plan')[0]);
    });

    it('replaces one exact task only from explicit structured user context', () => {
        const version = artifactVersion();
        const original = basePlan.milestones[0].tasks[0];
        const item: DownstreamUpdatePlanItem = {
            id: 'replace-workflow-task',
            region: {
                kind: 'implementation_plan', section: 'delivery', aspect: 'task', collection: 'tasks',
                milestoneId: 'workflow', taskId: original.id, entryIndex: 0, entryLabel: original.title, label: original.title,
            },
            currentInterpretation: original.title, whyAffected: 'Workflow changed.', certainty: 'likely', evidence: directEvidence,
            recommendedAction: 'review_implementation_plan', recommendation: 'Revise exact task.', preservedScope: ['Migration task', 'Release'],
            recommendedPriority: 1, implementationCritical: false,
        };
        const plan = boundPlan(version, item);
        const replacement = {
            id: original.id, title: 'Implement validated creator workflow', description: 'Only the validated branch.', status: 'todo' as const,
        };
        expect(parseUserGroundedImplementationPlanChange(`replace: ${JSON.stringify({ value: replacement })}`)).toEqual({
            operation: 'replace', value: replacement,
        });
        const derived = deriveImplementationPlanArtifactUpdateProposal({
            projectId, plan, item, artifactVersion: version,
            userGroundedChange: { operation: 'replace', value: replacement }, createdAt: 20,
        });
        expect(derived.ok && derived.proposal.operation).toBe('replace');
        if (!derived.ok) return;
        const applied = applyImplementationPlanArtifactUpdate({ proposal: derived.proposal, review: acceptedReview(plan, derived.proposal), artifactVersion: version });
        expect(applied.ok).toBe(true);
        if (!applied.ok) return;
        const after = extractStructuredPlan(applied.content)!;
        expect(after.milestones[0].tasks[0]).toEqual(replacement);
        expect(after.milestones[0].tasks[1]).toEqual(basePlan.milestones[0].tasks[1]);
        expect(after.milestones[1]).toEqual(basePlan.milestones[1]);
    });

    it('uses one conservative review item for legacy markdown and never fabricates task precision', () => {
        const legacy = { ...artifactVersion(), content: '# Implementation Plan\n\n- Build the workflow.' };
        const plan = derive(prd([feature('f1', 'Creator workflow', 'Old')]), prd([]), legacy);
        expect(plan.items).toEqual([expect.objectContaining({
            region: { kind: 'artifact_review', reason: 'unstructured_content', label: 'Implementation Plan' },
            certainty: 'possible', recommendedAction: 'review_only',
        })]);
    });
});
