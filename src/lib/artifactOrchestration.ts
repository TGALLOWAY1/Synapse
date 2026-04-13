import type { CoreArtifactSubtype, StructuredPRD } from '../types';
import { getArtifactMeta } from './coreArtifactPipeline';

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

    const slices = dependencies
        .map(dep => {
            const depContent = generatedArtifacts[dep];
            if (!depContent) return `### ${dep}\nNot generated yet.`;
            return `### ${dep}\n${depContent.slice(0, 1400)}`;
        })
        .join('\n\n');

    return slices;
}

export function buildNarrativeGuardrails(prd: StructuredPRD): string {
    return [
        'Narrative requirements:',
        `- Keep terminology consistent with feature IDs (${prd.features.map(f => f.id).join(', ')}).`,
        '- Reuse exact screen/entity names once introduced.',
        '- Include explicit traceability to PRD features in every major section.',
        '- Prefer concrete constraints over generic advice.',
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
