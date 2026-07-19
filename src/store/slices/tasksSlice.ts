import type { StateCreator } from 'zustand';
import type { ProjectTask, TaskStatus, TaskExternalRef } from '../../types';
import type { ImplementationTask } from '../../types/tasks';
import type { ProjectState } from '../types';
import { assertProjectCapability } from '../../lib/projectCapabilities';

export type TasksSlice = {
    tasks: Record<string, ProjectTask[]>;
    saveTasks: ProjectState['saveTasks'];
    setTaskStatus: ProjectState['setTaskStatus'];
    removeProjectTask: ProjectState['removeProjectTask'];
    recordTaskExports: ProjectState['recordTaskExports'];
    getTasks: ProjectState['getTasks'];
    getTasksForArtifact: ProjectState['getTasksForArtifact'];
};

const toProjectTask = (
    task: ImplementationTask,
    projectId: string,
    sourceSpineVersionId: string | undefined,
    now: number,
    prior?: ProjectTask,
): ProjectTask => ({
    id: task.id,
    projectId,
    sourceArtifactId: task.sourceArtifactId,
    sourceSpineVersionId,
    sourceSectionId: task.sourceSectionId,
    title: task.title,
    summary: task.summary,
    priority: task.priority,
    taskType: task.taskType,
    estimatedComplexity: task.estimatedComplexity,
    acceptanceCriteria: task.acceptanceCriteria,
    dependencies: task.dependencies,
    implementationNotes: task.implementationNotes,
    suggestedLabels: task.suggestedLabels,
    // Carry over tracking state when re-saving a task that already exists, so
    // edits to title/criteria never silently reset progress or export history.
    status: prior?.status ?? 'todo',
    externalRefs: prior?.externalRefs,
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
});

export const createTasksSlice: StateCreator<ProjectState, [], [], TasksSlice> = (set, get) => ({
    tasks: {},

    saveTasks: (projectId, sourceArtifactId, tasks, sourceSpineVersionId) => {
        assertProjectCapability(get().projects[projectId], 'canPersistWorkflowState');
        const now = Date.now();
        set((state) => {
            const existing = state.tasks[projectId] || [];
            const priorById = new Map(
                existing
                    .filter(t => t.sourceArtifactId === sourceArtifactId)
                    .map(t => [t.id, t] as const),
            );
            // Replace the whole set for this artifact; keep tasks from other
            // artifacts untouched.
            const fromOtherArtifacts = existing.filter(t => t.sourceArtifactId !== sourceArtifactId);
            const incoming = tasks.map(t =>
                toProjectTask(t, projectId, sourceSpineVersionId, now, priorById.get(t.id)),
            );
            return {
                tasks: { ...state.tasks, [projectId]: [...fromOtherArtifacts, ...incoming] },
            };
        });
        return { saved: tasks.length };
    },

    setTaskStatus: (projectId: string, taskId: string, status: TaskStatus) => {
        assertProjectCapability(get().projects[projectId], 'canPersistWorkflowState');
        set((state) => {
            const list = state.tasks[projectId] || [];
            return {
                tasks: {
                    ...state.tasks,
                    [projectId]: list.map(t =>
                        t.id === taskId ? { ...t, status, updatedAt: Date.now() } : t,
                    ),
                },
            };
        });
    },

    removeProjectTask: (projectId: string, taskId: string) => {
        assertProjectCapability(get().projects[projectId], 'canPersistWorkflowState');
        set((state) => {
            const list = state.tasks[projectId] || [];
            return {
                tasks: { ...state.tasks, [projectId]: list.filter(t => t.id !== taskId) },
            };
        });
    },

    recordTaskExports: (
        projectId: string,
        refs: Array<{ taskId: string; ref: TaskExternalRef }>,
    ) => {
        assertProjectCapability(get().projects[projectId], 'canExportExternally');
        if (refs.length === 0) return;
        const byTask = new Map<string, TaskExternalRef[]>();
        for (const { taskId, ref } of refs) {
            const arr = byTask.get(taskId) ?? [];
            arr.push(ref);
            byTask.set(taskId, arr);
        }
        set((state) => {
            const list = state.tasks[projectId] || [];
            const now = Date.now();
            return {
                tasks: {
                    ...state.tasks,
                    [projectId]: list.map(t => {
                        const added = byTask.get(t.id);
                        if (!added) return t;
                        return {
                            ...t,
                            // Drop any prior ref to the same target, then append —
                            // re-exporting to GitHub replaces the stale issue link.
                            externalRefs: [
                                ...(t.externalRefs ?? []).filter(
                                    r => !added.some(a => a.target === r.target),
                                ),
                                ...added,
                            ],
                            updatedAt: now,
                        };
                    }),
                },
            };
        });
    },

    getTasks: (projectId: string) => get().tasks[projectId] || [],

    getTasksForArtifact: (projectId: string, sourceArtifactId: string) =>
        (get().tasks[projectId] || []).filter(t => t.sourceArtifactId === sourceArtifactId),
});
