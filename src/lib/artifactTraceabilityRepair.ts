// Automatic traceability repair/enrichment for artifacts that are structurally
// valid and clearly project-specific but do not *explicitly* reference the PRD's
// features by canonical id or name.
//
// Context: `detectArtifactBlockers` (artifactBlockingValidation.ts) flags an
// implementation-critical artifact as `needs_review` when it references NONE of
// the PRD features. That text-search is deliberately strict — but the generator
// is not always required to spell out a feature id/name verbatim, so a useful,
// on-topic Data Model or set of User Flows can trip the blocker even though the
// content is genuinely derived from the product's features. Rather than surface
// a scary blocking banner immediately, Synapse first attempts a high-confidence,
// deterministic repair: match the canonical PRD features to the artifact's own
// content and, when confident matches exist, append an explicit
// "PRD Feature Traceability" section citing the mapped feature ids/names.
//
// This module is pure (no store / React / LLM). Repair is deterministic and can
// NEVER invent a feature id — every mapped id/name comes from `prd.features`.

import type { CoreArtifactSubtype, StructuredPRD } from '../types';

/** A canonical PRD feature that was confidently matched to artifact content. */
export interface FeatureMatch {
    /** Canonical PRD feature id (always from prd.features — never invented). */
    featureId: string;
    /** Canonical PRD feature name. */
    featureName: string;
    /** Human-readable justification for the mapping (which tokens matched). */
    reason: string;
    /** Internal relevance score (higher = stronger match). */
    score: number;
}

export interface TraceabilityRepairResult {
    /** Whether the content was modified (a traceability section was appended). */
    repaired: boolean;
    /** The (possibly enriched) artifact content. */
    content: string;
    /** Features the repair mapped to this artifact. */
    mappedFeatures: FeatureMatch[];
    /** Non-fatal notes about the repair (e.g. why it could not proceed). */
    warnings: string[];
}

// Very common English + product words that carry little discriminating signal.
// Kept deliberately small: over-filtering would drop legitimate feature tokens.
const STOPWORDS = new Set<string>([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'over', 'your',
    'user', 'users', 'data', 'system', 'systems', 'page', 'pages', 'screen',
    'screens', 'view', 'views', 'feature', 'features', 'app', 'apps',
    'application', 'applications', 'product', 'products', 'service', 'services',
    'management', 'support', 'enable', 'enables', 'allow', 'allows', 'provide',
    'provides', 'using', 'based', 'able', 'when', 'where', 'their', 'them',
    'they', 'will', 'must', 'should', 'each', 'other', 'more', 'have', 'has',
]);

const TOKEN_RE = /[a-z0-9]+/g;

/** Extract discriminating lowercase tokens (len ≥ 4, non-stopword) from text. */
function significantTokens(text: string | undefined): string[] {
    if (!text) return [];
    const out = new Set<string>();
    for (const m of text.toLowerCase().matchAll(TOKEN_RE)) {
        const tok = m[0];
        if (tok.length >= 4 && !STOPWORDS.has(tok)) out.add(tok);
    }
    return [...out];
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Filter a list of feature ids down to those that actually exist in the
 * canonical PRD. Used to reject invented ids (e.g. from an LLM enrichment pass)
 * before they are ever stamped onto an artifact. Case-insensitive.
 */
export function filterKnownFeatureIds(ids: string[], prd: StructuredPRD): string[] {
    const known = new Map((prd.features ?? []).map(f => [f.id.toLowerCase(), f.id]));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of ids) {
        const canonical = known.get(String(id).toLowerCase());
        if (canonical && !seen.has(canonical)) {
            seen.add(canonical);
            out.push(canonical);
        }
    }
    return out;
}

/**
 * Deterministically match the PRD's canonical features to the artifact's own
 * content. A feature matches when the content already names it, or when enough
 * of its discriminating name/description tokens appear in the content to be
 * confident the artifact is derived from that feature. Never invents ids.
 */
export function matchFeaturesToContent(content: string, prd: StructuredPRD): FeatureMatch[] {
    const contentLc = content.toLowerCase();
    const features = prd.features ?? [];
    const matches: FeatureMatch[] = [];

    for (const f of features) {
        if (!f?.id) continue;
        const name = (f.name ?? '').trim();

        // Direct reference: id (word-bounded) or the full feature name.
        const idHit = new RegExp(`\\b${escapeRegExp(f.id)}\\b`, 'i').test(content);
        const nameHit = name.length > 0 && contentLc.includes(name.toLowerCase());
        if (idHit || nameHit) {
            matches.push({
                featureId: f.id,
                featureName: name || f.id,
                reason: idHit
                    ? `Content references feature id ${f.id}.`
                    : `Content references the feature name "${name}".`,
                score: 100,
            });
            continue;
        }

        // Token-overlap match. Require corroborating name-token coverage so a
        // stray description word alone can't map an unrelated feature.
        const nameTokens = significantTokens(name);
        const descText = [
            f.description,
            f.userValue,
            ...(f.acceptanceCriteria ?? []),
        ]
            .filter(Boolean)
            .join(' ');
        const descTokens = significantTokens(descText).filter(t => !nameTokens.includes(t));

        const matchedName = nameTokens.filter(t => contentLc.includes(t));
        const matchedDesc = descTokens.filter(t => contentLc.includes(t));

        // Confidence: at least one name token present AND either half of the
        // name tokens matched, or a name token plus a corroborating desc token.
        const nameCoverageOk =
            matchedName.length > 0 &&
            (matchedName.length >= Math.ceil(nameTokens.length / 2) ||
                matchedName.length + matchedDesc.length >= 2);

        if (nameCoverageOk) {
            const matchedTerms = [...new Set([...matchedName, ...matchedDesc])];
            matches.push({
                featureId: f.id,
                featureName: name || f.id,
                reason: `Automatically matched via: ${matchedTerms.join(', ')}.`,
                score: matchedName.length * 2 + matchedDesc.length,
            });
        }
    }

    return matches.sort((a, b) => b.score - a.score);
}

/** Heading Synapse uses for the appended traceability block. */
export const TRACEABILITY_SECTION_HEADING = 'PRD Feature Traceability';

function renderTraceabilitySection(matches: FeatureMatch[]): string {
    const lines: string[] = [
        `## ${TRACEABILITY_SECTION_HEADING}`,
        '',
        '_Synapse mapped this artifact back to the following PRD features automatically. ' +
            'Feature IDs and names are drawn from the canonical PRD._',
        '',
    ];
    for (const m of matches) {
        lines.push(`- **[${m.featureId}] ${m.featureName}** — ${m.reason}`);
    }
    return lines.join('\n');
}

/**
 * Attempt a deterministic traceability-enrichment repair. When the artifact's
 * own content confidently maps to one or more canonical PRD features, append an
 * explicit traceability section (which restores id/name references and clears
 * the traceability blocker). Content is only ever *appended to* — no substantive
 * content is rewritten, so the artifact's meaning is preserved.
 */
export function repairTraceability(
    _subtype: CoreArtifactSubtype,
    content: string,
    prd: StructuredPRD,
): TraceabilityRepairResult {
    if (!prd.features || prd.features.length === 0) {
        return {
            repaired: false,
            content,
            mappedFeatures: [],
            warnings: ['PRD has no features to trace to.'],
        };
    }

    const matches = matchFeaturesToContent(content, prd);
    if (matches.length === 0) {
        return {
            repaired: false,
            content,
            mappedFeatures: [],
            warnings: [
                'No PRD feature could be confidently matched to this artifact by automatic analysis.',
            ],
        };
    }

    const section = renderTraceabilitySection(matches);
    const enriched = `${content.replace(/\s+$/, '')}\n\n${section}\n`;
    return { repaired: true, content: enriched, mappedFeatures: matches, warnings: [] };
}
