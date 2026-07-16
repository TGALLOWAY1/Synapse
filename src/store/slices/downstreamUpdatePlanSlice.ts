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

export type DownstreamUpdatePlanSlice = Pick<ProjectState,
    | 'downstreamUpdatePlans'
    | 'downstreamUpdatePlanEvents'
    | 'recordDownstreamUpdatePlan'
    | 'generateDownstreamUpdatePlans'
    | 'appendDownstreamUpdatePlanEvent'
    | 'getDownstreamUpdatePlanCurrentness'
    | 'getDownstreamUpdatePlanSummary'
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

    getDownstreamUpdatePlanSummary: (projectId) => deriveDownstreamUpdatePlanSummary({
        plans: get().downstreamUpdatePlans[projectId] ?? [],
        events: get().downstreamUpdatePlanEvents[projectId] ?? [],
        context: currentContext(get(), projectId),
    }),
});
