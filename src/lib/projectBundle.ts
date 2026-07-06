// Serialization boundary between the Zustand project store and the server.
//
// A "project" in the store is NOT one object — it is nine project-id-keyed
// collections (see docs/SERVER_PROJECT_STORAGE.md). A ProjectBundle gathers the
// slices for a single project into one transportable object so it can be pushed
// to / pulled from `/api/projects` as a unit.
//
// These helpers are PURE (no store/network access) so they can be unit-tested in
// isolation and reused by the sync orchestrator.

import type {
  Project, SpineVersion, HistoryEvent, Branch,
  Artifact, ArtifactVersion, FeedbackItem, ProjectTask, WorkflowRun,
} from '../types';

export interface ProjectBundle {
  project: Project;
  spineVersions: SpineVersion[];
  historyEvents: HistoryEvent[];
  branches: Branch[];
  artifacts: Artifact[];
  artifactVersions: ArtifactVersion[];
  feedbackItems: FeedbackItem[];
  tasks: ProjectTask[];
  workflowRuns: WorkflowRun[];
}

/** The persisted, project-id-keyed slices a bundle is assembled from. */
export interface BundleSource {
  projects: Record<string, Project>;
  spineVersions: Record<string, SpineVersion[]>;
  historyEvents: Record<string, HistoryEvent[]>;
  branches: Record<string, Branch[]>;
  artifacts: Record<string, Artifact[]>;
  artifactVersions: Record<string, ArtifactVersion[]>;
  feedbackItems: Record<string, FeedbackItem[]>;
  tasks: Record<string, ProjectTask[]>;
  workflowRuns: Record<string, WorkflowRun[]>;
}

// The eight array-valued collections (everything except the `projects` map).
const ARRAY_COLLECTIONS = [
  'spineVersions',
  'historyEvents',
  'branches',
  'artifacts',
  'artifactVersions',
  'feedbackItems',
  'tasks',
  'workflowRuns',
] as const;

/**
 * Pull every slice for one project into a single bundle, or null if the project
 * doesn't exist in the source. Missing collections become empty arrays so the
 * shape is always complete.
 */
export function extractProjectBundle(source: BundleSource, projectId: string): ProjectBundle | null {
  const project = source.projects?.[projectId];
  if (!project) return null;
  const bundle = { project } as ProjectBundle;
  for (const key of ARRAY_COLLECTIONS) {
    const map = source[key] as Record<string, unknown[]> | undefined;
    (bundle as unknown as Record<string, unknown>)[key] = Array.isArray(map?.[projectId]) ? map[projectId] : [];
  }
  return bundle;
}

/** True when `value` is a structurally valid bundle (has a project with an id). */
export function isValidBundle(value: unknown): value is ProjectBundle {
  if (!value || typeof value !== 'object') return false;
  const project = (value as { project?: { id?: unknown } }).project;
  return Boolean(project && typeof project.id === 'string' && project.id.length > 0);
}

/**
 * Additively merge server bundles into the current store slices. Existing local
 * projects always win on id collision — a pull can only ADD projects the device
 * doesn't have yet, never clobber local in-progress work. (Per-project
 * server-newer reconciliation is deferred to conflict resolution; see
 * tasks/TODO.md.) Returns the updated slice maps plus the ids that were added.
 */
export function mergeBundlesIntoSource(
  source: BundleSource,
  bundles: ProjectBundle[],
): { next: BundleSource; addedIds: string[] } {
  const next: BundleSource = {
    projects: { ...source.projects },
    spineVersions: { ...source.spineVersions },
    historyEvents: { ...source.historyEvents },
    branches: { ...source.branches },
    artifacts: { ...source.artifacts },
    artifactVersions: { ...source.artifactVersions },
    feedbackItems: { ...source.feedbackItems },
    tasks: { ...source.tasks },
    workflowRuns: { ...source.workflowRuns },
  };
  const addedIds: string[] = [];
  for (const bundle of bundles) {
    if (!isValidBundle(bundle)) continue;
    const id = bundle.project.id;
    if (id in next.projects) continue; // existing local project wins
    next.projects[id] = bundle.project;
    for (const key of ARRAY_COLLECTIONS) {
      const value = (bundle as unknown as Record<string, unknown>)[key];
      (next[key] as Record<string, unknown[]>)[id] = Array.isArray(value) ? (value as unknown[]) : [];
    }
    addedIds.push(id);
  }
  return { next, addedIds };
}

/**
 * REPLACE the slices for each bundle's project id with the server copy. Unlike
 * mergeBundlesIntoSource (which is additive and lets local win), this overwrites
 * existing local slices — used ONLY for a safe server-newer refresh when the
 * local copy has no unsynced changes, or when the user explicitly chooses "use
 * the cloud version" to resolve a conflict. Never call this over dirty local
 * work without the user's consent. Returns the updated slice maps.
 */
export function overwriteBundlesIntoSource(
  source: BundleSource,
  bundles: ProjectBundle[],
): { next: BundleSource; replacedIds: string[] } {
  const next: BundleSource = {
    projects: { ...source.projects },
    spineVersions: { ...source.spineVersions },
    historyEvents: { ...source.historyEvents },
    branches: { ...source.branches },
    artifacts: { ...source.artifacts },
    artifactVersions: { ...source.artifactVersions },
    feedbackItems: { ...source.feedbackItems },
    tasks: { ...source.tasks },
    workflowRuns: { ...source.workflowRuns },
  };
  const replacedIds: string[] = [];
  for (const bundle of bundles) {
    if (!isValidBundle(bundle)) continue;
    const id = bundle.project.id;
    next.projects[id] = bundle.project;
    for (const key of ARRAY_COLLECTIONS) {
      const value = (bundle as unknown as Record<string, unknown>)[key];
      (next[key] as Record<string, unknown[]>)[id] = Array.isArray(value) ? (value as unknown[]) : [];
    }
    replacedIds.push(id);
  }
  return { next, replacedIds };
}

/**
 * Reference-equality check for whether project `projectId`'s slices changed
 * between two store snapshots. Relies on the store's immutable updates (spreads),
 * so a changed slice is a new reference. Used to decide which project to push.
 */
export function projectSlicesChanged(
  a: BundleSource,
  b: BundleSource,
  projectId: string,
): boolean {
  if (a.projects[projectId] !== b.projects[projectId]) return true;
  for (const key of ARRAY_COLLECTIONS) {
    if ((a[key] as Record<string, unknown>)[projectId] !== (b[key] as Record<string, unknown>)[projectId]) {
      return true;
    }
  }
  return false;
}
