import type {
    ExportOptions,
    ExportResult,
    ImplementationTask,
    TaskExportProvider,
    TaskExportItemResult,
} from '../../../types/tasks';

/**
 * Linear export — creates real Linear issues via the GraphQL API
 * (`issueCreate` mutation, one per task). Mirrors the GitHub provider:
 * credentials live in localStorage (captured in `SettingsModal.tsx`), the
 * payload builders are pure + unit-tested, and `exportTasksToLinear` takes
 * injectable deps so the network path can be tested without a live key.
 *
 * Linear stores labels as IDs (not names), so before creating issues we run
 * a lookup pass — `fetchTeamLabels` — to translate the task's suggested label
 * names into label IDs, warning (and skipping) any that don't exist on the
 * team, exactly like `fetchExistingLabels` in the GitHub provider.
 */

const LINEAR_TOKEN_KEY = 'LINEAR_API_KEY';
const LINEAR_TEAM_KEY = 'LINEAR_TEAM_ID';
const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

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

function readToken(): string | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LINEAR_TOKEN_KEY)?.trim();
    return raw ? raw : null;
}

function readDefaultTeam(): string | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LINEAR_TEAM_KEY)?.trim();
    return raw ? raw : null;
}

interface LinearGraphqlResponse<T> {
    data?: T;
    errors?: { message: string }[];
}

async function linearGraphql<T>(
    token: string,
    fetchImpl: typeof fetch,
    query: string,
    variables: Record<string, unknown>,
): Promise<LinearGraphqlResponse<T>> {
    // Linear personal API keys are sent as the raw `Authorization` value
    // (no `Bearer` prefix); OAuth tokens would use `Bearer`. We support the
    // common personal-key case here.
    const response = await fetchImpl(LINEAR_GRAPHQL_URL, {
        method: 'POST',
        headers: {
            Authorization: token,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
        const body = await safeReadBody(response);
        return { errors: [{ message: `Linear returned ${response.status}: ${body}` }] };
    }
    return (await response.json()) as LinearGraphqlResponse<T>;
}

interface TeamNode {
    id: string;
    key: string;
    name: string;
}

/**
 * Resolve the team to create issues in. Prefers an explicit/configured id,
 * otherwise queries the workspace and uses the first team (warning when there
 * are several so the user knows to pin one in Settings).
 */
async function resolveTeam(
    token: string,
    fetchImpl: typeof fetch,
    configuredTeamId: string | null,
): Promise<{ teamId?: string; warning?: string; error?: string }> {
    if (configuredTeamId) return { teamId: configuredTeamId };
    const result = await linearGraphql<{ teams: { nodes: TeamNode[] } }>(
        token,
        fetchImpl,
        'query { teams { nodes { id key name } } }',
        {},
    );
    if (result.errors?.length) return { error: result.errors[0].message };
    const teams = result.data?.teams.nodes ?? [];
    if (teams.length === 0) {
        return { error: 'No Linear teams are accessible with this API key.' };
    }
    const warning = teams.length > 1
        ? `No team configured — defaulted to "${teams[0].name}" (${teams[0].key}). Set a Team ID in Settings → Integrations to pin a destination.`
        : undefined;
    return { teamId: teams[0].id, warning };
}

interface LabelNode {
    id: string;
    name: string;
}

async function fetchTeamLabels(
    token: string,
    fetchImpl: typeof fetch,
    teamId: string,
): Promise<Map<string, string> | null> {
    const result = await linearGraphql<{ team: { labels: { nodes: LabelNode[] } } }>(
        token,
        fetchImpl,
        'query TeamLabels($teamId: String!) { team(id: $teamId) { labels(first: 250) { nodes { id name } } } }',
        { teamId },
    );
    if (result.errors?.length || !result.data?.team) {
        // Non-fatal: caller will skip the label mapping/warning system.
        return null;
    }
    const map = new Map<string, string>();
    for (const label of result.data.team.labels.nodes) {
        map.set(label.name, label.id);
    }
    return map;
}

interface IssueCreatePayload {
    issueCreate: {
        success: boolean;
        issue?: { id: string; identifier?: string; url?: string; title?: string };
    };
}

export interface LinearExportDeps {
    fetchImpl?: typeof fetch;
    /** Override for tests. Defaults to localStorage lookup. */
    token?: string;
    /** Override for tests. Defaults to localStorage lookup (may be null). */
    teamId?: string | null;
}

export async function exportTasksToLinear(
    tasks: ImplementationTask[],
    options: ExportOptions,
    deps: LinearExportDeps = {},
): Promise<ExportResult> {
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    const token = deps.token ?? readToken();
    const configuredTeamId = deps.teamId !== undefined ? deps.teamId : readDefaultTeam();

    if (!token) {
        return {
            target: 'linear',
            succeeded: [],
            failed: [],
            fatalError: 'No Linear API key found. Add one in Settings → Integrations.',
        };
    }
    if (typeof fetchImpl !== 'function') {
        return {
            target: 'linear',
            succeeded: [],
            failed: [],
            fatalError: 'No fetch implementation available in this environment.',
        };
    }

    const team = await resolveTeam(token, fetchImpl, configuredTeamId);
    if (team.error || !team.teamId) {
        return {
            target: 'linear',
            succeeded: [],
            failed: [],
            fatalError: team.error ?? 'Could not resolve a Linear team to export to.',
        };
    }
    const teamId = team.teamId;
    const teamWarning = team.warning;

    const labelMap = await fetchTeamLabels(token, fetchImpl, teamId);

    const succeeded: TaskExportItemResult[] = [];
    const failed: TaskExportItemResult[] = [];

    for (const task of tasks) {
        const input = buildLinearIssueInput(task, options.projectName, teamId);
        const warnings: string[] = [];
        if (teamWarning) warnings.push(teamWarning);

        let labelIds: string[] | undefined;
        if (labelMap && input.labels && input.labels.length) {
            const mapped: string[] = [];
            const missing: string[] = [];
            for (const name of input.labels) {
                const id = labelMap.get(name);
                if (id) mapped.push(id);
                else missing.push(name);
            }
            if (missing.length) {
                warnings.push(`Skipped labels not present on the Linear team: ${missing.join(', ')}`);
            }
            labelIds = mapped.length ? mapped : undefined;
        }

        try {
            const result = await linearGraphql<IssueCreatePayload>(
                token,
                fetchImpl,
                `mutation IssueCreate($input: IssueCreateInput!) {
                    issueCreate(input: $input) {
                        success
                        issue { id identifier url title }
                    }
                }`,
                {
                    input: {
                        title: input.title,
                        description: input.description,
                        teamId,
                        priority: input.priority,
                        labelIds,
                    },
                },
            );

            if (result.errors?.length) {
                failed.push({
                    taskId: task.id,
                    title: task.title,
                    error: result.errors.map(e => e.message).join('; '),
                    warnings: warnings.length ? warnings : undefined,
                });
                continue;
            }

            const created = result.data?.issueCreate;
            if (!created?.success || !created.issue) {
                failed.push({
                    taskId: task.id,
                    title: task.title,
                    error: 'Linear reported the issue was not created.',
                    warnings: warnings.length ? warnings : undefined,
                });
                continue;
            }

            succeeded.push({
                taskId: task.id,
                title: task.title,
                externalUrl: created.issue.url,
                externalId: created.issue.identifier,
                warnings: warnings.length ? warnings : undefined,
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            failed.push({
                taskId: task.id,
                title: task.title,
                error: message,
                warnings: warnings.length ? warnings : undefined,
            });
        }
    }

    return {
        target: 'linear',
        succeeded,
        failed,
    };
}

async function safeReadBody(response: Response): Promise<string> {
    try {
        const text = await response.text();
        return text.slice(0, 500);
    } catch {
        return '(could not read response body)';
    }
}

export const linearExporter: TaskExportProvider = {
    id: 'linear',
    label: 'Linear Issues',
    checkReady() {
        if (!readToken()) return 'Add a Linear API key in Settings → Integrations.';
        return null;
    },
    exportTasks: (tasks, options) => exportTasksToLinear(tasks, options),
};
