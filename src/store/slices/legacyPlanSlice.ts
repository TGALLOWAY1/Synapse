import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { DevPlan, Milestone, AgentPrompt } from '../../types';
import type { ProjectState } from '../types';

export type LegacyPlanSlice = {
    devPlans: Record<string, DevPlan[]>;
    agentPrompts: Record<string, AgentPrompt[]>;
    createDevPlan: ProjectState['createDevPlan'];
    deleteDevPlan: ProjectState['deleteDevPlan'];
    getDevPlans: ProjectState['getDevPlans'];
    getLatestDevPlan: ProjectState['getLatestDevPlan'];
    createAgentPrompt: ProjectState['createAgentPrompt'];
    deleteAgentPrompt: ProjectState['deleteAgentPrompt'];
    getAgentPrompts: ProjectState['getAgentPrompts'];
};

export const createLegacyPlanSlice: StateCreator<ProjectState, [], [], LegacyPlanSlice> = (set, get) => ({
    devPlans: {},
    agentPrompts: {},

    createDevPlan: (projectId: string, spineVersionId: string, milestones: Milestone[]) => {
        const devPlanId = uuidv4();
        const now = Date.now();
        const existing = get().devPlans[projectId] || [];
        const mappedOld = existing.map(d => ({ ...d, isLatest: false }));
        const newPlan: DevPlan = {
            id: devPlanId,
            projectId,
            spineVersionId,
            milestones,
            createdAt: now,
            isLatest: true,
        };
        set((state) => ({
            devPlans: { ...state.devPlans, [projectId]: [...mappedOld, newPlan] }
        }));
        return { devPlanId };
    },

    deleteDevPlan: (projectId: string, devPlanId: string) => {
        set((state) => ({
            devPlans: {
                ...state.devPlans,
                [projectId]: (state.devPlans[projectId] || []).filter(d => d.id !== devPlanId)
            }
        }));
    },

    getDevPlans: (projectId: string) => {
        return get().devPlans[projectId] || [];
    },

    getLatestDevPlan: (projectId: string) => {
        const plans = get().devPlans[projectId] || [];
        return plans.find(p => p.isLatest);
    },

    createAgentPrompt: (projectId: string, prompt: Omit<AgentPrompt, 'id' | 'createdAt'>) => {
        const promptId = uuidv4();
        const newPrompt: AgentPrompt = {
            ...prompt,
            id: promptId,
            createdAt: Date.now(),
        };
        set((state) => ({
            agentPrompts: {
                ...state.agentPrompts,
                [projectId]: [...(state.agentPrompts[projectId] || []), newPrompt]
            }
        }));
        return { promptId };
    },

    deleteAgentPrompt: (projectId: string, promptId: string) => {
        set((state) => ({
            agentPrompts: {
                ...state.agentPrompts,
                [projectId]: (state.agentPrompts[projectId] || []).filter(p => p.id !== promptId)
            }
        }));
    },

    getAgentPrompts: (projectId: string, milestoneId?: string) => {
        const prompts = get().agentPrompts[projectId] || [];
        if (milestoneId) return prompts.filter(p => p.milestoneId === milestoneId);
        return prompts;
    },
});
