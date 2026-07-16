import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { ProjectState } from '../types';
import {
    buildDownstreamUpdatePlanCurrentContext,
    compareDownstreamUpdatePlanCurrentness,
    deriveDownstreamUpdatePlanSummary,
    sealDownstreamUpdatePlanEvent,
    validateDownstreamUpdatePlanIntegrity,
    type DownstreamUpdatePlanCurrentContext,
} from '../../lib/planning/downstreamUpdatePlan';
import { deriveDownstreamUpdatePlans } from '../../lib/planning/downstreamUpdatePlanGeneration';
import {
    compareDownstreamArtifactUpdateProposalCurrentness,
    downstreamArtifactUpdateResultRegion,
    downstreamUpdatePlanItemIntegrityHash,
    downstreamArtifactUpdateReviewOperationCompatible,
    effectiveDownstreamArtifactUpdate,
    latestDownstreamArtifactUpdateReview,
    resolveDownstreamUpdateRegionContent,
    sealDownstreamArtifactUpdateApplication,
    sealDownstreamArtifactUpdateReviewEvent,
    sealDownstreamArtifactUpdateVerificationEvent,
    validateDownstreamArtifactUpdateApplicationIntegrity,
    validateDownstreamArtifactUpdateProposalIntegrity,
    validateDownstreamArtifactUpdateReviewEventIntegrity,
    validateDownstreamArtifactUpdateVerificationIntegrity,
    validateDownstreamArtifactUpdateVerificationEventIntegrity,
} from '../../lib/planning/downstreamArtifactUpdateProposal';
import { hashReviewValue } from '../../lib/review/hash';
import {
    applyScreenFlowArtifactUpdate,
    deriveScreenFlowArtifactUpdateProposal,
    removedDownstreamUpdateRegionHash,
} from '../../lib/planning/screenFlowArtifactUpdates';
import {
    applyDataModelArtifactUpdate,
    deriveDataModelArtifactUpdateProposal,
    parseUserGroundedDataModelChange,
} from '../../lib/planning/dataModelArtifactUpdates';
import {
    applyImplementationPlanArtifactUpdate,
    deriveImplementationPlanArtifactUpdateProposal,
    parseUserGroundedImplementationPlanChange,
    parseUserGroundedImplementationPlanReplacement,
} from '../../lib/planning/implementationPlanArtifactUpdates';
import type { ArtifactVersion, HistoryEvent } from '../../types';
import {
    deriveVerifiedDownstreamUpdatePlanSummary,
    deriveDownstreamArtifactUpdateVerification,
    projectDownstreamArtifactUpdateVerifications,
    verificationIsCurrent,
} from '../../lib/planning/downstreamArtifactUpdateVerification';

export type DownstreamUpdatePlanSlice = Pick<ProjectState,
    | 'downstreamUpdatePlans'
    | 'downstreamUpdatePlanEvents'
    | 'recordDownstreamUpdatePlan'
    | 'generateDownstreamUpdatePlans'
    | 'appendDownstreamUpdatePlanEvent'
    | 'getDownstreamUpdatePlanCurrentness'
    | 'getDownstreamUpdatePlanSummary'
    | 'downstreamArtifactUpdateProposals'
    | 'downstreamArtifactUpdateReviewEvents'
    | 'downstreamArtifactUpdateApplications'
    | 'downstreamArtifactUpdateVerifications'
    | 'downstreamArtifactUpdateVerificationEvents'
    | 'recordDownstreamArtifactUpdateProposal'
    | 'generateDownstreamArtifactUpdateProposal'
    | 'appendDownstreamArtifactUpdateReviewEvent'
    | 'recordDownstreamArtifactUpdateApplication'
    | 'applyDownstreamArtifactUpdateProposal'
    | 'recordDownstreamArtifactUpdateVerification'
    | 'verifyDownstreamArtifactUpdateItem'
    | 'appendDownstreamArtifactUpdateVerificationEvent'
    | 'getDownstreamArtifactUpdateProposalCurrentness'
>;

function currentContext(state: ProjectState, projectId: string): DownstreamUpdatePlanCurrentContext | undefined {
    return buildDownstreamUpdatePlanCurrentContext({
        spineVersions: state.spineVersions[projectId] ?? [],
        planningRecords: state.planningRecords[projectId] ?? [],
        artifacts: state.artifacts[projectId] ?? [],
        artifactVersions: state.artifactVersions[projectId] ?? [],
    });
}

const rationaleRequired = (disposition: string): boolean =>
    disposition === 'deferred' || disposition === 'not_applicable' || disposition === 'already_aligned';

export const createDownstreamUpdatePlanSlice: StateCreator<ProjectState, [], [], DownstreamUpdatePlanSlice> = (set, get) => ({
    downstreamUpdatePlans: {},
    downstreamUpdatePlanEvents: {},
    downstreamArtifactUpdateProposals: {},
    downstreamArtifactUpdateReviewEvents: {},
    downstreamArtifactUpdateApplications: {},
    downstreamArtifactUpdateVerifications: {},
    downstreamArtifactUpdateVerificationEvents: {},

    recordDownstreamUpdatePlan: (projectId, plan) => {
        if (plan.projectId !== projectId || !validateDownstreamUpdatePlanIntegrity(plan)) {
            return { ok: false, reason: 'invalid_plan' };
        }
        const context = currentContext(get(), projectId);
        if (!context || !compareDownstreamUpdatePlanCurrentness(plan, context).current) {
            return { ok: false, reason: 'stale' };
        }
        const existing = get().downstreamUpdatePlans[projectId] ?? [];
        const duplicate = existing.some(candidate => candidate.id === plan.id || candidate.integrityHash === plan.integrityHash);
        if (duplicate) return { ok: true, duplicate: true };
        set(state => ({
            downstreamUpdatePlans: {
                ...state.downstreamUpdatePlans,
                [projectId]: [...(state.downstreamUpdatePlans[projectId] ?? []), plan],
            },
        }));
        return { ok: true, duplicate: false };
    },

    generateDownstreamUpdatePlans: (projectId) => {
        const state = get();
        if (!state.projects[projectId]) return { status: 'rejected', reason: 'project_not_found' };
        const plans = deriveDownstreamUpdatePlans({
            projectId,
            artifacts: state.artifacts[projectId] ?? [],
            artifactVersions: state.artifactVersions[projectId] ?? [],
            spineVersions: state.spineVersions[projectId] ?? [],
            planningRecords: state.planningRecords[projectId] ?? [],
        });
        const existing = state.downstreamUpdatePlans[projectId] ?? [];
        const additions = plans.filter(plan => !existing.some(candidate => (
            candidate.id === plan.id || candidate.integrityHash === plan.integrityHash
        )));
        if (additions.length > 0) {
            set(current => ({
                downstreamUpdatePlans: {
                    ...current.downstreamUpdatePlans,
                    [projectId]: [...(current.downstreamUpdatePlans[projectId] ?? []), ...additions],
                },
            }));
        }
        return { status: 'generated', planIds: plans.map(plan => plan.id), created: additions.length };
    },

    appendDownstreamUpdatePlanEvent: (projectId, planId, itemId, input) => {
        const plan = (get().downstreamUpdatePlans[projectId] ?? []).find(candidate => candidate.id === planId);
        if (!plan || !validateDownstreamUpdatePlanIntegrity(plan)) return { ok: false, reason: 'plan_not_found' };
        if (!plan.items.some(item => item.id === itemId)) return { ok: false, reason: 'item_not_found' };
        const context = currentContext(get(), projectId);
        if (!context || !compareDownstreamUpdatePlanCurrentness(plan, context).current) return { ok: false, reason: 'stale' };
        if (input.type === 'priority_changed' && (!Number.isInteger(input.priority) || input.priority < 1)) {
            return { ok: false, reason: 'invalid_priority' };
        }
        if (input.type === 'disposition_recorded'
            && rationaleRequired(input.disposition)
            && (!input.rationale || input.rationale.trim().length < 3)) {
            return { ok: false, reason: 'rationale_required' };
        }
        const events = get().downstreamUpdatePlanEvents[projectId] ?? [];
        const at = Math.max(input.at ?? Date.now(), (events.at(-1)?.at ?? 0) + 1);
        const event = sealDownstreamUpdatePlanEvent({
            schemaVersion: 1,
            id: uuidv4(), projectId, planId, itemId, actor: 'user', at,
            expectedPlanIntegrityHash: plan.integrityHash,
            ...(input.type === 'priority_changed'
                ? { type: input.type, priority: input.priority }
                : { type: input.type, disposition: input.disposition, ...(input.rationale ? { rationale: input.rationale.trim() } : {}) }),
        });
        const duplicate = events.some(candidate => candidate.integrityHash === event.integrityHash);
        if (duplicate) return { ok: true, eventId: event.id, duplicate: true };
        set(state => ({
            downstreamUpdatePlanEvents: {
                ...state.downstreamUpdatePlanEvents,
                [projectId]: [...(state.downstreamUpdatePlanEvents[projectId] ?? []), event],
            },
        }));
        return { ok: true, eventId: event.id, duplicate: false };
    },

    getDownstreamUpdatePlanCurrentness: (projectId, planId) => {
        const plan = (get().downstreamUpdatePlans[projectId] ?? []).find(candidate => candidate.id === planId);
        const context = currentContext(get(), projectId);
        return plan && context ? compareDownstreamUpdatePlanCurrentness(plan, context) : undefined;
    },

    getDownstreamUpdatePlanSummary: (projectId) => {
        const state = get();
        const context = currentContext(state, projectId);
        const plans = state.downstreamUpdatePlans[projectId] ?? [];
        const events = state.downstreamUpdatePlanEvents[projectId] ?? [];
        const base = deriveDownstreamUpdatePlanSummary({ plans, events, context });
        const projections = projectDownstreamArtifactUpdateVerifications({
            plans,
            context,
            artifacts: state.artifacts[projectId] ?? [],
            artifactVersions: state.artifactVersions[projectId] ?? [],
            verifications: state.downstreamArtifactUpdateVerifications[projectId] ?? [],
            verificationEvents: state.downstreamArtifactUpdateVerificationEvents[projectId] ?? [],
            proposals: state.downstreamArtifactUpdateProposals[projectId] ?? [],
            applications: state.downstreamArtifactUpdateApplications[projectId] ?? [],
            reviewEvents: state.downstreamArtifactUpdateReviewEvents[projectId] ?? [],
        });
        return deriveVerifiedDownstreamUpdatePlanSummary({ base, plans, events, context, projections });
    },

    recordDownstreamArtifactUpdateProposal: (projectId, proposal) => {
        if (proposal.projectId !== projectId || !validateDownstreamArtifactUpdateProposalIntegrity(proposal)) {
            return { ok: false, reason: 'invalid_proposal' };
        }
        const state = get();
        const plan = (state.downstreamUpdatePlans[projectId] ?? []).find(candidate => candidate.id === proposal.updatePlanBinding.planId);
        const context = currentContext(state, projectId);
        const artifactVersion = (state.artifactVersions[projectId] ?? []).find(candidate => candidate.id === proposal.artifact.artifactVersionId);
        if (!context || !compareDownstreamArtifactUpdateProposalCurrentness({ proposal, plan, planContext: context, artifactVersion }).current) {
            return { ok: false, reason: 'stale' };
        }
        const existing = state.downstreamArtifactUpdateProposals[projectId] ?? [];
        const duplicate = existing.some(candidate => candidate.id === proposal.id || candidate.integrityHash === proposal.integrityHash);
        if (duplicate) return { ok: true, duplicate: true };
        set(current => ({
            downstreamArtifactUpdateProposals: {
                ...current.downstreamArtifactUpdateProposals,
                [projectId]: [...(current.downstreamArtifactUpdateProposals[projectId] ?? []), proposal],
            },
        }));
        return { ok: true, duplicate: false };
    },

    generateDownstreamArtifactUpdateProposal: (projectId, planId, itemId) => {
        const state = get();
        const plan = (state.downstreamUpdatePlans[projectId] ?? []).find(candidate => candidate.id === planId);
        const item = plan?.items.find(candidate => candidate.id === itemId);
        const artifactVersion = plan
            ? (state.artifactVersions[projectId] ?? []).find(candidate => candidate.id === plan.artifact.artifactVersionId)
            : undefined;
        const context = currentContext(state, projectId);
        if (!plan || !item || !artifactVersion || !context) return { status: 'rejected', reason: 'binding_not_found' };
        if (!compareDownstreamUpdatePlanCurrentness(plan, context).current) return { status: 'rejected', reason: 'stale' };
        const prior = (state.downstreamArtifactUpdateProposals[projectId] ?? [])
            .filter(candidate => candidate.updatePlanBinding.planId === planId
                && candidate.updatePlanBinding.itemId === itemId)
            .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
        const latestProposal = prior[0];
        const latestReview = latestProposal
            ? latestDownstreamArtifactUpdateReview(latestProposal, state.downstreamArtifactUpdateReviewEvents[projectId] ?? [])
            : undefined;
        if (latestProposal && latestReview?.action !== 'requested_another' && latestReview?.action !== 'provided_context') {
            return { status: 'generated', proposalId: latestProposal.id, operation: latestProposal.operation };
        }
        const requestNonce = latestReview ? `${latestReview.id}:${latestReview.integrityHash}` : 'initial';
        const result = plan.artifact.slot === 'data_model'
            ? deriveDataModelArtifactUpdateProposal({
                projectId, plan, item, artifactVersion, requestNonce,
                userContextProvided: latestReview?.action === 'provided_context',
                ...(latestReview?.action === 'provided_context'
                    ? { userGroundedChange: parseUserGroundedDataModelChange(latestReview.context) }
                    : {}),
                dependencyDocuments: [
                    ...(state.artifacts[projectId] ?? []).flatMap(candidate => {
                        if (candidate.id === plan.artifact.artifactId || candidate.type !== 'core_artifact') return [];
                        const current = (state.artifactVersions[projectId] ?? []).find(version => version.id === candidate.currentVersionId);
                        return current ? [{
                            id: candidate.id, label: candidate.title,
                            kind: candidate.subtype === 'user_flows' ? 'flow' as const : 'requirement' as const,
                            content: current.content,
                        }] : [];
                    }),
                    ...(state.spineVersions[projectId] ?? []).filter(candidate => candidate.id === context.spineVersionId).map(candidate => ({
                        id: candidate.id, label: 'Current product requirements', kind: 'requirement' as const,
                        content: candidate.responseText,
                    })),
                ],
            })
            : plan.artifact.slot === 'implementation_plan'
                ? deriveImplementationPlanArtifactUpdateProposal({
                    projectId, plan, item, artifactVersion, requestNonce,
                    ...(latestReview?.action === 'provided_context'
                        ? item.region.kind === 'implementation_plan' && item.region.section === 'delivery'
                            ? { userGroundedChange: parseUserGroundedImplementationPlanChange(latestReview.context) }
                            : { userGroundedReplacement: parseUserGroundedImplementationPlanReplacement(latestReview.context) }
                        : {}),
                })
                : deriveScreenFlowArtifactUpdateProposal({
                projectId, plan, item, artifactVersion, requestNonce,
            });
        if (!result.ok) return { status: 'rejected', reason: result.reason };
        if (!validateDownstreamArtifactUpdateProposalIntegrity(result.proposal)) {
            return { status: 'rejected', reason: 'invalid_proposal' };
        }
        set(current => ({
            downstreamArtifactUpdateProposals: {
                ...current.downstreamArtifactUpdateProposals,
                [projectId]: [...(current.downstreamArtifactUpdateProposals[projectId] ?? []), result.proposal],
            },
        }));
        return { status: 'generated', proposalId: result.proposal.id, operation: result.proposal.operation };
    },

    appendDownstreamArtifactUpdateReviewEvent: (projectId, proposalId, input) => {
        const state = get();
        const proposal = (state.downstreamArtifactUpdateProposals[projectId] ?? []).find(candidate => candidate.id === proposalId);
        if (!proposal || !validateDownstreamArtifactUpdateProposalIntegrity(proposal)) return { ok: false, reason: 'proposal_not_found' };
        if (proposal.operation === 'review_only' && (input.action === 'accepted' || input.action === 'edited')) {
            return { ok: false, reason: 'no_bounded_proposal' };
        }
        if (input.action === 'edited'
            && !downstreamArtifactUpdateReviewOperationCompatible(proposal.operation, input.operation)) {
            return { ok: false, reason: 'operation_escalation' };
        }
        const plan = (state.downstreamUpdatePlans[projectId] ?? []).find(candidate => candidate.id === proposal.updatePlanBinding.planId);
        const context = currentContext(state, projectId);
        const artifactVersion = (state.artifactVersions[projectId] ?? []).find(candidate => candidate.id === proposal.artifact.artifactVersionId);
        if (!context || !compareDownstreamArtifactUpdateProposalCurrentness({ proposal, plan, planContext: context, artifactVersion }).current) {
            return { ok: false, reason: 'stale' };
        }
        const events = state.downstreamArtifactUpdateReviewEvents[projectId] ?? [];
        const at = Math.max(input.at ?? Date.now(), (events.at(-1)?.at ?? 0) + 1);
        const base = {
            schemaVersion: 1 as const, id: uuidv4(), projectId, proposalId, actor: 'user' as const, at,
            expectedProposalIntegrityHash: proposal.integrityHash,
            expectedPlanIntegrityHash: proposal.updatePlanBinding.planIntegrityHash,
            expectedItemIntegrityHash: proposal.updatePlanBinding.itemIntegrityHash,
            expectedRegionContentHash: proposal.currentRegionContentHash,
        };
        const { at: _at, ...payload } = input;
        void _at;
        const event = sealDownstreamArtifactUpdateReviewEvent({ ...base, ...payload } as Parameters<typeof sealDownstreamArtifactUpdateReviewEvent>[0]);
        if (!validateDownstreamArtifactUpdateReviewEventIntegrity(event)) return { ok: false, reason: 'invalid_review' };
        const duplicate = events.some(candidate => candidate.integrityHash === event.integrityHash);
        if (duplicate) return { ok: true, eventId: event.id, duplicate: true };
        set(current => ({
            downstreamArtifactUpdateReviewEvents: {
                ...current.downstreamArtifactUpdateReviewEvents,
                [projectId]: [...(current.downstreamArtifactUpdateReviewEvents[projectId] ?? []), event],
            },
        }));
        return { ok: true, eventId: event.id, duplicate: false };
    },

    recordDownstreamArtifactUpdateApplication: (projectId, application) => {
        if (application.projectId !== projectId || !validateDownstreamArtifactUpdateApplicationIntegrity(application)) {
            return { ok: false, reason: 'invalid_application' };
        }
        const state = get();
        const applications = state.downstreamArtifactUpdateApplications[projectId] ?? [];
        if (applications.some(candidate => candidate.id === application.id || candidate.integrityHash === application.integrityHash)) {
            return { ok: true, duplicate: true };
        }
        const proposal = (state.downstreamArtifactUpdateProposals[projectId] ?? []).find(candidate => candidate.id === application.proposalId);
        if (!proposal || !validateDownstreamArtifactUpdateProposalIntegrity(proposal)
            || proposal.integrityHash !== application.proposalIntegrityHash) return { ok: false, reason: 'proposal_not_found' };
        const plan = (state.downstreamUpdatePlans[projectId] ?? []).find(candidate => candidate.id === proposal.updatePlanBinding.planId);
        const item = plan?.items.find(candidate => candidate.id === proposal.updatePlanBinding.itemId);
        if (!plan || !validateDownstreamUpdatePlanIntegrity(plan)
            || plan.integrityHash !== proposal.updatePlanBinding.planIntegrityHash
            || !item || downstreamUpdatePlanItemIntegrityHash(plan, item) !== proposal.updatePlanBinding.itemIntegrityHash
            || hashReviewValue(plan.source) !== hashReviewValue(proposal.source)
            || hashReviewValue(plan.artifact) !== hashReviewValue(proposal.artifact)) return { ok: false, reason: 'plan_binding_mismatch' };
        const reviewEvents = state.downstreamArtifactUpdateReviewEvents[projectId] ?? [];
        const review = reviewEvents.find(candidate => candidate.id === application.authorizedByReviewEventId);
        const latestReview = latestDownstreamArtifactUpdateReview(proposal, reviewEvents);
        if (!review || latestReview?.id !== review.id || !validateDownstreamArtifactUpdateReviewEventIntegrity(review)
            || review.integrityHash !== application.authorizedByReviewEventIntegrityHash) return { ok: false, reason: 'authorization_not_current' };
        if (applications.some(candidate => candidate.authorizedByReviewEventId === review.id)) return { ok: false, reason: 'authorization_consumed' };
        const effective = effectiveDownstreamArtifactUpdate(proposal, review);
        if (!effective || effective.operation !== application.effectiveOperation || effective.contentHash !== application.effectiveContentHash) {
            return { ok: false, reason: 'effective_change_mismatch' };
        }
        if (application.expectedArtifactVersionId !== proposal.artifact.artifactVersionId
            || application.expectedArtifactContentHash !== proposal.artifact.artifactContentHash
            || application.expectedRegionContentHash !== proposal.currentRegionContentHash) return { ok: false, reason: 'expected_state_mismatch' };
        const artifact = (state.artifacts[projectId] ?? []).find(candidate => candidate.id === proposal.artifact.artifactId);
        const result = (state.artifactVersions[projectId] ?? []).find(candidate => candidate.id === application.resultingArtifactVersionId);
        if (!artifact || artifact.currentVersionId !== application.resultingArtifactVersionId || !result
            || result.artifactId !== artifact.id || result.parentVersionId !== proposal.artifact.artifactVersionId
            || hashReviewValue(result.content) !== application.resultingArtifactContentHash) return { ok: false, reason: 'concurrent_artifact_change' };
        const resultRegion = resolveDownstreamUpdateRegionContent(result, downstreamArtifactUpdateResultRegion(proposal));
        // Legacy Stage 1 callers could record a semantically described remove
        // whose resulting region still existed. Keep those histories readable,
        // while the guarded Stage 2 executor records a true absent-region
        // sentinel for structural removals.
        const resultMatches = resultRegion.found
            ? resultRegion.contentHash === application.resultingRegionContentHash
            : application.effectiveOperation === 'remove'
                && application.resultingRegionContentHash === removedDownstreamUpdateRegionHash(proposal.region);
        if (!resultMatches) return { ok: false, reason: 'result_region_mismatch' };
        const context = currentContext(state, projectId);
        if (!context || context.spineVersionId !== proposal.source.targetSpineVersionId
            || context.spineContentHash !== proposal.source.targetSpineContentHash
            || context.planningContextHash !== proposal.source.planningContextHash) return { ok: false, reason: 'source_stale' };
        set(current => ({
            downstreamArtifactUpdateApplications: {
                ...current.downstreamArtifactUpdateApplications,
                [projectId]: [...(current.downstreamArtifactUpdateApplications[projectId] ?? []), application],
            },
        }));
        return { ok: true, duplicate: false };
    },

    applyDownstreamArtifactUpdateProposal: (projectId, proposalId) => {
        let outcome: ReturnType<ProjectState['applyDownstreamArtifactUpdateProposal']> = {
            status: 'rejected', reason: 'application_failed',
        };
        set(state => {
            const proposal = (state.downstreamArtifactUpdateProposals[projectId] ?? [])
                .find(candidate => candidate.id === proposalId);
            if (!proposal || !validateDownstreamArtifactUpdateProposalIntegrity(proposal)) {
                outcome = { status: 'rejected', reason: 'proposal_not_found' };
                return state;
            }
            const plan = (state.downstreamUpdatePlans[projectId] ?? [])
                .find(candidate => candidate.id === proposal.updatePlanBinding.planId);
            const context = currentContext(state, projectId);
            const artifactVersion = (state.artifactVersions[projectId] ?? [])
                .find(candidate => candidate.id === proposal.artifact.artifactVersionId);
            if (!context || !artifactVersion || !compareDownstreamArtifactUpdateProposalCurrentness({
                proposal, plan, planContext: context, artifactVersion,
            }).current) {
                outcome = { status: 'rejected', reason: 'stale' };
                return state;
            }
            const artifact = (state.artifacts[projectId] ?? []).find(candidate => candidate.id === proposal.artifact.artifactId);
            if (!artifact || artifact.currentVersionId !== artifactVersion.id) {
                outcome = { status: 'rejected', reason: 'concurrent_artifact_change' };
                return state;
            }
            const reviewEvents = state.downstreamArtifactUpdateReviewEvents[projectId] ?? [];
            const review = latestDownstreamArtifactUpdateReview(proposal, reviewEvents);
            if (!review || (review.action !== 'accepted' && review.action !== 'edited')) {
                outcome = { status: 'rejected', reason: 'approval_required' };
                return state;
            }
            if ((state.downstreamArtifactUpdateApplications[projectId] ?? [])
                .some(candidate => candidate.authorizedByReviewEventId === review.id)) {
                outcome = { status: 'rejected', reason: 'authorization_consumed' };
                return state;
            }
            const applied = proposal.artifact.slot === 'data_model'
                ? applyDataModelArtifactUpdate({ proposal, review, artifactVersion })
                : proposal.artifact.slot === 'implementation_plan'
                    ? applyImplementationPlanArtifactUpdate({ proposal, review, artifactVersion })
                    : applyScreenFlowArtifactUpdate({ proposal, review, artifactVersion });
            if (!applied.ok) {
                outcome = { status: 'rejected', reason: applied.reason };
                return state;
            }
            const effective = effectiveDownstreamArtifactUpdate(proposal, review);
            if (!effective) {
                outcome = { status: 'rejected', reason: 'approval_required' };
                return state;
            }
            const now = Date.now();
            const versionId = uuidv4();
            const applicationId = uuidv4();
            const versions = state.artifactVersions[projectId] ?? [];
            const versionNumber = versions.filter(candidate => candidate.artifactId === artifact.id).length + 1;
            const resultVersion: ArtifactVersion = {
                id: versionId,
                artifactId: artifact.id,
                versionNumber,
                parentVersionId: artifactVersion.id,
                content: applied.content,
                metadata: artifactVersion.metadata,
                sourceRefs: artifactVersion.sourceRefs,
                generationPrompt: artifactVersion.generationPrompt,
                isPreferred: true,
                createdAt: now,
                provenance: {
                    changeSource: 'user_edit',
                    editSummary: `Applied an approved selective update to ${artifact.title}`,
                },
            };
            const application = sealDownstreamArtifactUpdateApplication({
                schemaVersion: 1,
                id: applicationId,
                projectId,
                proposalId: proposal.id,
                proposalIntegrityHash: proposal.integrityHash,
                authorizedByReviewEventId: review.id,
                authorizedByReviewEventIntegrityHash: review.integrityHash,
                actor: 'system',
                initiatedBy: 'user',
                effectiveOperation: effective.operation,
                effectiveContentHash: effective.contentHash,
                expectedArtifactVersionId: artifactVersion.id,
                expectedArtifactContentHash: proposal.artifact.artifactContentHash,
                expectedRegionContentHash: proposal.currentRegionContentHash,
                resultingArtifactVersionId: versionId,
                resultingArtifactContentHash: hashReviewValue(applied.content),
                resultingRegionContentHash: applied.resultingRegionContentHash,
                appliedAt: now,
            });
            if (!validateDownstreamArtifactUpdateApplicationIntegrity(application)) {
                outcome = { status: 'rejected', reason: 'invalid_application' };
                return state;
            }
            const history: HistoryEvent = {
                id: uuidv4(), projectId, artifactId: artifact.id, artifactVersionId: versionId,
                type: 'Edited',
                description: `${artifact.title} selectively updated from an approved plan proposal`,
                createdAt: now,
            };
            outcome = { status: 'applied', applicationId, artifactVersionId: versionId };
            return {
                artifactVersions: {
                    ...state.artifactVersions,
                    [projectId]: [
                        ...versions.map(candidate => candidate.artifactId === artifact.id
                            ? { ...candidate, isPreferred: false }
                            : candidate),
                        resultVersion,
                    ],
                },
                artifacts: {
                    ...state.artifacts,
                    [projectId]: (state.artifacts[projectId] ?? []).map(candidate => candidate.id === artifact.id
                        ? { ...candidate, currentVersionId: versionId, updatedAt: now }
                        : candidate),
                },
                historyEvents: {
                    ...state.historyEvents,
                    [projectId]: [...(state.historyEvents[projectId] ?? []), history],
                },
                downstreamArtifactUpdateApplications: {
                    ...state.downstreamArtifactUpdateApplications,
                    [projectId]: [...(state.downstreamArtifactUpdateApplications[projectId] ?? []), application],
                },
            };
        });
        return outcome;
    },

    recordDownstreamArtifactUpdateVerification: (projectId, verification) => {
        if (verification.projectId !== projectId || !validateDownstreamArtifactUpdateVerificationIntegrity(verification)) {
            return { ok: false, reason: 'invalid_verification' };
        }
        const state = get();
        const existing = state.downstreamArtifactUpdateVerifications[projectId] ?? [];
        if (existing.some(candidate => candidate.id === verification.id || candidate.integrityHash === verification.integrityHash)) {
            return { ok: true, duplicate: true };
        }
        const proposal = (state.downstreamArtifactUpdateProposals[projectId] ?? []).find(candidate => candidate.id === verification.proposalId);
        const application = (state.downstreamArtifactUpdateApplications[projectId] ?? []).find(candidate => candidate.id === verification.applicationId);
        if (verification.subject) {
            const plan = (state.downstreamUpdatePlans[projectId] ?? []).find(candidate => candidate.id === verification.subject?.planId);
            const context = currentContext(state, projectId);
            const artifact = (state.artifacts[projectId] ?? []).find(candidate => candidate.id === verification.subject?.artifactId);
            const version = artifact
                ? (state.artifactVersions[projectId] ?? []).find(candidate => candidate.id === artifact.currentVersionId)
                : undefined;
            if (!verificationIsCurrent({
                verification, plan, context, currentVersion: version, proposal, application,
                reviewEvents: state.downstreamArtifactUpdateReviewEvents[projectId] ?? [],
            })) {
                return { ok: false, reason: 'stale' };
            }
            if (verification.subject.kind === 'application' && (
                !proposal || !application
                || proposal.integrityHash !== verification.subject.proposalIntegrityHash
                || application.integrityHash !== verification.subject.applicationIntegrityHash
                || application.resultingArtifactVersionId !== version?.id
            )) return { ok: false, reason: 'binding_mismatch' };
            const item = plan?.items.find(candidate => candidate.id === verification.subject?.itemId);
            const baselineVersion = (state.artifactVersions[projectId] ?? [])
                .find(candidate => candidate.id === verification.subject?.baselineArtifactVersionId);
            if (!plan || !item || !context || !version) return { ok: false, reason: 'binding_mismatch' };
            const expected = deriveDownstreamArtifactUpdateVerification({
                projectId,
                plan,
                item,
                context,
                currentVersion: version,
                baselineVersion,
                proposal,
                application: verification.subject.kind === 'application' ? application : undefined,
                createdAt: verification.createdAt,
            });
            if (expected.integrityHash !== verification.integrityHash) {
                return { ok: false, reason: 'invalid_verification' };
            }
            set(current => ({
                downstreamArtifactUpdateVerifications: {
                    ...current.downstreamArtifactUpdateVerifications,
                    [projectId]: [...(current.downstreamArtifactUpdateVerifications[projectId] ?? []), verification],
                },
            }));
            return { ok: true, duplicate: false };
        }
        if (!proposal || proposal.integrityHash !== verification.proposalIntegrityHash
            || !application || !validateDownstreamArtifactUpdateApplicationIntegrity(application)
            || application.integrityHash !== verification.applicationIntegrityHash) return { ok: false, reason: 'binding_mismatch' };
        const artifact = (state.artifacts[projectId] ?? []).find(candidate => candidate.id === proposal.artifact.artifactId);
        const version = (state.artifactVersions[projectId] ?? []).find(candidate => candidate.id === verification.verifiedArtifactVersionId);
        const region = version ? resolveDownstreamUpdateRegionContent(version, downstreamArtifactUpdateResultRegion(proposal)) : { found: false };
        if (!artifact || artifact.currentVersionId !== verification.verifiedArtifactVersionId || !version
            || version.id !== application.resultingArtifactVersionId
            || hashReviewValue(version.content) !== verification.verifiedArtifactContentHash
            || !region.found || region.contentHash !== verification.verifiedRegionContentHash) return { ok: false, reason: 'stale' };
        set(current => ({
            downstreamArtifactUpdateVerifications: {
                ...current.downstreamArtifactUpdateVerifications,
                [projectId]: [...(current.downstreamArtifactUpdateVerifications[projectId] ?? []), verification],
            },
        }));
        return { ok: true, duplicate: false };
    },

    verifyDownstreamArtifactUpdateItem: (projectId, planId, itemId) => {
        const state = get();
        const plan = (state.downstreamUpdatePlans[projectId] ?? []).find(candidate => candidate.id === planId);
        const item = plan?.items.find(candidate => candidate.id === itemId);
        const context = currentContext(state, projectId);
        const artifact = plan
            ? (state.artifacts[projectId] ?? []).find(candidate => candidate.id === plan.artifact.artifactId)
            : undefined;
        const currentVersion = artifact
            ? (state.artifactVersions[projectId] ?? []).find(candidate => candidate.id === artifact.currentVersionId)
            : undefined;
        const baselineVersion = plan
            ? (state.artifactVersions[projectId] ?? []).find(candidate => candidate.id === plan.artifact.artifactVersionId)
            : undefined;
        if (!plan || !validateDownstreamUpdatePlanIntegrity(plan) || !item || !context || !currentVersion) {
            return { status: 'rejected', reason: 'binding_not_found' };
        }
        if (plan.source.targetSpineVersionId !== context.spineVersionId
            || plan.source.targetSpineContentHash !== context.spineContentHash
            || plan.source.planningContextHash !== context.planningContextHash) return { status: 'rejected', reason: 'source_stale' };
        const proposal = (state.downstreamArtifactUpdateProposals[projectId] ?? [])
            .filter(candidate => candidate.updatePlanBinding.planId === planId
                && candidate.updatePlanBinding.itemId === itemId
                && validateDownstreamArtifactUpdateProposalIntegrity(candidate))
            .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0];
        const application = proposal
            ? (state.downstreamArtifactUpdateApplications[projectId] ?? [])
                .filter(candidate => candidate.proposalId === proposal.id
                    && candidate.resultingArtifactVersionId === currentVersion.id
                    && validateDownstreamArtifactUpdateApplicationIntegrity(candidate))
                .sort((a, b) => b.appliedAt - a.appliedAt || b.id.localeCompare(a.id))[0]
            : undefined;
        const verification = deriveDownstreamArtifactUpdateVerification({
            projectId, plan, item, context, currentVersion, baselineVersion, proposal, application,
        });
        const recorded = get().recordDownstreamArtifactUpdateVerification(projectId, verification);
        return recorded.ok
            ? { status: 'verified', verificationId: verification.id, result: verification.result }
            : { status: 'rejected', reason: recorded.reason };
    },

    appendDownstreamArtifactUpdateVerificationEvent: (projectId, verificationId, input) => {
        const state = get();
        const verification = (state.downstreamArtifactUpdateVerifications[projectId] ?? []).find(candidate => candidate.id === verificationId);
        if (!verification || !validateDownstreamArtifactUpdateVerificationIntegrity(verification)) return { ok: false, reason: 'verification_not_found' };
        if (verification.subject) {
            const plan = (state.downstreamUpdatePlans[projectId] ?? []).find(candidate => candidate.id === verification.subject?.planId);
            const context = currentContext(state, projectId);
            const artifact = (state.artifacts[projectId] ?? []).find(candidate => candidate.id === verification.subject?.artifactId);
            const version = artifact
                ? (state.artifactVersions[projectId] ?? []).find(candidate => candidate.id === artifact.currentVersionId)
                : undefined;
            const boundProposal = (state.downstreamArtifactUpdateProposals[projectId] ?? [])
                .find(candidate => candidate.id === verification.subject?.proposalId);
            const boundApplication = (state.downstreamArtifactUpdateApplications[projectId] ?? [])
                .find(candidate => candidate.id === verification.subject?.applicationId);
            if (!verificationIsCurrent({
                verification, plan, context, currentVersion: version,
                proposal: boundProposal, application: boundApplication,
                reviewEvents: state.downstreamArtifactUpdateReviewEvents[projectId] ?? [],
            })) return { ok: false, reason: 'stale' };
        }
        const proposal = (state.downstreamArtifactUpdateProposals[projectId] ?? []).find(candidate => candidate.id === verification.proposalId);
        const artifact = proposal ? (state.artifacts[projectId] ?? []).find(candidate => candidate.id === proposal.artifact.artifactId) : undefined;
        const version = (state.artifactVersions[projectId] ?? []).find(candidate => candidate.id === verification.verifiedArtifactVersionId);
        const region = proposal && version ? resolveDownstreamUpdateRegionContent(version, downstreamArtifactUpdateResultRegion(proposal)) : { found: false };
        if (!verification.subject && (!artifact || artifact.currentVersionId !== verification.verifiedArtifactVersionId || !version
            || hashReviewValue(version.content) !== verification.verifiedArtifactContentHash
            || !region.found || region.contentHash !== verification.verifiedRegionContentHash)) return { ok: false, reason: 'stale' };
        const events = state.downstreamArtifactUpdateVerificationEvents[projectId] ?? [];
        const at = Math.max(input.at ?? Date.now(), (events.at(-1)?.at ?? 0) + 1);
        const event = sealDownstreamArtifactUpdateVerificationEvent({
            schemaVersion: 1, id: uuidv4(), projectId, verificationId, actor: 'user', action: input.action,
            ...(input.rationale ? { rationale: input.rationale.trim() } : {}),
            ...(input.context ? { context: input.context.trim() } : {}),
            expectedVerificationIntegrityHash: verification.integrityHash, at,
        });
        if (!validateDownstreamArtifactUpdateVerificationEventIntegrity(event)) return { ok: false, reason: 'rationale_required' };
        const duplicate = events.some(candidate => candidate.integrityHash === event.integrityHash);
        if (duplicate) return { ok: true, eventId: event.id, duplicate: true };
        set(current => ({
            downstreamArtifactUpdateVerificationEvents: {
                ...current.downstreamArtifactUpdateVerificationEvents,
                [projectId]: [...(current.downstreamArtifactUpdateVerificationEvents[projectId] ?? []), event],
            },
        }));
        return { ok: true, eventId: event.id, duplicate: false };
    },

    getDownstreamArtifactUpdateProposalCurrentness: (projectId, proposalId) => {
        const state = get();
        const proposal = (state.downstreamArtifactUpdateProposals[projectId] ?? []).find(candidate => candidate.id === proposalId);
        const context = currentContext(state, projectId);
        if (!proposal || !context) return undefined;
        const plan = (state.downstreamUpdatePlans[projectId] ?? []).find(candidate => candidate.id === proposal.updatePlanBinding.planId);
        const artifactVersion = (state.artifactVersions[projectId] ?? []).find(candidate => candidate.id === proposal.artifact.artifactVersionId);
        return compareDownstreamArtifactUpdateProposalCurrentness({ proposal, plan, planContext: context, artifactVersion });
    },
});
