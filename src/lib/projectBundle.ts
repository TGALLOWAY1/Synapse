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
  ReviewRun, SpecialistRun, SpecialistFinding, ReviewIssue, PlanningRecord,
  ReadinessReview, ReadinessCommitmentEvent,
} from '../types';
import type { DownstreamUpdatePlan, DownstreamUpdatePlanEvent } from './planning/downstreamUpdatePlan';
import type {
  DownstreamArtifactUpdateApplication, DownstreamArtifactUpdateProposal,
  DownstreamArtifactUpdateReviewEvent, DownstreamArtifactUpdateVerification,
  DownstreamArtifactUpdateVerificationEvent,
} from './planning/downstreamArtifactUpdateProposal';

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
  // Optional on the wire for projects saved before adversarial review existed.
  reviewRuns?: ReviewRun[];
  specialistRuns?: SpecialistRun[];
  reviewFindings?: SpecialistFinding[];
  reviewIssues?: ReviewIssue[];
  planningRecords?: PlanningRecord[];
  readinessReviews?: ReadinessReview[];
  readinessCommitmentEvents?: ReadinessCommitmentEvent[];
  downstreamUpdatePlans?: DownstreamUpdatePlan[];
  downstreamUpdatePlanEvents?: DownstreamUpdatePlanEvent[];
  downstreamArtifactUpdateProposals?: DownstreamArtifactUpdateProposal[];
  downstreamArtifactUpdateReviewEvents?: DownstreamArtifactUpdateReviewEvent[];
  downstreamArtifactUpdateApplications?: DownstreamArtifactUpdateApplication[];
  downstreamArtifactUpdateVerifications?: DownstreamArtifactUpdateVerification[];
  downstreamArtifactUpdateVerificationEvents?: DownstreamArtifactUpdateVerificationEvent[];
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
  reviewRuns: Record<string, ReviewRun[]>;
  specialistRuns: Record<string, SpecialistRun[]>;
  reviewFindings: Record<string, SpecialistFinding[]>;
  reviewIssues: Record<string, ReviewIssue[]>;
  planningRecords: Record<string, PlanningRecord[]>;
  readinessReviews: Record<string, ReadinessReview[]>;
  readinessCommitmentEvents: Record<string, ReadinessCommitmentEvent[]>;
  downstreamUpdatePlans?: Record<string, DownstreamUpdatePlan[]>;
  downstreamUpdatePlanEvents?: Record<string, DownstreamUpdatePlanEvent[]>;
  downstreamArtifactUpdateProposals?: Record<string, DownstreamArtifactUpdateProposal[]>;
  downstreamArtifactUpdateReviewEvents?: Record<string, DownstreamArtifactUpdateReviewEvent[]>;
  downstreamArtifactUpdateApplications?: Record<string, DownstreamArtifactUpdateApplication[]>;
  downstreamArtifactUpdateVerifications?: Record<string, DownstreamArtifactUpdateVerification[]>;
  downstreamArtifactUpdateVerificationEvents?: Record<string, DownstreamArtifactUpdateVerificationEvent[]>;
}

// The array-valued collections (everything except the `projects` map).
// This is the single source of truth for "which project-keyed collections
// exist" — every consumer that used to hand-list these keys (the sync
// orchestrator, the recovery-bundle builder, the per-user namespace switch,
// and the legacy-import merge) derives from this constant (or
// ALL_PROJECT_COLLECTIONS below) instead.
export const ARRAY_COLLECTIONS = [
  'spineVersions',
  'historyEvents',
  'branches',
  'artifacts',
  'artifactVersions',
  'feedbackItems',
  'tasks',
  'workflowRuns',
  'reviewRuns',
  'specialistRuns',
  'reviewFindings',
  'reviewIssues',
  'planningRecords',
  'readinessReviews',
  'readinessCommitmentEvents',
  'downstreamUpdatePlans',
  'downstreamUpdatePlanEvents',
  'downstreamArtifactUpdateProposals',
  'downstreamArtifactUpdateReviewEvents',
  'downstreamArtifactUpdateApplications',
  'downstreamArtifactUpdateVerifications',
  'downstreamArtifactUpdateVerificationEvents',
] as const;

/** Every project-keyed collection, including the `projects` map itself. */
export const ALL_PROJECT_COLLECTIONS = ['projects', ...ARRAY_COLLECTIONS] as const;

/** A BundleSource with every collection set to an empty object — the shape to
 *  reset store state to before rehydrating a different namespace. */
export function emptyBundleSource(): BundleSource {
  const empty = {} as BundleSource;
  for (const key of ALL_PROJECT_COLLECTIONS) {
    (empty as unknown as Record<string, unknown>)[key] = {};
  }
  return empty;
}

/** Shallow-copy every collection of `source` into a fresh BundleSource object,
 *  so callers can mutate the copy without touching the original maps. */
function cloneBundleSource(source: BundleSource): BundleSource {
  const next = {} as BundleSource;
  for (const key of ALL_PROJECT_COLLECTIONS) {
    (next as unknown as Record<string, unknown>)[key] = {
      ...(source as unknown as Record<string, Record<string, unknown>>)[key],
    };
  }
  return next;
}

/** Pick the project-keyed collections off any object that structurally has
 *  them (e.g. the Zustand store state) into a plain BundleSource. */
export function pickBundleSource(state: BundleSource): BundleSource {
  const out = {} as BundleSource;
  for (const key of ALL_PROJECT_COLLECTIONS) {
    (out as unknown as Record<string, unknown>)[key] = state[key];
  }
  return out;
}

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
  const next = cloneBundleSource(source);
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
  const next = cloneBundleSource(source);
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
    if ((a[key] as Record<string, unknown> | undefined)?.[projectId]
      !== (b[key] as Record<string, unknown> | undefined)?.[projectId]) {
      return true;
    }
  }
  return false;
}
