import type { CoreArtifactSubtype, PersistedReviewContextManifest } from '../../types';
import { hashEvidenceExcerpt, hashReviewValue, normalizeEvidenceText, stableStringify } from './hash';
import type {
    BuildReviewManifestInput,
    ReviewContextManifest,
    ReviewManifestSource,
    ReviewSourceLocator,
    SpecialistEvidenceInput,
    VerifiedEvidenceRef,
} from './types';

const DEFAULT_ARTIFACTS: CoreArtifactSubtype[] = [
    'screen_inventory',
    'user_flows',
    'data_model',
    'implementation_plan',
    'design_system',
];
const MAX_LOCATOR_CHARS = 1_600;
const MIN_EVIDENCE_CHARS = 24;
const MIN_EVIDENCE_TOKENS = 3;
const MIN_WHOLE_LOCATOR_CHARS = 12;
const MIN_WHOLE_LOCATOR_TOKENS = 2;

function chunksOf(value: string): string[] {
    const normalized = normalizeEvidenceText(value);
    if (!normalized) return [];
    const chunks: string[] = [];
    let start = 0;
    while (start < normalized.length) {
        let end = Math.min(normalized.length, start + MAX_LOCATOR_CHARS);
        if (end < normalized.length) {
            const boundary = normalized.lastIndexOf(' ', end);
            if (boundary > start + Math.floor(MAX_LOCATOR_CHARS * 0.7)) end = boundary;
        }
        chunks.push(normalized.slice(start, end).trim());
        start = end;
        while (normalized[start] === ' ') start++;
    }
    return chunks.filter(Boolean);
}

function locatorId(sourceKey: string, path: string): string {
    return `loc-${hashReviewValue(`${sourceKey}:${path}`)}`;
}

function makeLocators(
    source: ReviewManifestSource,
    path: string,
    label: string,
    rawExcerpt: string,
): ReviewSourceLocator[] {
    const chunks = chunksOf(rawExcerpt);
    return chunks.map((excerpt, index) => {
        const chunkPath = chunks.length === 1 ? path : `${path}.chunk-${index + 1}`;
        return {
            id: locatorId(source.sourceKey, chunkPath),
            sourceKey: source.sourceKey,
            sourceType: source.sourceType,
            spineVersionId: source.spineVersionId,
            artifactId: source.artifactId,
            artifactVersionId: source.artifactVersionId,
            artifactSubtype: source.artifactSubtype,
            path: chunkPath,
            label: chunks.length === 1 ? label : `${label} (part ${index + 1} of ${chunks.length})`,
            excerpt,
            excerptHash: hashEvidenceExcerpt(excerpt),
        };
    });
}

function structuredPrdLocators(source: ReviewManifestSource, prd: BuildReviewManifestInput['spine']['structuredPRD']): ReviewSourceLocator[] {
    const locators: ReviewSourceLocator[] = [];
    const add = (path: string, label: string, value: unknown) => {
        if (value === undefined || value === null) return;
        const text = typeof value === 'string' ? value : stableStringify(value);
        locators.push(...makeLocators(source, path, label, text));
    };

    add('prd.vision', 'Vision', prd.vision);
    add('prd.coreProblem', 'Core problem', prd.coreProblem);
    add('prd.targetUsers', 'Target users', prd.targetUsers);
    add('prd.architecture', 'Architecture', prd.architecture);
    add('prd.constraints', 'Constraints', prd.constraints);
    add('prd.nonFunctionalRequirements', 'Non-functional requirements', prd.nonFunctionalRequirements);
    add('prd.assumptions', 'Assumptions', prd.assumptions);
    add('prd.risks', 'Risks', prd.risksDetailed ?? prd.risks);
    add('prd.mvpScope', 'MVP scope', prd.mvpScope);
    add('prd.successMetrics', 'Success metrics', prd.successMetrics);
    for (const feature of prd.features ?? []) {
        add(`prd.features.${feature.id}`, `Feature ${feature.id}: ${feature.name}`, feature);
    }
    for (const page of prd.uxPages ?? []) {
        const key = typeof page === 'object' && page && 'id' in page ? String(page.id) : String(locators.length);
        add(`prd.uxPages.${key}`, `UX page ${key}`, page);
    }
    for (const entity of prd.richDataModel?.entities ?? []) {
        add(`prd.entities.${entity.name}`, `Entity: ${entity.name}`, entity);
    }
    return locators;
}

function markdownLocators(source: ReviewManifestSource): ReviewSourceLocator[] {
    const lines = source.content.split(/\r?\n/);
    const sections: Array<{ heading: string; start: number; body: string[] }> = [];
    let current = { heading: source.label, start: 1, body: [] as string[] };
    for (let index = 0; index < lines.length; index++) {
        const match = lines[index].match(/^#{1,6}\s+(.+?)\s*$/);
        if (match) {
            if (current.body.some(line => line.trim())) sections.push(current);
            current = { heading: match[1].trim(), start: index + 1, body: [lines[index]] };
        } else {
            current.body.push(lines[index]);
        }
    }
    if (current.body.some(line => line.trim())) sections.push(current);

    return sections.flatMap((section, index) => {
        const path = `section.${index + 1}.line-${section.start}`;
        return makeLocators(source, path, section.heading, section.body.join('\n'));
    });
}

export function buildReviewContextManifest(input: BuildReviewManifestInput): ReviewContextManifest {
    const spineSource: ReviewManifestSource = {
        sourceKey: `spine:${input.spine.versionId}`,
        sourceType: 'spine',
        label: 'Product Requirements Document',
        content: input.spine.content,
        contentHash: hashReviewValue(input.spine.content),
        spineVersionId: input.spine.versionId,
    };
    const artifactSources: ReviewManifestSource[] = input.artifacts
        .slice()
        .sort((a, b) => a.subtype.localeCompare(b.subtype) || a.versionId.localeCompare(b.versionId))
        .map(artifact => ({
            sourceKey: `artifact:${artifact.versionId}`,
            sourceType: 'artifact' as const,
            label: artifact.title,
            content: artifact.content,
            contentHash: hashReviewValue(artifact.content),
            artifactId: artifact.artifactId,
            artifactVersionId: artifact.versionId,
            artifactSubtype: artifact.subtype,
        }));
    const sources = [spineSource, ...artifactSources];
    const locators = [
        ...structuredPrdLocators(spineSource, input.spine.structuredPRD),
        ...markdownLocators(spineSource),
        ...artifactSources.flatMap(markdownLocators),
    ];
    const availableArtifacts = [...new Set(input.artifacts.map(a => a.subtype))].sort();
    const expected = input.expectedArtifactSubtypes ?? DEFAULT_ARTIFACTS;
    const missingArtifacts = expected.filter(subtype => !availableArtifacts.includes(subtype));
    const constraints = (input.spine.structuredPRD.constraints ?? []).filter(Boolean);
    const signaturePayload = {
        projectId: input.projectId,
        projectName: input.projectName,
        platform: input.platform,
        productCategory: input.productCategory,
        spineVersionId: input.spine.versionId,
        prdSchemaVersion: input.spine.schemaVersion,
        structuredPrdHash: hashReviewValue(input.spine.structuredPRD),
        // Intentionally NOT hashed here. The canonical spine is a *deterministic*
        // projection of `structuredPRD` (+ project identity, both already in this
        // payload), so `structuredPrdHash` fully subsumes any change it could
        // reflect — including it would only make the signature depend on whether
        // the rebuildable `canonicalSpine` cache happens to be resident. It is
        // NOT persisted to localStorage (stripped in projectStore's partialize to
        // bound storage growth), so it is present in-session but absent after a
        // reload; keying the signature off it would spuriously flip every review
        // run's context "changed" across a refresh. See docs/CANONICAL_PRD_SPINE.md.
        sources: sources.map(source => ({
            key: source.sourceKey,
            hash: source.contentHash,
            label: source.label,
            artifactId: source.artifactId,
            artifactVersionId: source.artifactVersionId,
            artifactSubtype: source.artifactSubtype,
        })),
        locators: locators.map(locator => ({
            id: locator.id,
            sourceKey: locator.sourceKey,
            path: locator.path,
            excerptHash: locator.excerptHash,
        })),
        availableArtifacts,
        missingArtifacts,
        constraints,
        safetyBoundaries: input.safetyBoundaries ?? [],
    };

    return {
        schemaVersion: 1,
        projectId: input.projectId,
        projectName: input.projectName,
        platform: input.platform,
        productCategory: input.productCategory,
        capturedAt: input.capturedAt ?? Date.now(),
        spineVersionId: input.spine.versionId,
        prdSchemaVersion: input.spine.schemaVersion,
        canonicalSpine: input.spine.canonicalSpine,
        constraints,
        safetyBoundaries: input.safetyBoundaries ?? [],
        sources,
        locators,
        availableArtifacts,
        missingArtifacts,
        contextSignature: hashReviewValue(signaturePayload),
    };
}

export function verifyEvidenceRef(
    manifest: ReviewContextManifest,
    evidence: SpecialistEvidenceInput,
): VerifiedEvidenceRef {
    const source = manifest.sources.find(item => item.sourceKey === evidence.sourceKey);
    const requestedLocator = evidence.locatorId
        ? manifest.locators.find(item => item.id === evidence.locatorId && item.sourceKey === evidence.sourceKey)
        : manifest.locators.find(item => item.sourceKey === evidence.sourceKey && item.path === evidence.path);
    const fallbackPath = evidence.path ?? requestedLocator?.path ?? '';
    const fallbackId = evidence.locatorId ?? requestedLocator?.id ?? '';
    const excerptHash = hashEvidenceExcerpt(evidence.excerpt);
    const base: VerifiedEvidenceRef = {
        ...evidence,
        locatorId: fallbackId,
        path: fallbackPath,
        excerptHash,
        verified: false,
    };
    if (!source) return { ...base, failureReason: 'unknown_source' };
    if (!requestedLocator) return { ...base, failureReason: 'unknown_locator' };
    if (evidence.locatorId && evidence.path && evidence.path !== requestedLocator.path) {
        return { ...base, failureReason: 'locator_mismatch' };
    }
    if (evidence.excerptHash && evidence.excerptHash !== excerptHash) {
        return { ...base, failureReason: 'hash_mismatch' };
    }
    const excerptText = normalizeEvidenceText(evidence.excerpt);
    const locatorText = normalizeEvidenceText(requestedLocator.excerpt);
    const tokenCount = excerptText.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
    const isWholeLocator = excerptText === locatorText;
    const meaningfulExcerpt = excerptText.length >= MIN_EVIDENCE_CHARS && tokenCount >= MIN_EVIDENCE_TOKENS;
    const meaningfulWholeLocator = isWholeLocator
        && excerptText.length >= MIN_WHOLE_LOCATOR_CHARS
        && tokenCount >= MIN_WHOLE_LOCATOR_TOKENS;
    if (!meaningfulExcerpt && !meaningfulWholeLocator) {
        return { ...base, failureReason: 'excerpt_too_short' };
    }
    const matches = Boolean(excerptText) && locatorText.includes(excerptText);
    if (!matches) return { ...base, failureReason: 'excerpt_mismatch' };
    return {
        ...base,
        locatorId: requestedLocator.id,
        path: requestedLocator.path,
        excerptHash,
        verified: true,
        failureReason: undefined,
    };
}

export function isManifestCurrent(
    manifest: ReviewContextManifest,
    current: Pick<ReviewContextManifest, 'spineVersionId' | 'sources'>,
): boolean {
    if (manifest.spineVersionId !== current.spineVersionId) return false;
    const currentHashes = new Map(current.sources.map(source => [source.sourceKey, source.contentHash]));
    return manifest.sources.every(source => currentHashes.get(source.sourceKey) === source.contentHash)
        && current.sources.every(source => manifest.sources.some(saved => saved.sourceKey === source.sourceKey));
}

/**
 * Project the execution manifest (which contains source text for local evidence
 * verification) into the bounded, cloud-safe manifest stored on ReviewRun.
 * Raw source content never crosses this persistence boundary.
 */
export function toPersistedReviewContextManifest(
    manifest: ReviewContextManifest,
): PersistedReviewContextManifest {
    const spine = manifest.sources.find(source => source.sourceType === 'spine');
    if (!spine) throw new Error('Review context manifest has no spine source');
    return {
        spineVersionId: manifest.spineVersionId,
        spineContentHash: spine.contentHash,
        canonicalSpineSchemaVersion: manifest.canonicalSpine?.meta.schemaVersion,
        artifactRefs: manifest.sources
            .filter(source => source.sourceType === 'artifact')
            .map(source => {
                if (!source.artifactId || !source.artifactVersionId) {
                    throw new Error(`Review artifact source ${source.sourceKey} is missing version identity`);
                }
                return {
                    artifactId: source.artifactId,
                    artifactVersionId: source.artifactVersionId,
                    subtype: source.artifactSubtype,
                    contentHash: source.contentHash,
                };
            }),
        missingArtifactSubtypes: manifest.missingArtifacts,
        capturedAt: manifest.capturedAt,
        contextSignature: manifest.contextSignature,
    };
}
