// Pure helpers for the staged-edits (batch consolidation) flow.
//
// Users can queue several branch refinements as "staged" edits and apply them
// together as ONE new spine version — reconciled together rather than each in
// isolation, producing one meaningful history entry instead of N. The sequential
// apply reuses the fail-closed `applyAnchorEditToStructuredPRD` so structure and
// feature ids stay intact.

import type { Branch, StructuredPRD } from '../types';
import { applyAnchorEditToStructuredPRD } from './structuredPrdAnchorEdit';

/** Marker the branch prompts emit before a concrete replacement. */
const REPLACEMENT_MARKER = 'suggested replacement for selected text:';

/**
 * Extract the concrete replacement text an assistant reply proposes, from the
 * `Suggested replacement for selected text:` block the edit-action prompts
 * emit. Returns the trimmed replacement, or null when the reply has no such
 * block (e.g. a Clarify answer that only asks a question).
 */
export const extractProposedReplacement = (assistantContent: string): string | null => {
    if (!assistantContent) return null;
    const lower = assistantContent.toLowerCase();
    const markerIndex = lower.lastIndexOf(REPLACEMENT_MARKER);
    if (markerIndex < 0) return null;
    const after = assistantContent.slice(markerIndex + REPLACEMENT_MARKER.length).trim();
    return after.length > 0 ? after : null;
};

/** A staged edit ready to apply: which branch, its anchor, and the replacement. */
export interface StagedEdit {
    branchId: string;
    anchorText: string;
    replacement: string;
}

export type SkippedEditReason = 'not_found' | 'ambiguous' | 'empty';

export interface ApplyStagedEditsResult {
    /** The PRD with every applicable edit applied in sequence. */
    structuredPRD: StructuredPRD;
    /** Branch ids whose edit was applied. */
    applied: string[];
    /** Edits that could not be applied cleanly, with the reason. */
    skipped: { branchId: string; reason: SkippedEditReason }[];
}

/**
 * Apply staged edits to a structured PRD one after another. Each edit is applied
 * against the result of the previous one, so if an earlier replacement changes
 * the text a later anchor no longer resolves uniquely, that later edit is
 * *skipped and reported* (never silently dropped) while the rest still apply.
 */
export const applyStagedEditsToStructuredPRD = (
    structuredPRD: StructuredPRD,
    edits: StagedEdit[],
): ApplyStagedEditsResult => {
    let working = structuredPRD;
    const applied: string[] = [];
    const skipped: ApplyStagedEditsResult['skipped'] = [];

    for (const edit of edits) {
        if (!edit.replacement.trim()) {
            skipped.push({ branchId: edit.branchId, reason: 'empty' });
            continue;
        }
        const result = applyAnchorEditToStructuredPRD(working, edit.anchorText, edit.replacement);
        if (result.applied) {
            working = result.structuredPRD;
            applied.push(edit.branchId);
        } else {
            skipped.push({ branchId: edit.branchId, reason: result.reason });
        }
    }

    return { structuredPRD: working, applied, skipped };
};

/** The staged (`'resolved'`) branches for a spine that carry a replacement. */
export const getStagedEdits = (branches: Branch[]): StagedEdit[] =>
    branches
        .filter(b => b.status === 'resolved' && typeof b.proposedReplacement === 'string')
        .map(b => ({
            branchId: b.id,
            anchorText: b.anchorText,
            replacement: b.proposedReplacement as string,
        }));
