/**
 * Types for the "Convert Implementation Plan to Tasks" feature.
 *
 * Kept separate from `src/types/index.ts` (which is the persisted-domain SoT)
 * because tasks are transient — extracted on demand, exported, and discarded.
 * Putting them in the persisted types file would make them eligible for
 * accidental localStorage migrations.
 */

export type TaskType =
    | 'frontend'
    | 'backend'
    | 'design'
    | 'data'
    | 'qa'
    | 'docs'
    | 'infra';

export type TaskPriority = 'low' | 'medium' | 'high';

export type TaskComplexity = 'small' | 'medium' | 'large';

export interface ImplementationTask {
    id: string;
    title: string;
    summary: string;
    sourceArtifactId: string;
    sourceSectionId?: string;
    priority?: TaskPriority;
    taskType?: TaskType;
    estimatedComplexity?: TaskComplexity;
    dependencies?: string[];
    acceptanceCriteria: string[];
    implementationNotes?: string[];
    suggestedLabels?: string[];
}

export type ExportTargetId = 'markdown' | 'github' | 'linear';

export interface ExportOptions {
    target: ExportTargetId;
    /**
     * Project name — used to derive a download filename and as a prefix in
     * issue titles. Optional; falls back to "Synapse Tasks".
     */
    projectName?: string;
}

export interface TaskExportItemResult {
    taskId: string;
    title: string;
    /** External URL when the export target produced one (e.g. GitHub issue). */
    externalUrl?: string;
    /** External ID (issue number, ticket id, …) when available. */
    externalId?: string;
    /** Reason this task failed to export, if it did. */
    error?: string;
    /** Provider-emitted warnings — e.g. "label X did not exist on the repo". */
    warnings?: string[];
}

export interface ExportResult {
    target: ExportTargetId;
    succeeded: TaskExportItemResult[];
    failed: TaskExportItemResult[];
    /** Top-level error that prevented any task from being attempted. */
    fatalError?: string;
    /** Generic notes from the provider (e.g. "tasks.md downloaded"). */
    notes?: string[];
}

export interface TaskExportProvider {
    id: ExportTargetId;
    label: string;
    /**
     * Lightweight readiness check (does the user have credentials? a repo?).
     * Returns null when ready, or a user-facing reason when not.
     */
    checkReady(): string | null;
    exportTasks(tasks: ImplementationTask[], options: ExportOptions): Promise<ExportResult>;
}
