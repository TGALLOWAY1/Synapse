// Pure, machine-checkable assembly of the artifact-generation user prompt.
//
// Artifact prompts draw on several sources of very different reliability:
//   1. The Canonical PRD Spine — a compact, structured, deterministic contract
//      (identity, canonical feature ids/names, screen/entity seeds, constraints,
//      safety restrictions). This is the single source of truth.
//   2. Structured dependency summaries — the already-generated upstream
//      artifacts, authoritative for the detail they own.
//   3. User-selected options / design preset — hard task constraints.
//   4. The full PRD markdown — free-form prose, useful only as SECONDARY
//      reference for detail the structured sources omit.
//
// Without an explicit, labeled hierarchy the model can let stale PRD prose (an
// old feature name, a since-removed scope line) override the structured truth.
// This builder makes the hierarchy explicit and the conflict-resolution rule
// machine-checkable, demotes the PRD markdown to a clearly-labeled appendix,
// and surfaces any known conflicts/staleness in a dedicated block. It is pure
// (no store / LLM / React) so prompt construction is unit-testable.

import type { CanonicalPrdSpine } from '../../types';

/** A feature whose canonical name is absent from the PRD prose (likely stale/renamed). */
export interface StaleFeatureNameConflict {
    id: string;
    canonicalName: string;
}

export interface ArtifactPromptSources {
    /** Artifact-specific instruction prefix (from CORE_ARTIFACT_PROMPTS[subtype].userPrefix). */
    userPrefix: string;
    /** Narrative guardrails derived from the PRD. */
    guardrails: string;
    /** The canonical spine (used for stale-name detection and identity). */
    canonicalSpine: CanonicalPrdSpine;
    /**
     * Rendered authoritative spine section, or null when the spine has no
     * features (legacy fallback path). When null, `legacyStructured` is used as
     * the authoritative structured section instead.
     */
    spineSection: string | null;
    /** Legacy structured fallback (feature glossary + PRD summary) — used only when spineSection is null. */
    legacyStructured?: string;
    /** Rendered structured dependency summaries (already-generated upstream artifacts). */
    dependencyContext: string;
    /** Which dependency subtypes are present (for the section note). */
    dependencyKeys: string[];
    /** Selected design-preset / options section, or '' when none. */
    presetSection: string;
    /** Full PRD markdown (secondary reference / appendix). */
    prdMarkdown: string;
    /** Mockup context section, or '' when none. */
    mockupSection: string;
    /**
     * Known degradations to surface in the conflict/staleness block: missing
     * required dependencies, spine validation warnings, incomplete-PRD flags,
     * etc. Rendered verbatim as bullet lines.
     */
    notices?: string[];
}

export interface BuiltArtifactPrompt {
    /** The assembled user prompt. */
    prompt: string;
    /** Section headers in authority order — a machine-checkable outline. */
    sections: string[];
    /** Features whose canonical name is missing from the PRD prose (possible stale usage). */
    staleNameConflicts: StaleFeatureNameConflict[];
    /** Whether a "Known conflicts & staleness" block was emitted. */
    hasConflictBlock: boolean;
    /** Whether the authoritative structured section came from the canonical spine (vs legacy fallback). */
    usedSpine: boolean;
}

// Section header constants — exported so tests can assert against the exact
// strings instead of brittle substrings.
export const SECTION = {
    task: '## TASK',
    hierarchy: '## SOURCE HIERARCHY — READ FIRST',
    guardrails: '## GUARDRAILS',
    spine: '## AUTHORITATIVE — CANONICAL PRD SPINE',
    structuredFallback: '## AUTHORITATIVE — STRUCTURED PRD SUMMARY',
    dependencies: '## AUTHORITATIVE — STRUCTURED DEPENDENCY SUMMARIES',
    options: '## TASK CONSTRAINTS — SELECTED OPTIONS',
    conflicts: '## KNOWN CONFLICTS & STALENESS',
    appendix: '## APPENDIX — FULL PRD MARKDOWN (SECONDARY REFERENCE ONLY)',
} as const;

const HIERARCHY_RULES = [
    'You are given sources at different authority levels. Resolve EVERY conflict in this order:',
    '',
    '1. AUTHORITATIVE — Canonical PRD Spine: the structured contract of product identity,',
    '   canonical feature ids/names, screen/entity seeds, constraints, and safety restrictions.',
    '   This is the single source of truth. It always wins.',
    '2. AUTHORITATIVE — Structured Dependency Summaries: the already-generated upstream',
    '   artifacts. Treat them as authoritative for the detail they own, BUT if a dependency',
    '   conflicts with the Canonical PRD Spine, prefer the spine — unless the dependency is',
    '   explicitly newer and valid.',
    '3. TASK CONSTRAINTS — Selected options / design preset: honor these as hard constraints.',
    '4. SECONDARY REFERENCE — Full PRD markdown (Appendix): free-form prose, useful only for',
    '   detail the structured sources omit. It MUST NOT override the Canonical PRD Spine or the',
    '   structured dependency summaries. Where the prose names a feature differently from the',
    '   spine, use the spine’s canonical id and name.',
    '',
    'Always cite features by their canonical id and name from the spine (or the feature glossary',
    'when no spine is present) — never by a prose-only or stale name.',
].join('\n');

/**
 * Detect features whose canonical name does not appear (case-insensitively) in
 * the PRD prose. Because the spine and the PRD markdown are normally rendered
 * from the same StructuredPRD, this fires only when they have drifted — e.g. a
 * post-generation edit or a consistency-review rename left the prose using an
 * older name. Best-effort: it flags likely stale usage, it does not prove it.
 */
export function detectStaleFeatureNames(
    spine: CanonicalPrdSpine,
    prdMarkdown: string,
): StaleFeatureNameConflict[] {
    const haystack = prdMarkdown.toLowerCase();
    const out: StaleFeatureNameConflict[] = [];
    for (const f of spine.features) {
        const name = f.name?.trim();
        if (!name) continue;
        if (!haystack.includes(name.toLowerCase())) {
            out.push({ id: f.id, canonicalName: name });
        }
    }
    return out;
}

/**
 * Assemble the artifact-generation user prompt with an explicit, machine-checkable
 * source hierarchy. Returns the prompt plus a structured description of what was
 * included so callers/tests can assert on the organization.
 */
export function buildArtifactPrompt(sources: ArtifactPromptSources): BuiltArtifactPrompt {
    const usedSpine = sources.spineSection !== null;
    const structuredSection = usedSpine ? sources.spineSection! : (sources.legacyStructured ?? '');

    const staleNameConflicts = usedSpine
        ? detectStaleFeatureNames(sources.canonicalSpine, sources.prdMarkdown)
        : [];

    const noticeLines = (sources.notices ?? []).filter(n => n && n.trim().length > 0);
    const conflictLines: string[] = [];
    for (const notice of noticeLines) conflictLines.push(`- ${notice}`);
    for (const c of staleNameConflicts) {
        conflictLines.push(
            `- Feature "${c.id}" is canonically named "${c.canonicalName}". The PRD prose may reference ` +
            `it by a different (stale) name — always use the canonical id and name.`,
        );
    }
    const hasConflictBlock = conflictLines.length > 0;

    const sectionOrder: string[] = [];
    const parts: string[] = [];
    const push = (header: string, body: string) => {
        sectionOrder.push(header);
        parts.push(`${header}\n${body}`);
    };

    // 1. Task.
    push(SECTION.task, sources.userPrefix.trim());
    // 2. Hierarchy explainer (comes before any source so the model reads the rules first).
    push(SECTION.hierarchy, HIERARCHY_RULES);
    // 3. Guardrails.
    push(SECTION.guardrails, sources.guardrails.trim());
    // 4. Authoritative structured source (spine, or legacy structured fallback).
    push(usedSpine ? SECTION.spine : SECTION.structuredFallback, structuredSection.trim());
    // 5. Authoritative structured dependency summaries.
    const depNote = sources.dependencyKeys.length
        ? `(Authoritative for the detail they own; prefer the spine on any conflict. Present: ${sources.dependencyKeys.join(', ')}.)`
        : '(None generated yet.)';
    push(SECTION.dependencies, `${depNote}\n${sources.dependencyContext.trim()}`);
    // 6. Task constraints / selected options (only when present).
    if (sources.presetSection.trim()) {
        push(SECTION.options, sources.presetSection.trim());
    }
    // 7. Known conflicts & staleness (only when there is something to say).
    if (hasConflictBlock) {
        push(
            SECTION.conflicts,
            [
                'The sources below are known to disagree or be incomplete. Resolve each in favor of the',
                'authoritative structured sources (spine first, then dependency summaries):',
                '',
                ...conflictLines,
            ].join('\n'),
        );
    }
    // 8. Full PRD markdown appendix (secondary reference only) + mockup context.
    push(
        SECTION.appendix,
        [
            'Defer to the authoritative structured sources above on ANY conflict; use this solely for',
            'detail they omit. Do not treat prose here as overriding the canonical spine.',
            '',
            sources.prdMarkdown.trim(),
        ].join('\n') + sources.mockupSection,
    );

    return {
        prompt: parts.join('\n\n'),
        sections: sectionOrder,
        staleNameConflicts,
        hasConflictBlock,
        usedSpine,
    };
}
