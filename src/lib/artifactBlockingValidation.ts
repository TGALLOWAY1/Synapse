// Blocking (vs advisory) artifact validation. Most validation signals are
// advisory — surfaced as warnings but never blocking. A narrow set of
// high-confidence, user-facing defects, however, mean the generated artifact
// must NOT be presented as a trustworthy, completed output: it is flagged
// needs_review instead. The content is still preserved (for review/debugging),
// but the slot does not read as a normal green "done".
//
// Blockers detected here (deliberately conservative):
//   1. data_model missing an explicit API surface mapping.
//   2. user_flows missing error paths.
//   3. implementation-critical artifacts with NO PRD-feature traceability.
//   4. JSON-mode artifacts that parse but are structurally empty.
//
// Pure and store-free so it is trivially unit-testable.

import type { CoreArtifactSubtype, StructuredPRD } from '../types';
import { parseScreenInventory } from './screenInventoryNormalize';
import { parseDataModelMarkdown } from './services/dataModelMarkdown';
import { parseComponentInventoryMarkdown } from './componentInventoryParse';

// Implementation-critical artifacts whose complete lack of PRD-feature
// traceability is a blocking defect (they drive build work and must map back
// to real product features).
const TRACEABILITY_CRITICAL: ReadonlySet<CoreArtifactSubtype> = new Set<CoreArtifactSubtype>([
    'data_model',
    'user_flows',
    'implementation_plan',
]);

export function detectArtifactBlockers(
    subtype: CoreArtifactSubtype,
    content: string,
    prd: StructuredPRD,
): string[] {
    const blockers: string[] = [];
    const lc = content.toLowerCase();

    // (1) A data model without an API surface can't be built against.
    if (subtype === 'data_model' && !lc.includes('api endpoint')) {
        blockers.push('Data model is missing an explicit API surface mapping (no API endpoints).');
    }

    // (2) User flows that never mention error handling omit critical paths.
    if (subtype === 'user_flows' && !lc.includes('error')) {
        blockers.push('User flows do not include any error paths.');
    }

    // (3) An implementation-critical artifact that references none of the PRD's
    // features has no traceability back to the product decision document.
    if (TRACEABILITY_CRITICAL.has(subtype) && prd.features.length > 0) {
        const referenced = prd.features.some(
            f => lc.includes(f.id.toLowerCase()) || lc.includes(f.name.toLowerCase()),
        );
        if (!referenced) {
            blockers.push('Artifact references none of the PRD features — no traceability to the PRD.');
        }
    }

    // (4) JSON-mode artifacts that parse but hold no substantive content.
    const emptyReason = detectStructurallyEmpty(subtype, content);
    if (emptyReason) blockers.push(emptyReason);

    return blockers;
}

// Read the blocking-validation issues stamped onto an artifact version's
// metadata. Durable across reload (metadata persists), unlike the transient
// slot status. Returns [] when the version is clean or from a legacy artifact.
export function readValidationBlockers(metadata: Record<string, unknown> | undefined): string[] {
    const raw = metadata?.validationBlockers;
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is string => typeof x === 'string');
}

function detectStructurallyEmpty(subtype: CoreArtifactSubtype, content: string): string | null {
    if (subtype === 'screen_inventory') {
        const parsed = parseScreenInventory(content);
        if (parsed && parsed.sections.flatMap(s => s.screens).length === 0) {
            return 'Screen inventory parsed but contains no screens.';
        }
    }
    if (subtype === 'data_model') {
        const parsed = parseDataModelMarkdown(content);
        if (parsed && parsed.entities.length === 0) {
            return 'Data model parsed but contains no entities.';
        }
    }
    if (subtype === 'component_inventory') {
        const parsed = parseComponentInventoryMarkdown(content);
        if (parsed && parsed.categories.every(c => c.components.length === 0)) {
            return 'Component inventory parsed but contains no components.';
        }
    }
    return null;
}
