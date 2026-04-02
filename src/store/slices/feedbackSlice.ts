import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { FeedbackItem, FeedbackType, FeedbackStatus, ArtifactType, HistoryEvent } from '../../types';
import type { ProjectState } from '../types';

export type FeedbackSlice = {
    feedbackItems: Record<string, FeedbackItem[]>;
    createFeedbackItem: ProjectState['createFeedbackItem'];
    updateFeedbackStatus: ProjectState['updateFeedbackStatus'];
    getFeedbackItems: ProjectState['getFeedbackItems'];
};

export const createFeedbackSlice: StateCreator<ProjectState, [], [], FeedbackSlice> = (set, get) => ({
    feedbackItems: {},

    createFeedbackItem: (
        projectId: string,
        sourceArtifactVersionId: string,
        type: FeedbackType,
        title: string,
        description: string,
        targetArtifactType: ArtifactType
    ) => {
        const feedbackId = uuidv4();
        const now = Date.now();
        const newFeedback: FeedbackItem = {
            id: feedbackId,
            projectId,
            sourceArtifactVersionId,
            type,
            title,
            description,
            status: 'open',
            targetArtifactType,
            createdAt: now,
            updatedAt: now,
        };

        // Create history event
        const historyEvent: HistoryEvent = {
            id: uuidv4(),
            projectId,
            type: "FeedbackCreated",
            description: `Feedback: "${title}"`,
            createdAt: now,
        };

        set((state) => ({
            feedbackItems: {
                ...state.feedbackItems,
                [projectId]: [...(state.feedbackItems[projectId] || []), newFeedback]
            },
            historyEvents: {
                ...state.historyEvents,
                [projectId]: [...(state.historyEvents[projectId] || []), historyEvent]
            },
        }));

        return { feedbackId };
    },

    updateFeedbackStatus: (projectId: string, feedbackId: string, status: FeedbackStatus) => {
        set((state) => {
            const items = state.feedbackItems[projectId] || [];
            const updatedItems = items.map(f =>
                f.id === feedbackId ? { ...f, status, updatedAt: Date.now() } : f
            );

            const updates: Record<string, unknown> = {
                feedbackItems: { ...state.feedbackItems, [projectId]: updatedItems }
            };

            // Add history event if incorporated
            if (status === 'incorporated') {
                const feedback = items.find(f => f.id === feedbackId);
                const historyEvent: HistoryEvent = {
                    id: uuidv4(),
                    projectId,
                    type: "FeedbackApplied",
                    description: `Feedback applied: "${feedback?.title || ''}"`,
                    createdAt: Date.now(),
                };
                updates.historyEvents = {
                    ...state.historyEvents,
                    [projectId]: [...(state.historyEvents[projectId] || []), historyEvent]
                };
            }

            return updates as Partial<ProjectState>;
        });
    },

    getFeedbackItems: (projectId: string, status?: FeedbackStatus) => {
        const items = get().feedbackItems[projectId] || [];
        if (status) return items.filter(f => f.status === status);
        return items;
    },
});
