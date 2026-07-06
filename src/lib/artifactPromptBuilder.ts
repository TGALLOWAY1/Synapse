// Artifact prompt assembly — pure, deterministic, and machine-checkable.
//
// Downstream artifact generation draws on several sources of product truth of
// DIFFERING authority. Left unordered, a long stale prose PRD can drown out the
// compact structured contract and push the model to invent or drift from
// canonical feature ids/names. This module assembles the artifact user prompt
// with an EXPLICIT, labeled source hierarchy so precedence is unambiguous:
//
//   1. Canonical PRD Spine        — authoritative (identity, feature ids/names,
//                                    users, constraints, safety).
//   2. Structured dependency      — authoritative for the already-generated
//      summaries                     artifacts they describe.
//   3. Task options / preset      — hard task constraints.
//   4. Full PRD markdown          — SECONDARY reference only (appendix). Never
//                                    overrides a structured source.
//
// A conflict/staleness detector surfaces known drift (e.g. a canonical feature
// name that no longer appears in the prose) so the model is told, in-band, to
// prefer the structured source. Kept pure so it is unit-testable in isolation
// (see coreArtifactService call site and the prompt-construction tests).

import type { CanonicalPrdSpine } from '../types';

/** A detected disagreement/staleness between structured sources and the prose. */
export type ArtifactSourceConflict = {
    kind: 'stale_feature_name' | 'degraded_dependency';
    detail: string;
};

const MAX_FLAGGED_FEATURES = 8;

/**
 * Detect canonical feature names that no longer appear in the full PRD prose.
 * The PRD markdown is normally rendered from the same StructuredPRD the spine is
 * built from, so a canonical name missing from the prose is a strong signal the
 * prose is STALE relative to the spine (e.g. the PRD was edited and the spine
 * rebuilt, but the stored markdown wasn't re-rendered). Conservative: only fires
 * when the prose is substantial, and caps the number reported.
 */
export function detectStaleFeatureNames(
    spine: CanonicalPrdSpine,
    prdMarkdown: string,
): ArtifactSourceConflict[] {
    if (!prdMarkdown || prdMarkdown.trim().length < 40) return [];
    const lc = prdMarkdown.toLowerCase();
    return spine.features
        .filter(f => {
            const name = (f.name ?? '').trim();
            return name.length >= 3 && !lc.includes(name.toLowerCase());
        })
        .slice(0, MAX_FLAGGED_FEATURES)
        .map(f => ({
            kind: 'stale_feature_name' as const,
            detail: `Feature "${f.id}" has canonical name "${f.name}", which does not appear in the full PRD prose below — the prose may use an older name. Use the canonical id and name from the spine.`,
        }));
}

/**
 * Flag any REQUIRED dependency summary reported as missing/degraded, so the
 * model is told the structured summary it is reading may be incomplete rather
 * than treating it as authoritative-and-complete. Detected from the marker
 * `buildDependencyContext` emits for an absent required dependency.
 */
export function detectDegradedDependencies(
    dependencyContext: string,
): ArtifactSourceConflict[] {
    if (!dependencyContext) return [];
    const conflicts: ArtifactSourceConflict[] = [];
    // `buildDependencyContext` emits a "MISSING — this required dependency…"
    // line for an absent required dep; surface it as a known conflict.
    const missingRe = /###\s+(\w+)\s+\(REQUIRED\)\n\*\*MISSING/g;
    let m: RegExpExecArray | null;
    while ((m = missingRe.exec(dependencyContext)) !== null) {
        conflicts.push({
            kind: 'degraded_dependency',
            detail: `Required dependency "${m[1]}" was unavailable at generation time; its structured summary is incomplete. Do not invent its content — rely on the canonical spine and state assumptions explicitly.`,
        });
    }
    return conflicts;
}

const SOURCE_HIERARCHY_PREAMBLE = [
    'SOURCE HIERARCHY (read first). The sources below are ordered by authority.',
    'When any two disagree, resolve the conflict in favor of the higher-authority source:',
    '1. CANONICAL PRD SPINE — authoritative. The single source of truth for product identity,',
    '   canonical feature ids/names, users, constraints, and safety restrictions.',
    '2. STRUCTURED DEPENDENCY SUMMARIES — authoritative for the already-generated artifacts they',
    '   describe (screen ids/names, entity names, API surface, etc.). Where a dependency summary',
    '   disagrees with the Canonical PRD Spine about a product fact (feature id/name, scope,',
    '   constraint), PREFER THE SPINE — unless the dependency is explicitly marked newer and valid.',
    '3. TASK OPTIONS — hard constraints you must honor (e.g. the selected design direction).',
    '4. FULL PRD MARKDOWN (APPENDIX) — SECONDARY reference ONLY, for detail the structured sources',
    '   omit. It may be stale and MUST NEVER override a canonical spine field or a structured',
    '   dependency summary. Where a name in the prose differs from the spine, use the spine.',
    'Always cite features by their canonical id and name from the spine — never by a prose-only name.',
].join('\n');

const buildConflictBlock = (conflicts: ArtifactSourceConflict[]): string => {
    if (conflicts.length === 0) return '';
    const lines = conflicts.map(c => `- ${c.detail}`).join('\n');
    return [
        '',
        'KNOWN CONFLICTS / STALENESS (resolve every one in favor of the structured sources above):',
        lines,
    ].join('\n');
};

export interface ArtifactPromptInputs {
    /** Artifact template lead-in ("Create User Flows from this PRD:"). */
    userPrefix: string;
    /** Narrative guardrails block. */
    guardrails: string;
    /**
     * The authoritative Canonical PRD Spine prompt section (already carries its
     * own AUTHORITATIVE header + rules), or null when no reliable spine exists.
     */
    spineSection: string | null;
    /** Structured dependency-artifact summaries. */
    dependencyContext: string;
    /** Task-options / preset section (may be empty). */
    presetSection: string;
    /** Mockup context section (may be empty). */
    mockupSection: string;
    /** Full PRD markdown (secondary reference / appendix). */
    prdMarkdown: string;
    /** Known source conflicts/staleness to surface in-band. */
    conflicts: ArtifactSourceConflict[];
    /**
     * Legacy fallback pieces, used ONLY when `spineSection` is null (a PRD with
     * no features). Kept for back-compat with old projects.
     */
    legacy?: {
        featureGlossary: string;
        prdSummary: string;
    };
}

/**
 * Assemble the artifact user prompt with an explicit, machine-checkable source
 * hierarchy. Structured sources lead; the full PRD markdown is demoted to a
 * clearly-labeled secondary appendix that is instructed never to override them.
 */
export function buildArtifactPrompt(inputs: ArtifactPromptInputs): string {
    const {
        userPrefix, guardrails, spineSection, dependencyContext, presetSection,
        mockupSection, prdMarkdown, conflicts, legacy,
    } = inputs;

    const conflictBlock = buildConflictBlock(conflicts);
    const optionsSection = presetSection.trim()
        ? presetSection
        : '\n\n---\n\nTASK OPTIONS: none specified.';
    const appendix =
        `\n\n---\n\nAPPENDIX — Full PRD markdown (SECONDARY reference only; defer to the canonical spine and structured summaries above on any conflict, and use this solely for detail the structured sources omit):\n${prdMarkdown}${mockupSection}`;

    if (spineSection) {
        return [
            `TASK: ${userPrefix}`,
            '',
            guardrails,
            '',
            SOURCE_HIERARCHY_PREAMBLE,
            '',
            '## 1. CANONICAL PRD SPINE (authoritative)',
            spineSection,
            '',
            '## 2. STRUCTURED DEPENDENCY SUMMARIES (authoritative for generated artifacts)',
            dependencyContext,
            optionsSection,
            conflictBlock,
            appendix,
        ].join('\n');
    }

    // Legacy fallback: no reliable spine (a PRD with no features). Keep the
    // hierarchy framing but anchor on the feature glossary + inline summary.
    const glossary = legacy?.featureGlossary ?? '';
    const summary = legacy?.prdSummary ?? '';
    return [
        `TASK: ${userPrefix}`,
        '',
        guardrails,
        '',
        SOURCE_HIERARCHY_PREAMBLE,
        '',
        '## 1. CANONICAL FEATURE GLOSSARY (authoritative — no full spine available)',
        glossary,
        '',
        '## 2. STRUCTURED DEPENDENCY SUMMARIES (authoritative for generated artifacts)',
        dependencyContext,
        '',
        summary,
        optionsSection,
        conflictBlock,
        appendix,
    ].join('\n');
}
