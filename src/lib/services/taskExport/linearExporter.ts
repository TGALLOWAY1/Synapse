import type {
    ExportOptions,
    ExportResult,
    ImplementationTask,
    TaskExportProvider,
} from '../../../types/tasks';

/**
 * Linear export — currently a stub. The payload builder is real and
 * exercised by tests; the network call is a TODO that returns simulated
 * success so the rest of the UI can be wired in advance.
 *
 * To productionise:
 *   1. Add `LINEAR_API_KEY` (and optional `LINEAR_TEAM_ID`) inputs to
 *      `SettingsModal.tsx` alongside the GitHub fields.
 *   2. Replace the stubbed branch in `exportTasks` with a real
 *      `https://api.linear.app/graphql` request that issues an
 *      `issueCreate` mutation per task.
 *   3. Map `priority`/`taskType` to Linear's priority + label
 *      identifiers (Linear stores labels as IDs, so this requires a
 *      lookup pass similar to `fetchExistingLabels` in the GitHub
 *      provider).
 */

export interface LinearIssueInput {
    title: string;
    description: string;
    teamId?: string;
    priority?: number;
    labels?: string[];
}

export function buildLinearIssueDescription(task: ImplementationTask, projectName?: string): string {
    const lines: string[] = [];
    if (task.summary) {
        lines.push('## Summary');
        lines.push(task.summary);
        lines.push('');
    }
    lines.push('## Source');
    const sourceParts: string[] = ['Implementation Plan'];
    if (projectName) sourceParts.push(projectName);
    if (task.sourceSectionId) sourceParts.push(task.sourceSectionId);
    lines.push(sourceParts.join(' · '));
    lines.push('');
    lines.push('## Acceptance Criteria');
    if (task.acceptanceCriteria.length === 0) {
        lines.push('- [ ] (no criteria captured)');
    } else {
        for (const criterion of task.acceptanceCriteria) {
            lines.push(`- [ ] ${criterion}`);
        }
    }
    lines.push('');
    if (task.implementationNotes && task.implementationNotes.length) {
        lines.push('## Implementation Notes');
        for (const note of task.implementationNotes) {
            lines.push(`- ${note}`);
        }
        lines.push('');
    }
    if (task.dependencies && task.dependencies.length) {
        lines.push('## Dependencies');
        for (const dep of task.dependencies) {
            lines.push(`- ${dep}`);
        }
    }
    return lines.join('\n').trim();
}

const LINEAR_PRIORITY_MAP: Record<NonNullable<ImplementationTask['priority']>, number> = {
    low: 4,
    medium: 3,
    high: 1,
};

export function buildLinearIssueInput(
    task: ImplementationTask,
    projectName?: string,
    teamId?: string,
): LinearIssueInput {
    return {
        title: task.title,
        description: buildLinearIssueDescription(task, projectName),
        teamId,
        priority: task.priority ? LINEAR_PRIORITY_MAP[task.priority] : undefined,
        labels: task.suggestedLabels ? [...task.suggestedLabels] : undefined,
    };
}

export const linearExporter: TaskExportProvider = {
    id: 'linear',
    label: 'Linear (mocked)',
    checkReady() {
        // The real adapter would check for `LINEAR_API_KEY`. The stub
        // pretends it's always ready so the user can preview the export
        // contract.
        return null;
    },
    async exportTasks(
        tasks: ImplementationTask[],
        options: ExportOptions,
    ): Promise<ExportResult> {
        // TODO(linear): replace stub with real Linear GraphQL call once
        // PAT capture lands in SettingsModal.
        const inputs = tasks.map(t => buildLinearIssueInput(t, options.projectName));
        return {
            target: 'linear',
            mock: true,
            succeeded: tasks.map((t, i) => ({
                taskId: t.id,
                title: t.title,
                externalId: `LIN-MOCK-${String(i + 1).padStart(3, '0')}`,
            })),
            failed: [],
            notes: [
                `Linear export is currently mocked — ${inputs.length} ticket payload${inputs.length === 1 ? '' : 's'} prepared but not sent.`,
            ],
        };
    },
};
