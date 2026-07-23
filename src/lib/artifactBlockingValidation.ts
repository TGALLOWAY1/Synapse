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

import type {
    ArtifactValidationBlocker,
    CoreArtifactSubtype,
    StructuredPRD,
} from '../types';
import { parseScreenInventory } from './screenInventoryNormalize';
import { parseDataModelMarkdown } from './services/dataModelMarkdown';
import { parseComponentInventoryMarkdown } from './componentInventoryParse';
import { readArtifactValidationBlockers } from './artifactValidationPolicy';

// Implementation-critical artifacts whose complete lack of PRD-feature
// traceability is a blocking defect (they drive build work and must map back
// to real product features).
const TRACEABILITY_CRITICAL: ReadonlySet<CoreArtifactSubtype> = new Set<CoreArtifactSubtype>([
    'data_model',
    'user_flows',
    'implementation_plan',
]);

export const TRACEABILITY_BLOCKER: ArtifactValidationBlocker = {
    code: 'prd_traceability_unverified',
    message: 'Artifact references none of the PRD features — no traceability to the PRD.',
};

// User-facing wording shown when automatic traceability repair was attempted
// and could not confidently map the artifact to any PRD feature. Deliberately
// less alarming than the raw blocker — the content may still be useful.
export const TRACEABILITY_UNRESOLVED_MESSAGE =
    'Synapse could not verify how this artifact maps back to the PRD (automatic ' +
    'traceability repair found no confident feature match). The content is preserved for review.';

/** True when the blocker is the missing-traceability defect (repair-eligible). */
export const isTraceabilityBlocker = (blocker: ArtifactValidationBlocker): boolean =>
    blocker.code === 'prd_traceability_unverified';

/**
 * Split a blocker list into traceability-only vs. everything else. A blocker set
 * is eligible for automatic traceability repair only when the traceability
 * blocker is the SOLE issue (the artifact is otherwise structurally valid).
 */
export function classifyBlockers(blockers: ArtifactValidationBlocker[]): {
    traceabilityBlockers: ArtifactValidationBlocker[];
    otherBlockers: ArtifactValidationBlocker[];
} {
    const traceabilityBlockers: ArtifactValidationBlocker[] = [];
    const otherBlockers: ArtifactValidationBlocker[] = [];
    for (const b of blockers) {
        (isTraceabilityBlocker(b) ? traceabilityBlockers : otherBlockers).push(b);
    }
    return { traceabilityBlockers, otherBlockers };
}

export function detectArtifactBlockers(
    subtype: CoreArtifactSubtype,
    content: string,
    prd: StructuredPRD,
): ArtifactValidationBlocker[] {
    const blockers: ArtifactValidationBlocker[] = [];
    const lc = content.toLowerCase();

    // (1) A data model without an API surface can't be built against.
    if (subtype === 'data_model' && !lc.includes('api endpoint')) {
        blockers.push({
            code: 'data_model_api_surface_missing',
            message: 'Data model is missing an explicit API surface mapping (no API endpoints).',
        });
    }

    // (2) User flows that never mention error handling omit critical paths.
    if (subtype === 'user_flows' && !lc.includes('error')) {
        blockers.push({
            code: 'user_flows_error_paths_missing',
            message: 'User flows do not include any error paths.',
        });
    }

    // (3) An implementation-critical artifact that references none of the PRD's
    // features has no traceability back to the product decision document.
    if (TRACEABILITY_CRITICAL.has(subtype) && prd.features.length > 0) {
        const referenced = prd.features.some(
            f => lc.includes(f.id.toLowerCase()) || lc.includes(f.name.toLowerCase()),
        );
        if (!referenced) {
            blockers.push(TRACEABILITY_BLOCKER);
        }
    }

    // (4) Structured-output artifacts that cannot be parsed or parse without
    // substantive content. These are never overridable.
    const structureBlocker = detectStructureBlocker(subtype, content);
    if (structureBlocker) blockers.push(structureBlocker);

    return blockers;
}

// Read the blocking-validation issues stamped onto an artifact version's
// metadata. Durable across reload (metadata persists), unlike the transient
// slot status. Returns [] when the version is clean or from a legacy artifact.
export function readValidationBlockers(metadata: Record<string, unknown> | undefined): string[] {
    return readArtifactValidationBlockers(metadata).map(blocker => blocker.message);
}

function detectStructureBlocker(
    subtype: CoreArtifactSubtype,
    content: string,
): ArtifactValidationBlocker | null {
    if (subtype === 'screen_inventory') {
        const parsed = parseScreenInventory(content);
        if (!parsed) {
            return {
                code: 'output_unparseable',
                message: 'Screen inventory could not be parsed as generated structured output.',
            };
        }
        if (parsed.sections.flatMap(s => s.screens).length === 0) {
            return {
                code: 'output_structure_incomplete',
                message: 'Screen inventory parsed but contains no screens.',
            };
        }
    }
    if (subtype === 'data_model') {
        const parsed = parseDataModelMarkdown(content);
        if (!parsed) {
            return {
                code: 'output_unparseable',
                message: 'Data model could not be parsed as generated structured output.',
            };
        }
        if (parsed.entities.length === 0) {
            return {
                code: 'output_structure_incomplete',
                message: 'Data model parsed but contains no entities.',
            };
        }
    }
    if (subtype === 'component_inventory') {
        const parsed = parseComponentInventoryMarkdown(content);
        if (!parsed) {
            return {
                code: 'output_unparseable',
                message: 'Component inventory could not be parsed as generated structured output.',
            };
        }
        if (parsed.categories.every(c => c.components.length === 0)) {
            return {
                code: 'output_structure_incomplete',
                message: 'Component inventory parsed but contains no components.',
            };
        }
    }
    return null;
}
