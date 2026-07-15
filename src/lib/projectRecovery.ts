// Recovery bundle: a self-contained JSON download of a single project's LOCAL
// state, for the cases where cloud durability is in doubt — a failed cloud save,
// an expired session, a network outage, a server body-limit rejection, or an
// unresolved cross-device conflict. It lets the user get their work off the
// device even when sync can't, and is enough to restore or debug the project.
//
// This is deliberately the local-first escape hatch: it never touches the
// network and never mutates any state. It reuses the same ProjectBundle shape
// the sync layer transports, plus a small envelope so the file is
// self-describing.

import { useProjectStore } from '../store/projectStore';
import { extractProjectBundle, type BundleSource, type ProjectBundle } from './projectBundle';

const RECOVERY_FORMAT = 'synapse-project-recovery/v1';

export interface ProjectRecoveryBundle {
  format: typeof RECOVERY_FORMAT;
  exportedAt: string;
  projectId: string;
  projectName: string;
  /** Why the recovery download was offered, for debugging. */
  reason?: string;
  bundle: ProjectBundle;
}

function bundleSourceOfStore(): BundleSource {
  const state = useProjectStore.getState();
  return {
    projects: state.projects,
    spineVersions: state.spineVersions,
    historyEvents: state.historyEvents,
    branches: state.branches,
    artifacts: state.artifacts,
    artifactVersions: state.artifactVersions,
    feedbackItems: state.feedbackItems,
    tasks: state.tasks,
    workflowRuns: state.workflowRuns,
    reviewRuns: state.reviewRuns,
    specialistRuns: state.specialistRuns,
    reviewFindings: state.reviewFindings,
    reviewIssues: state.reviewIssues,
    planningRecords: state.planningRecords,
    readinessReviews: state.readinessReviews,
    readinessCommitmentEvents: state.readinessCommitmentEvents,
  };
}

/** Assemble a recovery bundle for one project from the live local store, or null
 *  if the project doesn't exist locally. Pure w.r.t. the network. */
export function buildProjectRecoveryBundle(
  projectId: string,
  reason?: string,
): ProjectRecoveryBundle | null {
  const bundle = extractProjectBundle(bundleSourceOfStore(), projectId);
  if (!bundle) return null;
  return {
    format: RECOVERY_FORMAT,
    exportedAt: new Date().toISOString(),
    projectId,
    projectName: bundle.project.name || 'Untitled project',
    reason,
    bundle,
  };
}

function slugify(name: string): string {
  return (name || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
}

/**
 * Trigger a browser download of a project's recovery bundle. Returns true if the
 * project existed and a download was started. Safe no-op outside the browser.
 */
export function downloadProjectRecoveryBundle(projectId: string, reason?: string): boolean {
  const recovery = buildProjectRecoveryBundle(projectId, reason);
  if (!recovery) return false;
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    return false;
  }
  const json = JSON.stringify(recovery, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = recovery.exportedAt.slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `synapse-recovery-${slugify(recovery.projectName)}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
