// Canonical PRD Spine — deterministic builder, validator, and prompt renderer.
//
// The spine is a compact, structured contract derived from the finalized
// StructuredPRD. It is built with pure deterministic code (NEVER an LLM call)
// so it is stable, testable, and cheap to rebuild. It becomes the primary
// source of truth for downstream artifact generation; full PRD markdown is
// retained only as a secondary fallback (see coreArtifactService).
//
// Design rules:
// - Feature ids stay canonical: they are copied verbatim from PRD Feature.id.
// - Screen/entity seed ids are deterministic slug-based ids (scr-/ent- prefix)
//   with numeric dedup suffixes — an interim stable id until a real inventory
//   exists. The slug logic is isolated in `slugId` so it is easy to swap for a
//   true id source later.
// - Seeds are conservative. We derive them only from structured fields already
//   in the PRD (uxPages / userLoops for screens; domainEntities / richDataModel
//   for entities). We never invent a large detailed inventory or data model.
// - The spine is compact: no embedded markdown, only short structured values.

import type {
    CanonicalPrdSpine,
    CanonicalSpineValidation,
    SafetyClassificationResult,
    SpineArchitectureDirection,
    SpineConstraints,
    SpineDesignDirection,
    SpineEntitySeed,
    SpineFeature,
    SpineProductIdentity,
    SpineSafetyRestrictions,
    SpineSafetyReview,
    SpineScreenSeed,
    SpineUserSegment,
    StructuredPRD,
} from '../types';
import { CANONICAL_SPINE_SCHEMA_VERSION } from '../types';
import { getDesignSystemPreset, getDesignSystemPresetLabel } from './designSystemPresets';
import { buildRestrictionDirective } from './safety/safetyReviewArtifact';

export interface BuildCanonicalSpineOptions {
    /** Authoritative product name (the user-chosen project name). */
    projectName?: string;
    /** Project platform ('app' | 'web') for the identity/platform line. */
    platform?: string;
    /** Selected design-system preset id (Project.designSystemPreset). */
    designSystemPreset?: string;
    /** Persisted safety verdict for the source spine, if any. */
    safetyReview?: SpineSafetyReview;
    /** Source spine version id (recorded in meta for diffing/debugging). */
    sourceSpineVersionId?: string;
    /** StructuredPRD schema version at build time (recorded in meta). */
    sourcePrdVersion?: number;
    /**
     * Injected clock. Defaults to Date.now(); overridable so tests can build a
     * deterministic spine.
     */
    now?: () => number;
}

// --- small pure helpers -----------------------------------------------------

const firstSentence = (text: string | undefined): string | undefined => {
    if (!text) return undefined;
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    const match = trimmed.match(/^.*?[.!?](\s|$)/);
    return (match ? match[0] : trimmed).trim();
};

const nonEmpty = (values: (string | undefined)[] | undefined): string[] =>
    (values ?? []).map(v => (v ?? '').trim()).filter(Boolean);

const dedupe = (values: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of values) {
        const key = v.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(v);
    }
    return out;
};

const slug = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'item';

/**
 * Deterministic slug-based id with a numeric dedup suffix. Isolated so the
 * interim slug id logic is easy to replace with a real stable id source later.
 * Given the same ordered inputs it always produces the same ids.
 */
const slugId = (prefix: string, name: string, used: Set<string>): string => {
    const base = `${prefix}-${slug(name)}`;
    if (!used.has(base)) {
        used.add(base);
        return base;
    }
    let n = 2;
    while (used.has(`${base}-${n}`)) n += 1;
    const id = `${base}-${n}`;
    used.add(id);
    return id;
};

const PRIVACY_RE = /privacy|security|compliance|gdpr|hipaa|ccpa|pii|encrypt|consent|audit|retention|data protection|soc\s?2/i;

/** Match canonical feature ids for entities/screens by conservative name mention. */
const relatedFeatureIds = (prd: StructuredPRD, ...needles: (string | undefined)[]): string[] => {
    const terms = nonEmpty(needles).map(t => t.toLowerCase());
    if (terms.length === 0) return [];
    const hits = prd.features
        .filter(f => {
            const hay = `${f.name} ${f.description}`.toLowerCase();
            return terms.some(term => term.length >= 3 && hay.includes(term));
        })
        .map(f => f.id);
    return dedupe(hits);
};

// --- section builders -------------------------------------------------------

const buildIdentity = (
    prd: StructuredPRD,
    options: BuildCanonicalSpineOptions,
): SpineProductIdentity => {
    const platformLabel =
        options.platform === 'app'
            ? 'Mobile app'
            : options.platform === 'web'
                ? 'Web app'
                : options.platform || undefined;
    return {
        productName: (prd.productName || options.projectName || '').trim() || undefined,
        description: firstSentence(prd.executiveSummary) ?? firstSentence(prd.vision),
        platform: platformLabel,
        primaryGoal: (prd.vision || prd.productThesis?.whyExist || prd.coreProblem || '').trim() || undefined,
    };
};

const buildUsers = (prd: StructuredPRD): SpineUserSegment[] => {
    if (prd.jtbd && prd.jtbd.length > 0) {
        return prd.jtbd.map(j => ({
            segment: j.segment,
            jobsToBeDone: dedupe(nonEmpty([j.job, j.motivation])),
            pains: dedupe(nonEmpty(j.painPoints)),
        }));
    }
    return dedupe(nonEmpty(prd.targetUsers)).map(segment => ({ segment }));
};

const buildFeatures = (prd: StructuredPRD): SpineFeature[] =>
    prd.features.map(f => {
        const acceptance = dedupe(nonEmpty([...(f.acceptanceCriteria ?? []), ...(f.successCriteria ?? [])]));
        const entry: SpineFeature = {
            id: f.id,
            name: f.name,
            description: f.description,
        };
        if (acceptance.length > 0) entry.acceptanceCriteria = acceptance;
        if (f.priority) entry.priority = f.priority;
        if (f.tier) entry.tier = f.tier;
        return entry;
    });

const buildScreenSeeds = (prd: StructuredPRD): SpineScreenSeed[] => {
    const used = new Set<string>();
    // Prefer the PRD's declared UX pages; fall back to user loops (each loop
    // implies a screen). Never invent a full inventory beyond these.
    if (prd.uxPages && prd.uxPages.length > 0) {
        return prd.uxPages.map(p => {
            const seed: SpineScreenSeed = { id: slugId('scr', p.name, used), name: p.name };
            if (p.purpose) seed.purpose = p.purpose;
            const related = relatedFeatureIds(prd, p.name, p.purpose);
            if (related.length > 0) seed.relatedFeatureIds = related;
            if (p.primaryUser) seed.userIntent = p.primaryUser;
            const states = dedupe(nonEmpty([p.emptyState, p.loadingState, p.errorState]));
            if (states.length > 0) seed.states = states;
            return seed;
        });
    }
    if (prd.userLoops && prd.userLoops.length > 0) {
        return prd.userLoops.map(loop => {
            const seed: SpineScreenSeed = { id: slugId('scr', loop.name, used), name: loop.name };
            if (loop.action) seed.purpose = loop.action;
            const related = relatedFeatureIds(prd, loop.name, loop.action);
            if (related.length > 0) seed.relatedFeatureIds = related;
            return seed;
        });
    }
    return [];
};

const buildEntitySeeds = (prd: StructuredPRD): SpineEntitySeed[] => {
    const used = new Set<string>();
    if (prd.domainEntities && prd.domainEntities.length > 0) {
        return prd.domainEntities.map(e => {
            const seed: SpineEntitySeed = { id: slugId('ent', e.name, used), name: e.name };
            if (e.description) seed.description = e.description;
            const related = relatedFeatureIds(prd, e.name);
            if (related.length > 0) seed.relatedFeatureIds = related;
            return seed;
        });
    }
    if (prd.richDataModel && prd.richDataModel.entities.length > 0) {
        return prd.richDataModel.entities.map(e => {
            const seed: SpineEntitySeed = { id: slugId('ent', e.name, used), name: e.name };
            if (e.description) seed.description = e.description;
            const related = relatedFeatureIds(prd, e.name);
            if (related.length > 0) seed.relatedFeatureIds = related;
            const relationships = dedupe(nonEmpty(e.relationships));
            if (relationships.length > 0) seed.relationships = relationships;
            return seed;
        });
    }
    return [];
};

const buildConstraints = (prd: StructuredPRD): SpineConstraints => {
    const product: string[] = [];
    const nonFunctional: string[] = [];
    const privacy: string[] = [];

    for (const c of dedupe(nonEmpty(prd.constraints))) {
        (PRIVACY_RE.test(c) ? privacy : product).push(c);
    }
    for (const nfr of dedupe(nonEmpty(prd.nonFunctionalRequirements))) {
        (PRIVACY_RE.test(nfr) ? privacy : nonFunctional).push(nfr);
    }

    const outOfScope = dedupe(nonEmpty(prd.productThesis?.nonGoals));

    const constraints: SpineConstraints = {};
    if (product.length > 0) constraints.product = product;
    if (nonFunctional.length > 0) constraints.nonFunctional = nonFunctional;
    if (privacy.length > 0) constraints.privacySecurityCompliance = dedupe(privacy);
    if (outOfScope.length > 0) constraints.outOfScope = outOfScope;
    return constraints;
};

const buildSafety = (review: SpineSafetyReview | undefined): SpineSafetyRestrictions | undefined => {
    if (!review) return undefined;
    const safety: SpineSafetyRestrictions = {
        classification: review.classification,
        status: review.status,
    };
    const boundaries = dedupe(nonEmpty(review.detectedConcerns));
    if (boundaries.length > 0) safety.boundaries = boundaries;
    if (review.status === 'restricted' || review.classification === 'allowed_with_restrictions') {
        // Reconstruct the binding restriction directive from the persisted
        // review so downstream artifacts inherit the same constraints the PRD
        // was generated under. SpineSafetyReview lacks `confidence`; the
        // directive builder does not use it, so a placeholder is safe.
        const asResult: SafetyClassificationResult = {
            classification: review.classification,
            confidence: 'medium',
            detectedConcerns: review.detectedConcerns,
            userFacingReason: review.userFacingReason,
            safeAlternatives: review.safeAlternatives,
        };
        const directive = buildRestrictionDirective(asResult)
            .split('\n')
            .map(l => l.replace(/^-\s*/, '').trim())
            .filter(l => l && !/^SAFETY CONSTRAINTS/i.test(l));
        if (directive.length > 0) safety.restrictionDirectives = directive;
    }
    return safety;
};

const buildArchitecture = (prd: StructuredPRD): SpineArchitectureDirection => {
    const architecture: SpineArchitectureDirection = {};
    const summary = (prd.architecture || '').trim();
    if (summary) architecture.summary = summary;
    const integration = dedupe(nonEmpty(prd.architectureFlows?.map(f => f.name)));
    if (integration.length > 0) architecture.integrationAssumptions = integration;
    return architecture;
};

const buildDesign = (presetId: string | undefined): SpineDesignDirection | undefined => {
    const preset = getDesignSystemPreset(presetId);
    // Only concrete presets carry a design direction. 'custom'/unknown/missing
    // → no design direction (the model decides), mirroring the prompt behavior.
    if (!preset || !preset.directive) return undefined;
    const design: SpineDesignDirection = {
        presetId: preset.id,
        presetLabel: getDesignSystemPresetLabel(preset.id),
    };
    if (preset.tone) design.tone = preset.tone;
    const visual = dedupe(nonEmpty(preset.visualTraits));
    if (visual.length > 0) design.visualDirection = visual.join(', ');
    return design;
};

// --- public API -------------------------------------------------------------

/**
 * Deterministically build the Canonical PRD Spine from a finalized structured
 * PRD. Pure — no LLM call, no store access, no I/O beyond the injected clock.
 * The result always carries a `meta.validation` block (see
 * `validateCanonicalPrdSpine`); the spine is never silently empty.
 */
export function buildCanonicalPrdSpine(
    prd: StructuredPRD,
    options: BuildCanonicalSpineOptions = {},
): CanonicalPrdSpine {
    const now = options.now ?? Date.now;
    const spine: CanonicalPrdSpine = {
        identity: buildIdentity(prd, options),
        users: buildUsers(prd),
        features: buildFeatures(prd),
        screenSeeds: buildScreenSeeds(prd),
        entitySeeds: buildEntitySeeds(prd),
        constraints: buildConstraints(prd),
        safety: buildSafety(options.safetyReview),
        architecture: buildArchitecture(prd),
        design: buildDesign(options.designSystemPreset),
        meta: {
            schemaVersion: CANONICAL_SPINE_SCHEMA_VERSION,
            generatedAt: now(),
            sourceSpineVersionId: options.sourceSpineVersionId,
            sourcePrdVersion: options.sourcePrdVersion,
            validation: { valid: true, warnings: [] },
        },
    };
    spine.meta.validation = validateCanonicalPrdSpine(spine, { prd, options });
    return spine;
}

/**
 * Lightweight deterministic validation. Non-invasive — it never mutates the
 * spine — but failures are surfaced as warnings and recorded in
 * `meta.validation` so a misleading/empty spine is never produced silently.
 */
export function validateCanonicalPrdSpine(
    spine: CanonicalPrdSpine,
    context?: { prd?: StructuredPRD; options?: BuildCanonicalSpineOptions },
): CanonicalSpineValidation {
    const warnings: string[] = [];
    const prd = context?.prd;
    const options = context?.options;

    // Product identity present.
    const { identity } = spine;
    if (!identity.productName && !identity.description && !identity.primaryGoal) {
        warnings.push('Product identity is empty (no product name, description, or primary goal).');
    }

    // Features present, ids unique, names present.
    if (spine.features.length === 0) {
        warnings.push('Feature glossary is empty.');
    }
    const featureIds = spine.features.map(f => f.id);
    if (featureIds.some(id => !id || !id.trim())) {
        warnings.push('One or more features have a missing id.');
    }
    if (new Set(featureIds).size !== featureIds.length) {
        warnings.push('Feature ids are not unique.');
    }
    if (spine.features.some(f => !f.name || !f.name.trim())) {
        warnings.push('One or more features have a missing name.');
    }

    // Screen/entity seed ids unique when present.
    const screenIds = spine.screenSeeds.map(s => s.id);
    if (new Set(screenIds).size !== screenIds.length) {
        warnings.push('Screen seed ids are not unique.');
    }
    const entityIds = spine.entitySeeds.map(e => e.id);
    if (new Set(entityIds).size !== entityIds.length) {
        warnings.push('Entity seed ids are not unique.');
    }

    // Safety restrictions preserved when applicable.
    const review = options?.safetyReview;
    if (review && (review.status === 'restricted' || review.status === 'blocked') && !spine.safety) {
        warnings.push('Safety restrictions were present on the spine but are missing from the canonical spine.');
    }

    // Architecture direction must survive when the PRD had one.
    if (prd && (prd.architecture || '').trim() && !spine.architecture.summary) {
        warnings.push('Architecture direction is present in the PRD but missing from the canonical spine.');
    }

    // Design direction included when a concrete preset was selected.
    if (options?.designSystemPreset) {
        const preset = getDesignSystemPreset(options.designSystemPreset);
        if (preset && preset.directive && !spine.design) {
            warnings.push('A design preset was selected but design direction is missing from the canonical spine.');
        }
    }

    return { valid: warnings.length === 0, warnings };
}

/**
 * Compact JSON projection of the spine for prompt injection. Strips the `meta`
 * block and empty containers so the prompt carries only the product contract.
 */
export function canonicalSpineToPromptJson(spine: CanonicalPrdSpine): string {
    const prune = (value: unknown): unknown => {
        if (Array.isArray(value)) {
            const arr = value.map(prune).filter(v => v !== undefined);
            return arr.length > 0 ? arr : undefined;
        }
        if (value && typeof value === 'object') {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                const pruned = prune(v);
                if (pruned !== undefined) out[k] = pruned;
            }
            return Object.keys(out).length > 0 ? out : undefined;
        }
        if (typeof value === 'string') return value.trim() ? value : undefined;
        return value;
    };
    const { meta: _meta, ...rest } = spine;
    void _meta;
    return JSON.stringify(prune(rest) ?? {}, null, 2);
}

/**
 * Render the authoritative "Canonical PRD Spine" prompt section. Returns null
 * when the spine has no features (nothing reliable to anchor on) so callers can
 * fall back to the legacy summary path.
 */
export function buildCanonicalSpinePromptSection(spine: CanonicalPrdSpine): string | null {
    if (spine.features.length === 0) return null;
    return [
        'Canonical PRD Spine (AUTHORITATIVE — this compact structured contract is the primary',
        'source of truth for this artifact). Rules:',
        '- Treat the Canonical PRD Spine as authoritative. Where the full PRD markdown below',
        '  conflicts with it, the spine wins.',
        '- Reuse feature ids exactly as given. Do not rename features or invent new ids.',
        '- Reuse screen seed ids and entity seed ids where relevant; do not introduce duplicate',
        '  or alternate terminology for the same concept.',
        '- Use the full PRD markdown only as secondary context for detail the spine omits.',
        '',
        canonicalSpineToPromptJson(spine),
    ].join('\n');
}
