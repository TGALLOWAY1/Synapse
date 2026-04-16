import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Project, HistoryEvent, PipelineStage, ProjectPlatform } from '../../types';
import type { ProjectState } from '../types';
import { trackActivity } from '../../lib/recruiterApi';
import {
    DEMO_PROJECT_ID,
    DEMO_PROJECT_CAPTURED,
    demoProject,
    demoSpineVersions,
    demoArtifacts,
    demoArtifactVersions,
    demoHistoryEvents,
} from '../../data/demoProject';

export type ProjectSlice = {
    projects: Record<string, Project>;
    historyEvents: Record<string, HistoryEvent[]>;
    createProject: ProjectState['createProject'];
    deleteProject: ProjectState['deleteProject'];
    getProject: ProjectState['getProject'];
    getHistoryEvents: ProjectState['getHistoryEvents'];
    setProjectStage: ProjectState['setProjectStage'];
    loadDemoProject: ProjectState['loadDemoProject'];
};

export const createProjectSlice: StateCreator<ProjectState, [], [], ProjectSlice> = (set, get) => ({
    projects: {},
    historyEvents: {},

    createProject: (name: string, promptText: string, platform?: ProjectPlatform) => {
        const projectId = uuidv4();
        const now = Date.now();
        const newProject: Project = {
            id: projectId,
            name,
            createdAt: now,
            ...(platform && { platform }),
        };

        const initialSpine = {
            id: 'v1',
            projectId,
            promptText,
            responseText: 'Generating PRD...',
            createdAt: now,
            isLatest: true,
            isFinal: false,
        };

        const initEvent: HistoryEvent = {
            id: uuidv4(),
            projectId,
            spineVersionId: initialSpine.id,
            type: "Init",
            description: "Spine v1 created",
            createdAt: now,
        };

        set((state) => ({
            projects: { ...state.projects, [projectId]: newProject },
            spineVersions: { ...state.spineVersions, [projectId]: [initialSpine] },
            historyEvents: { ...state.historyEvents, [projectId]: [initEvent] },
        }));
        void trackActivity('clicked_section', { section: 'create_project', projectId });

        return { projectId, spineId: initialSpine.id };
    },

    deleteProject: (projectId: string) => {
        set((state) => {
            const newProjects = { ...state.projects };
            delete newProjects[projectId];
            const newSpines = { ...state.spineVersions };
            delete newSpines[projectId];
            const newHistory = { ...state.historyEvents };
            delete newHistory[projectId];
            const newBranches = { ...state.branches };
            delete newBranches[projectId];
            const newArtifacts = { ...state.artifacts };
            delete newArtifacts[projectId];
            const newArtifactVersions = { ...state.artifactVersions };
            delete newArtifactVersions[projectId];
            const newFeedbackItems = { ...state.feedbackItems };
            delete newFeedbackItems[projectId];
            return {
                projects: newProjects,
                spineVersions: newSpines,
                historyEvents: newHistory,
                branches: newBranches,
                artifacts: newArtifacts,
                artifactVersions: newArtifactVersions,
                feedbackItems: newFeedbackItems,
            };
        });
    },

    getProject: (projectId: string) => {
        return get().projects[projectId];
    },

    getHistoryEvents: (projectId: string) => {
        return get().historyEvents[projectId] || [];
    },

    setProjectStage: (projectId: string, stage: PipelineStage) => {
        set((state) => ({
            projects: {
                ...state.projects,
                [projectId]: { ...state.projects[projectId], currentStage: stage }
            }
        }));
        void trackActivity(stage === 'mockups' ? 'viewed_mockups' : 'clicked_section', { section: stage, projectId });
    },

    // Hydrates the store with the pre-captured demo project. Idempotent: if
    // the demo project already exists, no records are mutated (so a user's
    // in-progress edits to the demo copy are preserved on re-click).
    loadDemoProject: () => {
        const existing = get().projects[DEMO_PROJECT_ID];
        if (existing) {
            return { projectId: DEMO_PROJECT_ID, captured: DEMO_PROJECT_CAPTURED };
        }

        if (!DEMO_PROJECT_CAPTURED) {
            // Placeholder fixture is still in place — don't hydrate a hollow
            // project. The caller surfaces this to the user.
            return { projectId: DEMO_PROJECT_ID, captured: false };
        }

        set((state) => ({
            projects: { ...state.projects, [DEMO_PROJECT_ID]: demoProject },
            spineVersions: {
                ...state.spineVersions,
                [DEMO_PROJECT_ID]: demoSpineVersions,
            },
            artifacts: {
                ...state.artifacts,
                [DEMO_PROJECT_ID]: demoArtifacts,
            },
            artifactVersions: {
                ...state.artifactVersions,
                [DEMO_PROJECT_ID]: demoArtifactVersions,
            },
            historyEvents: {
                ...state.historyEvents,
                [DEMO_PROJECT_ID]: demoHistoryEvents,
            },
            // Branches and feedbackItems intentionally left empty — demo has
            // none. Keep the maps shaped the same as other projects.
            branches: {
                ...state.branches,
                [DEMO_PROJECT_ID]: state.branches[DEMO_PROJECT_ID] ?? [],
            },
            feedbackItems: {
                ...state.feedbackItems,
                [DEMO_PROJECT_ID]: state.feedbackItems[DEMO_PROJECT_ID] ?? [],
            },
        }));

        return { projectId: DEMO_PROJECT_ID, captured: true };
    },
});
