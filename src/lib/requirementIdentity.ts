/**
 * Derived requirement / acceptance-criterion identity — the W1 substrate of
 * docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md.
 *
 * Everything here is PURE and read-time only: no store, no React, no LLM, no
 * persistence. Ids are a function of PRD content, recomputed on read.
 * Persisting them would require `ALL_PROJECT_COLLECTIONS` + snapshot + sync +
 * demo-cleanup wiring (cross-cutting rule 6) for a value that derives at zero
 * cost — and derivation means legacy projects gain traceability with no
 * migration (rule 10: read-side layers are derived, never persisted).
 *
 * Identity model:
 * - `RequirementId` IS the existing `Feature.id` — reused, never a parallel
 *   id scheme.
 * - `CriterionId` = `${featureId}.AC.${hash8(normalize(text))}` — derived from
 *   the criterion's NORMALIZED text, never its array position. Reordering a
 *   feature's criteria changes no id; rewording one criterion changes exactly
 *   that one id. The reword-changes-id behavior is deliberate: a reworded
 *   criterion is a different criterion, and the id delta is exactly the drift
 *   signal downstream consumers want.
 * - `resolveCriterionRefs` maps criterion prose quoted in screens, tasks, and
 *   plan Definition-of-Done lines back to canonical ids with an honest
 *   confidence label. `unmatched` is a first-class result — reported as "not
 *   traced to a PRD criterion", never silently dropped, never auto-rewritten.
 *
 * This layer is advisory. Nothing gates rendering or generation on it.
 * Consumers land in later plan workstreams (W3 API-contract `requirementIds`,
 * W6 build-packet coverage, W7 Final Review).
 */

import type { Feature } from '../types';

// --- Public id types ---------------------------------------------------------

/** A requirement's stable id — always the existing `Feature.id`. */
export type RequirementId = string;

/** `${featureId}.AC.${hash8(normalizedText)}` — see `criterionIdFor`. */
export type CriterionId = string;

/** Which Feature list a criterion came from. The id deliberately does NOT
 * encode the kind: a criterion moving between lists (e.g. a legacy
 * `acceptanceCriteria` entry promoted to premium `successCriteria`) keeps
 * its id as long as its text is unchanged. */
export type CriterionKind =
    | 'acceptance'      // Feature.acceptanceCriteria
    | 'success'         // Feature.successCriteria
    | 'edge_case'       // Feature.edgeCases
    | 'failure_mode'    // Feature.failureModes
    | 'ui';             // Feature.uiAcceptanceCriteria

export interface CriterionEntry {
    id: CriterionId;
    requirementId: RequirementId;
    kind: CriterionKind;
    /** Original criterion text as authored (trimmed only). */
    text: string;
    /** Output of `normalizeCriterionText(text)` — the hash input. */
    normalizedText: string;
    /** Content-word token set derived from `normalizedText`; used by the
     * fuzzy match tier. Derived detail — do not persist or display. */
    tokens: ReadonlySet<string>;
}

export interface RequirementEntry {
    id: RequirementId;
    name: string;
    /** This requirement's criteria in encounter order (may be empty — a
     * criterion-less feature still yields a RequirementId). */
    criteria: readonly CriterionEntry[];
}

export interface RequirementIndex {
    /** One entry per source feature, in PRD order. */
    requirements: readonly RequirementEntry[];
    /** All criteria across all requirements, in encounter order. */
    criteria: readonly CriterionEntry[];
    byCriterionId: ReadonlyMap<CriterionId, CriterionEntry>;
    /** Normalized text → entries. The same text under two features yields two
     * entries (ids are feature-scoped); resolution picks the earliest in PRD
     * order, deterministically. */
    byNormalizedText: ReadonlyMap<string, readonly CriterionEntry[]>;
}

/** The slice of `Feature` this module reads — a full `StructuredPRD` (or any
 * `Feature[]` carrier) is assignable. Designed against the real Feature shape
 * in `src/types/index.ts`; all five criterion lists the PRD markdown renderer
 * emits as "Acceptance criteria — …" groups are indexed, because downstream
 * artifacts quote from whichever group the rendered PRD showed. */
export type RequirementIdentityFeature = Pick<
    Feature,
    | 'id'
    | 'name'
    | 'acceptanceCriteria'
    | 'successCriteria'
    | 'edgeCases'
    | 'failureModes'
    | 'uiAcceptanceCriteria'
>;

export interface RequirementIdentitySource {
    features: readonly RequirementIdentityFeature[];
}

// --- Normalization -----------------------------------------------------------

/**
 * Canonical text normalization backing `CriterionId`. Conservative on
 * purpose: it removes transport decoration (markdown bullets/checkboxes,
 * emphasis markers, curly quotes, whitespace runs, trailing punctuation,
 * wrapping quotes) and case — the variations observed in how criteria travel
 * through `prdMarkdownRenderer`, `implementationPlanAdapter` DoD bullets, and
 * `taskExtractor` — but never reorders, stems, or drops words. Two texts
 * normalize equal only when they are the same sentence up to decoration.
 */
export function normalizeCriterionText(text: string): string {
    return text
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, '-')
        // Markdown bullet then optional checkbox: "- [ ] text" / "* text".
        .replace(/^\s*[-*+]\s+/, '')
        .replace(/^\s*\[\s*[xX ]?\s*\]\s*/, '')
        // Emphasis / code markers wrap words tightly; strip the markers.
        .replace(/[*`]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
        // Wrapping quotes and trailing punctuation, in either order ('."'
        // and '".' both collapse). Consistency matters here, not prettiness:
        // both sides of a comparison normalize identically.
        .replace(/^["']+/, '')
        .replace(/["'.;:!]+$/, '')
        .trim();
}

// --- Hashing -----------------------------------------------------------------

/** FNV-1a 32-bit as 8 lowercase hex chars. Deterministic and dependency-free
 * — same self-contained pattern as `review/hash.ts` / `designTokens/hash.ts`
 * / `mockupVariantTrust.ts` (pure modules deliberately carry their own copy).
 * No timestamps, no randomness: the id is a pure function of its input. */
function hash8(input: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/** Canonical criterion id: `${featureId}.AC.${hash8(normalize(text))}`.
 * Position-independent by construction. */
export function criterionIdFor(featureId: RequirementId, text: string): CriterionId {
    return `${featureId}.AC.${hash8(normalizeCriterionText(text))}`;
}

// --- Index builder -----------------------------------------------------------

const CRITERION_LISTS: ReadonlyArray<
    [CriterionKind, (f: RequirementIdentityFeature) => string[] | undefined]
> = [
    ['acceptance', f => f.acceptanceCriteria],
    ['success', f => f.successCriteria],
    ['edge_case', f => f.edgeCases],
    ['failure_mode', f => f.failureModes],
    ['ui', f => f.uiAcceptanceCriteria],
];

/** Index a structured PRD's features and criteria for id lookup and
 * reference resolution. Pure; call with `buildRequirementIndex(structuredPrd)`
 * or any `{ features }` carrier. Blank criterion strings are skipped; within
 * one feature, texts that normalize identically dedupe to the first
 * occurrence (they would share an id by construction). */
export function buildRequirementIndex(source: RequirementIdentitySource): RequirementIndex {
    const requirements: RequirementEntry[] = [];
    const criteria: CriterionEntry[] = [];
    const byCriterionId = new Map<CriterionId, CriterionEntry>();
    const byNormalizedText = new Map<string, CriterionEntry[]>();

    for (const feature of source.features) {
        const featureCriteria: CriterionEntry[] = [];
        const seenNormalized = new Set<string>();
        for (const [kind, read] of CRITERION_LISTS) {
            for (const raw of read(feature) ?? []) {
                const text = raw.trim();
                if (!text) continue;
                const normalizedText = normalizeCriterionText(text);
                if (!normalizedText || seenNormalized.has(normalizedText)) continue;
                seenNormalized.add(normalizedText);
                const entry: CriterionEntry = {
                    id: criterionIdFor(feature.id, text),
                    requirementId: feature.id,
                    kind,
                    text,
                    normalizedText,
                    tokens: tokensOf(normalizedText),
                };
                featureCriteria.push(entry);
                criteria.push(entry);
                byCriterionId.set(entry.id, entry);
                const bucket = byNormalizedText.get(normalizedText);
                if (bucket) bucket.push(entry);
                else byNormalizedText.set(normalizedText, [entry]);
            }
        }
        requirements.push({ id: feature.id, name: feature.name, criteria: featureCriteria });
    }

    return { requirements, criteria, byCriterionId, byNormalizedText };
}

// --- Reference resolution ----------------------------------------------------

export type CriterionMatchConfidence = 'exact' | 'normalized' | 'fuzzy' | 'unmatched';

export type ResolvedCriterionRef =
    | {
        confidence: 'exact' | 'normalized' | 'fuzzy';
        id: CriterionId;
        requirementId: RequirementId;
        /** The input prose (trimmed), preserved for reporting. */
        text: string;
    }
    | {
        /** First-class state: report as "not traced to a PRD criterion".
         * Never silently dropped, never auto-rewritten to force a match. */
        confidence: 'unmatched';
        id: null;
        requirementId: null;
        text: string;
    };

// Function words and BDD scaffolding ("given/when/then") that carry no
// criterion content. Tokens shorter than MIN_TOKEN_LENGTH are dropped before
// this set is consulted, so two-letter words never appear here.
const STOPWORDS: ReadonlySet<string> = new Set([
    'the', 'and', 'for', 'are', 'was', 'were', 'been', 'being', 'has', 'had',
    'have', 'can', 'could', 'will', 'would', 'shall', 'should', 'must', 'may',
    'might', 'not', 'but', 'with', 'that', 'this', 'then', 'than', 'from',
    'into', 'out', 'when', 'where', 'which', 'while', 'all', 'any', 'each',
    'its', 'they', 'them', 'their', 'there', 'here', 'able', 'also', 'only',
    'such', 'some', 'more', 'most', 'very', 'upon', 'onto', 'after', 'before',
    'given', 'does', 'did', 'doing', 'you', 'your',
]);

const MIN_TOKEN_LENGTH = 3;

/** Content-word tokens of a normalized text. Trailing-'s' folding gives
 * cheap singular/plural and verb-s tolerance ("shows"/"show",
 * "reports"/"report") without a stemmer; both sides fold identically so the
 * fold never needs to be linguistically correct, only consistent. */
function tokensOf(normalized: string): ReadonlySet<string> {
    const out = new Set<string>();
    for (const raw of normalized.split(/[^a-z0-9]+/)) {
        if (raw.length < MIN_TOKEN_LENGTH || STOPWORDS.has(raw)) continue;
        const folded =
            raw.length > MIN_TOKEN_LENGTH && raw.endsWith('s') && !raw.endsWith('ss')
                ? raw.slice(0, -1)
                : raw;
        if (STOPWORDS.has(folded)) continue;
        out.add(folded);
    }
    return out;
}

// --- Fuzzy tier thresholds ---------------------------------------------------
// The fuzzy tier is deliberately conservative. Its job is to recover criteria
// that survived transport with light decoration — checkbox/bullet markers,
// an added lead-in clause, singular/plural drift, a re-cast sentence with the
// same content words — NOT to equate genuinely reworded criteria (a reword is
// a different criterion by design; it should surface as `unmatched` drift).
// A candidate matches only when ALL THREE hold:
//   1. shared content tokens >= MIN_SHARED_TOKENS (3). One notch stricter
//      than the >=2-shared-token matcher `implementationPlanAdapter` uses for
//      best-effort prompt<->milestone attachment, because a wrong criterion
//      link would feed coverage/traceability claims, where a false positive
//      is worse than an honest `unmatched`.
//   2. criterion coverage (shared / criterion tokens) >= 0.8 — at most ~one
//      content word of the canonical criterion may be absent from the ref, so
//      a ref that drops the criterion's object or qualifier fails.
//   3. ref coverage (shared / ref tokens) >= 0.5 — at least half the ref's
//      own content must come from the criterion, so a long DoD line that
//      merely mentions the same nouns in passing does not match.
// Ties resolve to the earliest criterion in PRD order (deterministic; the
// index preserves feature/criterion encounter order).
const MIN_SHARED_TOKENS = 3;
const MIN_CRITERION_COVERAGE = 0.8;
const MIN_REF_COVERAGE = 0.5;

function fuzzyMatch(refTokens: ReadonlySet<string>, index: RequirementIndex): CriterionEntry | null {
    if (refTokens.size === 0) return null;
    let best: CriterionEntry | null = null;
    let bestScore = 0;
    for (const entry of index.criteria) {
        if (entry.tokens.size === 0) continue;
        let shared = 0;
        for (const token of entry.tokens) {
            if (refTokens.has(token)) shared++;
        }
        if (shared < MIN_SHARED_TOKENS) continue;
        const criterionCoverage = shared / entry.tokens.size;
        const refCoverage = shared / refTokens.size;
        if (criterionCoverage < MIN_CRITERION_COVERAGE || refCoverage < MIN_REF_COVERAGE) continue;
        const score = criterionCoverage + refCoverage;
        if (score > bestScore) {
            best = entry;
            bestScore = score;
        }
    }
    return best;
}

/**
 * Resolve criterion prose found in a screen contract, an implementation
 * task, or a plan Definition-of-Done line back to its canonical
 * `CriterionId`. Tiers, strongest first:
 * - `exact`      — byte-identical to a criterion's authored text (trimmed).
 * - `normalized` — identical after `normalizeCriterionText` (decoration/case
 *                  differences only).
 * - `fuzzy`      — conservative token-overlap match; thresholds documented
 *                  above.
 * - `unmatched`  — no confident match. Always returned, never dropped;
 *                  consumers must report it ("not traced to a PRD
 *                  criterion"), not rewrite the ref to force a match.
 */
export function resolveCriterionRefs(text: string, index: RequirementIndex): ResolvedCriterionRef {
    const trimmed = text.trim();
    const unmatched: ResolvedCriterionRef = {
        confidence: 'unmatched', id: null, requirementId: null, text: trimmed,
    };
    if (!trimmed) return unmatched;

    const normalized = normalizeCriterionText(trimmed);
    if (normalized) {
        const bucket = index.byNormalizedText.get(normalized);
        if (bucket && bucket.length > 0) {
            // Raw equality implies normalized equality, so the exact tier is
            // fully contained in this bucket.
            const exact = bucket.find(entry => entry.text === trimmed);
            if (exact) {
                return { confidence: 'exact', id: exact.id, requirementId: exact.requirementId, text: trimmed };
            }
            const first = bucket[0];
            return { confidence: 'normalized', id: first.id, requirementId: first.requirementId, text: trimmed };
        }
        const fuzzy = fuzzyMatch(tokensOf(normalized), index);
        if (fuzzy) {
            return { confidence: 'fuzzy', id: fuzzy.id, requirementId: fuzzy.requirementId, text: trimmed };
        }
    }
    return unmatched;
}
