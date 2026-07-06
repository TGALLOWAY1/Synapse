import type { CoreArtifactSubtype, StructuredPRD } from '../types';
import { getArtifactMeta, getRequiredDependencies } from './coreArtifactPipeline';
import { parseScreenInventory, screenInventoryToMarkdown } from './screenInventoryNormalize';

const DEPENDENCY_PROSE_BUDGET = 1400;

const GENERIC_PHRASES = [
    'user-friendly interface',
    'scalable architecture',
    'seamless experience',
    'best practices',
    'industry standard',
];

export function buildFeatureGlossary(prd: StructuredPRD): string {
    return prd.features
        .map(feature => `- ${feature.id}: ${feature.name} — ${feature.description}`)
        .join('\n');
}

export function buildDependencyContext(
    subtype: CoreArtifactSubtype,
    generatedArtifacts: Partial<Record<CoreArtifactSubtype, string>>,
): string {
    const dependencies = getArtifactMeta(subtype).dependsOn;
    if (dependencies.length === 0) return 'No dependency artifacts available yet.';

    const requiredDeps = new Set(getRequiredDependencies(subtype));

    const slices = dependencies
        .map(dep => {
            const isRequired = requiredDeps.has(dep);
            const label = isRequired ? `### ${dep} (REQUIRED)` : `### ${dep}`;
            const depContent = generatedArtifacts[dep];
            if (!depContent || !depContent.trim()) {
                // Never present a required dependency's absence as a soft
                // "Not generated yet." — make it explicit so the model (and any
                // reviewer) knows the output is degraded.
                return isRequired
                    ? `${label}\n**MISSING — this required dependency was unavailable at generation time. Output may be incomplete or invented; treat with caution.**`
                    : `${label}\nNot generated yet.`;
            }
            // Screen inventory is persisted as JSON. Render a human-readable
            // summary that lists ALL screen ids/names first (never truncated),
            // then the truncated per-screen prose — so downstream artifacts
            // always see the complete screen roster even when detail is cut.
            const text = dep === 'screen_inventory'
                ? summarizeScreenInventoryDependency(depContent, DEPENDENCY_PROSE_BUDGET)
                : depContent.slice(0, DEPENDENCY_PROSE_BUDGET);
            return `${label}\n${text}`;
        })
        .join('\n\n');

    return slices;
}

// Build a dependency summary of a screen inventory that guarantees every screen
// id/name survives truncation. The compact roster (one line per screen) is
// emitted in full first; the verbose per-screen markdown is then appended up to
// `proseBudget` chars. A downstream artifact (user_flows, implementation_plan)
// therefore never loses a screen reference just because the prose was long.
export function summarizeScreenInventoryDependency(content: string, proseBudget: number): string {
    const parsed = parseScreenInventory(content);
    if (!parsed) return content.slice(0, proseBudget);

    const screens = parsed.sections.flatMap(s => s.screens);
    const roster = screens
        .map(s => `- ${s.id ?? ''}${s.id ? ': ' : ''}${s.name}`)
        .join('\n');
    const rosterBlock = `Screens (${screens.length}):\n${roster}`;

    const prose = screenInventoryToMarkdown(parsed);
    const truncatedProse = prose.length > proseBudget
        ? `${prose.slice(0, proseBudget)}\n…(detail truncated; full screen roster listed above)`
        : prose;

    return `${rosterBlock}\n\n${truncatedProse}`;
}

export function buildNarrativeGuardrails(prd: StructuredPRD): string {
    return [
        'Output requirements:',
        '- Use formal, professional, implementation-ready language. Do not use marketing language, hype, or subjective descriptors such as "powerful", "seamless", "cutting-edge", or "modern stack".',
        '- Do not hedge. Prohibited phrasings include "you could", "might be", "a good option is", and "something like". State definitive decisions, or state an explicit assumption when information is missing.',
        '- Justify technical recommendations with concrete reasoning (scalability, maintainability, ecosystem maturity, or performance). Prefer widely adopted, stable technologies unless the PRD specifies otherwise.',
        `- Keep terminology consistent with feature IDs (${prd.features.map(f => f.id).join(', ')}).`,
        '- Reuse exact screen/entity names once introduced.',
        '- Include explicit traceability to PRD features in every major section.',
        '- Prefer concrete constraints over generic advice. Produce no filler or redundant explanation.',
    ].join('\n');
}

export function normalizeArtifactMarkdown(content: string): string {
    let normalized = content
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // Strip any conversational preamble before the first markdown heading.
    // All core artifact templates emit `#`/`##`/`###` headings as their first content line, so
    // anything before that is an LLM lead-in ("Of course!", "Here are...", etc).
    const firstHeadingMatch = normalized.match(/^#{1,6}\s.+/m);
    if (firstHeadingMatch && firstHeadingMatch.index !== undefined && firstHeadingMatch.index > 0) {
        normalized = normalized.slice(firstHeadingMatch.index).trim();
    }

    return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

export function validateCrossArtifactConsistency(
    subtype: CoreArtifactSubtype,
    content: string,
    prd: StructuredPRD,
): string[] {
    const warnings: string[] = [];
    const lc = content.toLowerCase();

    const missingFeatureMentions = prd.features
        .filter(feature => !lc.includes(feature.id.toLowerCase()) && !lc.includes(feature.name.toLowerCase()))
        .map(feature => `${feature.id} (${feature.name})`);

    if (missingFeatureMentions.length > Math.max(1, Math.floor(prd.features.length * 0.5))) {
        warnings.push(`Weak PRD traceability: many features are absent (${missingFeatureMentions.slice(0, 4).join(', ')}).`);
    }

    const genericHits = GENERIC_PHRASES.filter(phrase => lc.includes(phrase));
    if (genericHits.length >= 2) {
        warnings.push(`Output includes generic language (${genericHits.join(', ')}).`);
    }

    if (subtype === 'data_model' && !lc.includes('api endpoints')) {
        warnings.push('Data model is missing explicit API surface mapping.');
    }

    if (subtype === 'user_flows' && !lc.includes('error')) {
        warnings.push('User flows do not clearly include error paths.');
    }

    return warnings;
}
