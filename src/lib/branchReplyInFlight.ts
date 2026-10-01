// Which branch replies have a live LLM request in THIS page load.
//
// A branch's `pendingReply` marker (Branch.pendingReply) is persisted, so it
// survives a reload — the request itself does not. A marker with no live
// request here therefore means the reply was interrupted (page reloaded or
// closed mid-request): the branch UI says so and restores the user's message
// into the input to send again — never re-sending automatically. A remounted
// branch list whose request IS still live keeps showing "typing" instead.
//
// Callers register the request BEFORE setting the marker and clear the marker
// BEFORE unregistering, so no render ever sees a live reply as interrupted.
// Module state: a page load starts with an empty registry by construction.

import type { Branch } from '../types';

const inFlight = new Set<string>();

export function beginBranchReplyRequest(branchId: string): void {
    inFlight.add(branchId);
}

export function endBranchReplyRequest(branchId: string): void {
    inFlight.delete(branchId);
}

export function isBranchReplyInFlight(branchId: string): boolean {
    return inFlight.has(branchId);
}

/** A reply marked pending with no live request in this page load was interrupted. */
export function isBranchReplyInterrupted(branch: Pick<Branch, 'id' | 'pendingReply'>): boolean {
    return !!branch.pendingReply && !inFlight.has(branch.id);
}
