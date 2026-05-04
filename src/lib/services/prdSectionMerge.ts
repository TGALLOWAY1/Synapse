import type { StructuredPRD } from '../../types';
import { DEFAULT_PRD_SECTIONS } from './progressivePrdGeneration';
import { repairTruncatedJson } from '../jsonRepair';

export type SectionResults = Record<string, { value: Partial<StructuredPRD> | null; ok: boolean }>;

/**
 * Convert the raw results dict from `generateProgressivePrd` into the
 * `SectionResults` shape, parsing JSON strings if needed and applying
 * truncation repair.
 */
export const parseSectionResults = (
    raw: Record<string, Partial<StructuredPRD> | null>,
): SectionResults => {
    const out: SectionResults = {};
    for (const [id, val] of Object.entries(raw)) {
        if (val === null) {
            out[id] = { value: null, ok: false };
            continue;
        }
        if (typeof val === 'string') {
            // Provider returned a raw JSON string — parse with truncation repair.
            try {
                out[id] = { value: JSON.parse(val) as Partial<StructuredPRD>, ok: true };
            } catch {
                const { text, repaired } = repairTruncatedJson(val);
                if (repaired) {
                    try {
                        out[id] = { value: JSON.parse(text) as Partial<StructuredPRD>, ok: true };
                        console.warn(`[prd-merge] section "${id}" repaired via JSON truncation fix`);
                    } catch {
                        out[id] = { value: null, ok: false };
                    }
                } else {
                    out[id] = { value: null, ok: false };
                }
            }
        } else {
            // Already an object (normal path — provider returned parsed JSON).
            out[id] = { value: val, ok: true };
        }
    }
    return out;
};

/**
 * Merge per-section results into a single StructuredPRD. Sections are applied
 * in topological order (dependency-first) so later sections overwrite only
 * fields they own. Required fields that are still missing after merge get
 * empty stubs so the renderer never crashes on a partial result.
 */
export const mergeSectionsToStructuredPrd = (results: SectionResults): StructuredPRD => {
    const out: Partial<StructuredPRD> = {};

    for (const section of DEFAULT_PRD_SECTIONS) {
        const r = results[section.id];
        if (r?.value) Object.assign(out, r.value);
    }

    // Guarantee fields that the markdown renderer always references. If a
    // section errors and we don't stub these, the renderer interpolates
    // `undefined` directly into the rendered markdown ("## Architecture\n\nundefined")
    // which is user-visible corruption.
    if (!out.vision) out.vision = '';
    if (!out.targetUsers) out.targetUsers = [];
    if (!out.coreProblem) out.coreProblem = '';
    if (!out.features) out.features = [];
    if (!out.architecture) out.architecture = '';
    if (!out.risks) out.risks = [];
    if (!out.nonFunctionalRequirements) out.nonFunctionalRequirements = [];
    if (!out.constraints) out.constraints = [];
    if (!out.domainEntities) out.domainEntities = [];
    if (!out.primaryActions) out.primaryActions = [];

    return out as StructuredPRD;
};
