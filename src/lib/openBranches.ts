// Open branches follow the plan. A branch is keyed to a spine version
// (`Branch.spineVersionId`) and the workspace lists branches for the LATEST
// spine, so every action that appends a spine version (inline edit, decision
// apply, section retry, revert/restore, consolidation, staged apply,
// regenerate) must move the project's open branches onto the new version —
// otherwise any edit orphans every open conversation and staged replacement on
// a version nothing lists any more. Pure; the store slices call it inside their
// set() updaters so the move is atomic with the append.

import type { Branch } from '../types';

/**
 * A branch is open while its conversation is live (`active`) or it holds a
 * staged replacement (`resolved`). Merged and rejected branches are history:
 * their `spineVersionId` records the version they were closed against.
 */
export function isOpenBranch(branch: Pick<Branch, 'status'>): boolean {
    return branch.status === 'active' || branch.status === 'resolved';
}

/**
 * Re-point every open branch at `newSpineVersionId`. Closed branches keep their
 * original version. Returns the input array itself when nothing moves, so a
 * store slice that is unchanged keeps its reference (selector stability and
 * sync's reference diffing).
 */
export function repointOpenBranches(branches: Branch[], newSpineVersionId: string): Branch[] {
    if (!branches.some(branch => isOpenBranch(branch) && branch.spineVersionId !== newSpineVersionId)) {
        return branches;
    }
    return branches.map(branch => (
        isOpenBranch(branch) && branch.spineVersionId !== newSpineVersionId
            ? { ...branch, spineVersionId: newSpineVersionId }
            : branch
    ));
}

/**
 * The project-keyed form used by the store: re-points one project's open
 * branches and returns the same map reference when nothing moved.
 */
export function repointProjectOpenBranches(
    branchesByProject: Record<string, Branch[]>,
    projectId: string,
    newSpineVersionId: string,
): Record<string, Branch[]> {
    const current = branchesByProject[projectId];
    if (!current) return branchesByProject;
    const next = repointOpenBranches(current, newSpineVersionId);
    return next === current ? branchesByProject : { ...branchesByProject, [projectId]: next };
}
