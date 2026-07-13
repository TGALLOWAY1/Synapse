import { canonicalSpineToPromptJson } from '../canonicalPrdSpine';
import { SPECIALIST_REGISTRY } from './specialists';
import type { ReviewContextManifest, ReviewSpecialistId } from './types';

const MAX_LOCATORS_PER_SOURCE = 40;
const MAX_LOCATOR_CHARS_PER_SOURCE = 40_000;

/**
 * Keep the prompt bounded without systematically hiding everything after the
 * first N sections. When a source is large, sample deterministically across its
 * complete ordered locator set, then respect a per-source character budget.
 */
function selectLocatorCoverage<T extends { excerpt: string }>(locators: T[]): T[] {
    if (locators.length === 0) return [];
    const candidateCount = Math.min(MAX_LOCATORS_PER_SOURCE, locators.length);
    const candidates = candidateCount === locators.length
        ? locators
        : Array.from({ length: candidateCount }, (_, index) =>
            locators[Math.round(index * (locators.length - 1) / (candidateCount - 1))],
        );
    const selected: T[] = [];
    let chars = 0;
    for (const locator of candidates) {
        if (selected.length > 0 && chars + locator.excerpt.length > MAX_LOCATOR_CHARS_PER_SOURCE) continue;
        selected.push(locator);
        chars += locator.excerpt.length;
    }
    return selected;
}

export function buildSpecialistPrompt(
    manifest: ReviewContextManifest,
    specialistId: ReviewSpecialistId,
    focus?: string,
): string {
    const specialist = SPECIALIST_REGISTRY[specialistId];
    const relevant = new Set(specialist.relevantArtifacts);
    const sources = manifest.sources.filter(source => source.sourceType === 'spine' || (source.artifactSubtype && relevant.has(source.artifactSubtype)));
    const sourceKeys = new Set(sources.map(source => source.sourceKey));
    const locatorIndex = sources.flatMap(source => selectLocatorCoverage(manifest.locators
        .filter(locator => locator.sourceKey === source.sourceKey))
        .map(locator => ({
            sourceKey: locator.sourceKey,
            locatorId: locator.id,
            path: locator.path,
            label: locator.label,
            excerpt: locator.excerpt,
            excerptHash: locator.excerptHash,
        })));

    return [
        `You are the ${specialist.label} specialist in an independent planning review.`,
        '',
        `Responsibility: ${specialist.responsibility}`,
        `Review goals:\n${specialist.goals.map(goal => `- ${goal}`).join('\n')}`,
        `Boundaries:\n${specialist.boundaries.map(boundary => `- ${boundary}`).join('\n')}`,
        '',
        'Review rules:',
        '- Actively test the plan, but never manufacture criticism. Zero findings is valid.',
        '- Distinguish definite contradictions, likely risks, missing information, subjective recommendations, optional improvements, and questions requiring user judgment.',
        '- Every finding must cite at least one supplied locator using its exact sourceKey, locatorId, path, and a verbatim excerpt from that locator.',
        '- If the needed information is absent, report missing information; do not invent a requirement or fact.',
        '- Explain the consequence and the concrete decision, clarification, or next action required.',
        '- Do not rewrite any artifact and do not represent a recommendation as user-approved.',
        '- Findings may only cite source keys listed below.',
        focus?.trim() ? `- User focus: ${focus.trim()}` : '- No additional user focus was supplied.',
        '',
        'Frozen review scope:',
        JSON.stringify({
            projectName: manifest.projectName,
            platform: manifest.platform,
            productCategory: manifest.productCategory,
            reviewedSpineVersionId: manifest.spineVersionId,
            contextSignature: manifest.contextSignature,
            constraints: manifest.constraints,
            safetyBoundaries: manifest.safetyBoundaries,
            availableArtifacts: manifest.availableArtifacts,
            missingArtifacts: manifest.missingArtifacts,
            inScopeSourceKeys: [...sourceKeys],
        }, null, 2),
        '',
        manifest.canonicalSpine
            ? `Canonical PRD Spine (authoritative for identity, features, constraints, and safety):\n${canonicalSpineToPromptJson(manifest.canonicalSpine)}`
            : 'Canonical PRD Spine: unavailable. Do not infer absent structured facts.',
        '',
        'Evidence locator index (the only admissible evidence):',
        JSON.stringify(locatorIndex, null, 2),
        '',
        'Return only the required JSON object. Keep findings concise and actionable.',
    ].join('\n');
}
