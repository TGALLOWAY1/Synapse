import type {
    ExportOptions,
    ExportResult,
    ExportTargetId,
    ImplementationTask,
    TaskExportProvider,
} from '../../../types/tasks';
import { githubExporter } from './githubExporter';
import { markdownExporter } from './markdownExporter';

/**
 * Provider registry — config-driven dispatcher in the same style as
 * `api/auth/[provider]/callback.js`. New targets register here.
 */
export const EXPORT_PROVIDERS: Record<ExportTargetId, TaskExportProvider> = {
    markdown: markdownExporter,
    github: githubExporter,
};

export function listExportProviders(): TaskExportProvider[] {
    return Object.values(EXPORT_PROVIDERS);
}

export async function exportTasks(
    tasks: ImplementationTask[],
    options: ExportOptions,
): Promise<ExportResult> {
    const provider = EXPORT_PROVIDERS[options.target];
    if (!provider) {
        return {
            target: options.target,
            succeeded: [],
            failed: [],
            fatalError: `Unknown export target: ${options.target}`,
        };
    }
    return provider.exportTasks(tasks, options);
}

export { buildGithubIssueBody, buildGithubIssuePayload, exportTasksToGithub } from './githubExporter';
export { renderTaskMarkdown, renderTasksMarkdown } from './markdownExporter';
