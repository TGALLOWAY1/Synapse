// Phase 5C: the Screens implementation-handoff EXPORT layer.
//
// Phases 4A/4B/5A/5B turned the Screens artifact into a review workflow, a
// downstream-impact + preflight surface, per-screen implementation handoff
// packages, and a read-only trace bridge to the Data Model / Implementation
// Plan. Phase 5C layers ON TOP of all of those (and NEVER changes them) to make
// the trace-backed handoff a practical, exportable *implementation package*:
// one structured, schema-versioned bundle the user can copy or download and hand
// to a developer (or a coding agent), plus a clear final preflight before doing
// so.
//
// It is PURE and read-time only (no store, no IDB, no React, no LLM). It is
// DERIVED — nothing here is persisted, and it MUTATES no artifact. It composes
// the already-computed pieces (Phase 4B preflight, Phase 5A handoffs, Phase 5B
// trace bridges, Phase 4A review models) rather than recomputing them, so it can
// never drift from those layers.
//
// Honesty rules (mirroring the rest of the Screens layer): every value is an
// estimate from the generated spec / a label-or-token correlation, never proof;
// an ABSENT Data Model / Implementation Plan artifact is a context caveat, never
// an automatic defect (Phase 5B explicitly fixed that); legacy mockups with no
// freshness metadata are informational, never blockers; NO binary mockup image
// data is embedded — only references/labels/freshness/coverage travel; no
// downstream artifact is mutated by an export.

import type { ScreenReviewModel } from './screenReviewWorkflow';
import type { ScreensPreflightModel } from './screenDownstreamImpact';
import type {
    ScreenImplementationHandoff, ScreensHandoffRollup,
} from './screenImplementationHandoff';
import {
    TRACE_CONFIDENCE_LABELS, toExportStatus, type ScreensExportStatus,
} from './screenStatusShared';

// --- Types -------------------------------------------------------------------

export type ScreensHandoffExportStatus = ScreensExportStatus;

export type ScreensHandoffExportFormat = 'markdown' | 'json';

export interface ScreensHandoffExportTraceSummary {
    explicit: number;
    strong: number;
    weak: number;
    estimated: number;
    missing: number;
}

export interface ScreensHandoffExportMockupSummary {
    generated: number;
    missing: number;
    stale: number;
    unknownFreshness: number;
}

export interface ScreensHandoffExportSummary {
    totalScreens: number;
    p0Screens: number;
    acceptedScreens: number;
    implementationReadyScreens: number;
    blockedScreens: number;
    reviewRecommendedScreens: number;
    trace: ScreensHandoffExportTraceSummary;
    mockups: ScreensHandoffExportMockupSummary;
}

export interface ScreensHandoffExportPreflight {
    blocking: string[];
    review: string[];
    info: string[];
    recommendedNextActions: string[];
}

export interface ScreensHandoffExportMockupRef {
    label: string;
    freshness?: string;
    coverage?: string;
    recommendedForBuild?: boolean;
}

export interface ScreensHandoffExportScreenTrace {
    overallConfidence?: string;
    dataModelConfidence?: string;
    implementationPlanConfidence?: string;
    dataModelMatches: string[];
    implementationPlanMatches: string[];
    warnings: string[];
}

export interface ScreensHandoffExportScreen {
    screenId: string;
    title: string;
    priority?: string;
    reviewStatus?: string;
    systemReadiness?: string;
    handoffReadiness?: string;
    reviewFreshness?: string;
    route?: string;
    components: string[];
    state: string[];
    events: string[];
    dataDependencies: string[];
    acceptanceCriteria: string[];
    qaChecklist: string[];
    buildTasks: string[];
    mockupReferences: ScreensHandoffExportMockupRef[];
    trace: ScreensHandoffExportScreenTrace;
    issues: {
        blocking: string[];
        review: string[];
        info: string[];
    };
}

export interface ScreensHandoffExportManifestArtifact {
    kind: string;
    versionId?: string;
    title?: string;
    traceConfidence?: string;
}

export interface ScreensHandoffExportManifest {
    prdVersionId?: string;
    screensArtifactVersionId?: string;
    dataModelArtifactVersionId?: string;
    implementationPlanArtifactVersionId?: string;
    designSystemVersionId?: string;
    includedArtifacts: ScreensHandoffExportManifestArtifact[];
    caveats: string[];
}

export interface ScreensHandoffExportPackage {
    schemaVersion: 1;
    projectName?: string;
    exportedAt: string;
    status: ScreensHandoffExportStatus;
    summary: ScreensHandoffExportSummary;
    preflight: ScreensHandoffExportPreflight;
    screens: ScreensHandoffExportScreen[];
    manifest: ScreensHandoffExportManifest;
}

// --- Input -------------------------------------------------------------------

/** Manifest source ids + artifact presence. An `undefined` version id means the
 * artifact is absent (a caveat, never a defect — Phase 5B). Presence is tracked
 * separately from the version id so a present-but-unversioned legacy artifact is
 * still counted as present. */
export interface ScreensHandoffExportManifestInput {
    prdVersionId?: string;
    screensArtifactVersionId?: string;
    dataModelArtifactVersionId?: string;
    implementationPlanArtifactVersionId?: string;
    designSystemVersionId?: string;
    /** True when a Data Model artifact exists (even if its version id is unknown). */
    dataModelPresent?: boolean;
    /** True when an Implementation Plan artifact exists. */
    implementationPlanPresent?: boolean;
}

export interface ScreensHandoffExportInput {
    projectName?: string;
    /** ISO timestamp stamped at the call site (kept out of the pure builder so
     * it stays deterministic / testable). */
    exportedAt: string;
    /** Per-screen Phase 5A/5B handoff packages (already trace-upgraded). */
    handoffs: readonly ScreenImplementationHandoff[];
    /** Per-screen Phase 4A review models keyed by canonical id. */
    reviewModels: ReadonlyMap<string, ScreenReviewModel>;
    /** The Phase 4B preflight (already folded with handoff contributions). */
    preflight: ScreensPreflightModel;
    /** The Phase 5A/5B handoff rollup (P0-gated readiness + trace rollup). */
    handoffRollup: ScreensHandoffRollup;
    /** Canonical P0 screen ids. */
    p0Ids: ReadonlySet<string>;
    manifest?: ScreensHandoffExportManifestInput;
}

// --- Honesty caveats ---------------------------------------------------------

/** The standing honesty caveats every export carries. Kept as a constant so the
 * UI and the markdown/JSON render the exact same text. */
export const SCREENS_HANDOFF_EXPORT_CAVEATS: readonly string[] = [
    'Correlation to the Data Model and Implementation Plan is label/token-based, not semantic proof.',
    'Missing Data Model or Implementation Plan artifacts are treated as missing context, not defects.',
    'Legacy mockups may have unknown freshness or coverage — review them visually before building.',
    'Mockup variant images are referenced by label only; no image data is embedded in this export.',
    'Implementation Plan matches are read-only references — nothing was changed or generated.',
    'No downstream artifact (Screens, Data Model, Mockups, Implementation Plan) was mutated by this export.',
];

// --- Small helpers -----------------------------------------------------------

const STATUS_RANK: Record<ScreensHandoffExportStatus, number> = {
    ready: 0, review_recommended: 1, not_ready: 2,
};

/** Fold two statuses to the more conservative (worse) of the two. */
function worseStatus(
    a: ScreensHandoffExportStatus, b: ScreensHandoffExportStatus,
): ScreensHandoffExportStatus {
    return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

const REVIEW_STATUS_LABELS: Record<string, string> = {
    draft: 'Draft',
    needs_review: 'Needs review',
    accepted: 'Accepted',
    implementation_ready: 'Implementation ready',
};

const SYSTEM_READINESS_LABELS: Record<string, string> = {
    ready: 'Ready to confirm',
    needs_review: 'Review recommended',
    blocked: 'Blocking issues',
};

const HANDOFF_READINESS_LABELS: Record<string, string> = {
    ready: 'Ready',
    review_recommended: 'Review recommended',
    blocked: 'Blocked',
};

/** Mockup-variant freshness labels (MockupVariantFreshnessStatus). */
const FRESHNESS_LABELS: Record<string, string> = {
    current: 'Current',
    possibly_stale: 'Possibly out of date',
    stale: 'Out of date',
    unknown: 'Unknown',
};

/** Screen REVIEW freshness labels (ScreenReviewFreshnessStatus: current /
 * outdated / unknown) — a distinct axis from mockup freshness. Kept separate so
 * an `outdated` signed-off screen keeps its stale-review signal in the export
 * (the mockup map has no `outdated` key). */
const REVIEW_FRESHNESS_LABELS: Record<string, string> = {
    current: 'Current',
    outdated: 'Changed after sign-off',
    unknown: 'Unknown',
};

// --- Per-screen projection ---------------------------------------------------

function projectScreen(
    handoff: ScreenImplementationHandoff,
    reviewModel: ScreenReviewModel | undefined,
): ScreensHandoffExportScreen {
    const bridge = handoff.traceBridge;
    const trace: ScreensHandoffExportScreenTrace = {
        overallConfidence: bridge ? TRACE_CONFIDENCE_LABELS[bridge.overall.confidence] : undefined,
        dataModelConfidence: bridge ? TRACE_CONFIDENCE_LABELS[bridge.dataModel.confidence] : undefined,
        implementationPlanConfidence: bridge
            ? TRACE_CONFIDENCE_LABELS[bridge.implementationPlan.confidence] : undefined,
        dataModelMatches: bridge
            ? bridge.dataModel.matches.map(m => `${m.entityName} — ${TRACE_CONFIDENCE_LABELS[m.confidence]}`)
            : [],
        implementationPlanMatches: bridge
            ? bridge.implementationPlan.matches.map(
                m => `${m.title}${m.milestoneName ? ` (${m.milestoneName})` : ''} — ${TRACE_CONFIDENCE_LABELS[m.confidence]}`)
            : [],
        warnings: [
            ...handoff.trace.warnings,
            ...(bridge ? bridge.overall.warnings : []),
        ],
    };

    const issues = { blocking: [] as string[], review: [] as string[], info: [] as string[] };
    for (const i of reviewModel?.issues ?? []) {
        if (i.severity === 'blocking') issues.blocking.push(i.title);
        else if (i.severity === 'review') issues.review.push(i.title);
        else issues.info.push(i.title);
    }

    return {
        screenId: handoff.screenId,
        title: handoff.screenTitle,
        priority: handoff.priority,
        reviewStatus: reviewModel?.userStatus ? REVIEW_STATUS_LABELS[reviewModel.userStatus] : undefined,
        systemReadiness: reviewModel ? SYSTEM_READINESS_LABELS[reviewModel.systemReadiness] : undefined,
        handoffReadiness: HANDOFF_READINESS_LABELS[handoff.readiness.status],
        reviewFreshness: reviewModel ? REVIEW_FRESHNESS_LABELS[reviewModel.freshness] : undefined,
        route: handoff.route.path,
        components: handoff.components.map(c => c.name),
        state: handoff.state.map(s => s.name),
        events: handoff.events.map(e => e.name),
        dataDependencies: handoff.dataDependencies.map(d => {
            if (d.source === 'data_model_trace' && d.matchedEntity) {
                const conf = d.confidence ? ` (${TRACE_CONFIDENCE_LABELS[d.confidence].toLowerCase()})` : '';
                return `${d.label} → ${d.matchedEntity}${d.matchedField ? `.${d.matchedField}` : ''}${conf}`;
            }
            return d.label;
        }),
        acceptanceCriteria: [...handoff.acceptanceCriteria],
        qaChecklist: handoff.qaChecklist.map(q => q.label),
        buildTasks: handoff.buildTasks.map(t => t.title),
        mockupReferences: handoff.mockupReferences.map(m => ({
            label: m.label,
            freshness: m.freshness ? FRESHNESS_LABELS[m.freshness] ?? m.freshness : undefined,
            coverage: m.coverage,
            recommendedForBuild: m.recommendedForBuild,
        })),
        trace,
        issues,
    };
}

// --- Summary -----------------------------------------------------------------

function buildSummary(
    handoffs: readonly ScreenImplementationHandoff[],
    reviewModels: ReadonlyMap<string, ScreenReviewModel>,
    p0Ids: ReadonlySet<string>,
): ScreensHandoffExportSummary {
    let accepted = 0, implReady = 0, blocked = 0, reviewRec = 0;
    const trace: ScreensHandoffExportTraceSummary = {
        explicit: 0, strong: 0, weak: 0, estimated: 0, missing: 0,
    };
    let mockGenerated = 0, mockMissing = 0, mockStale = 0, mockUnknown = 0;

    for (const h of handoffs) {
        const model = reviewModels.get(h.screenId);
        if (model?.userStatus === 'accepted') accepted += 1;
        if (model?.userStatus === 'implementation_ready') implReady += 1;
        if (h.readiness.status === 'blocked') blocked += 1;
        else if (h.readiness.status === 'review_recommended') reviewRec += 1;

        // Trace — one bucket per screen's overall confidence (screens with no
        // bridge are not counted; a bridge with both traces missing → missing).
        const bridge = h.traceBridge;
        if (bridge) {
            const oc = bridge.overall.confidence;
            if (oc === 'explicit') trace.explicit += 1;
            else if (oc === 'strong') trace.strong += 1;
            else if (oc === 'weak') trace.weak += 1;
            else if (oc === 'estimated') trace.estimated += 1;
            else trace.missing += 1;
        }

        // Mockups — derived from the handoff's build-facing references. A screen
        // with no build-recommended reference counts once toward "missing".
        const buildRefs = h.mockupReferences.filter(m => m.recommendedForBuild);
        if (buildRefs.length === 0) mockMissing += 1;
        else mockGenerated += buildRefs.length;
        for (const m of h.mockupReferences) {
            if (m.freshness === 'stale' || m.freshness === 'possibly_stale') mockStale += 1;
            else if (m.freshness === 'unknown' || m.coverage === 'unknown') mockUnknown += 1;
        }
    }

    return {
        totalScreens: handoffs.length,
        p0Screens: handoffs.filter(h => p0Ids.has(h.screenId)).length,
        acceptedScreens: accepted,
        implementationReadyScreens: implReady,
        blockedScreens: blocked,
        reviewRecommendedScreens: reviewRec,
        trace,
        mockups: {
            generated: mockGenerated,
            missing: mockMissing,
            stale: mockStale,
            unknownFreshness: mockUnknown,
        },
    };
}

// --- Manifest ----------------------------------------------------------------

function buildManifest(
    input: ScreensHandoffExportInput,
    dynamicCaveats: readonly string[],
): ScreensHandoffExportManifest {
    const m = input.manifest ?? {};
    const includedArtifacts: ScreensHandoffExportManifestArtifact[] = [];

    // Screens is always the subject of this export.
    includedArtifacts.push({
        kind: 'screens',
        versionId: m.screensArtifactVersionId,
        title: 'Screens',
    });
    if (m.prdVersionId) {
        includedArtifacts.push({ kind: 'prd', versionId: m.prdVersionId, title: 'PRD' });
    }
    if (m.dataModelPresent) {
        includedArtifacts.push({
            kind: 'data_model',
            versionId: m.dataModelArtifactVersionId,
            title: 'Data Model',
            traceConfidence: summarizeArtifactTrace(input.handoffs, 'dataModel'),
        });
    }
    if (m.implementationPlanPresent) {
        includedArtifacts.push({
            kind: 'implementation_plan',
            versionId: m.implementationPlanArtifactVersionId,
            title: 'Implementation Plan',
            traceConfidence: summarizeArtifactTrace(input.handoffs, 'implementationPlan'),
        });
    }
    if (m.designSystemVersionId) {
        includedArtifacts.push({
            kind: 'design_system', versionId: m.designSystemVersionId, title: 'Design System',
        });
    }

    // Absence notes — a caveat, never a defect.
    const absenceCaveats: string[] = [];
    if (!m.dataModelPresent) {
        absenceCaveats.push('No Data Model artifact was available — data-dependency traces are estimated from the screen specs only.');
    }
    if (!m.implementationPlanPresent) {
        absenceCaveats.push('No Implementation Plan artifact was available — plan references could not be correlated.');
    }

    return {
        prdVersionId: m.prdVersionId,
        screensArtifactVersionId: m.screensArtifactVersionId,
        dataModelArtifactVersionId: m.dataModelArtifactVersionId,
        implementationPlanArtifactVersionId: m.implementationPlanArtifactVersionId,
        designSystemVersionId: m.designSystemVersionId,
        includedArtifacts,
        caveats: [...SCREENS_HANDOFF_EXPORT_CAVEATS, ...absenceCaveats, ...dynamicCaveats],
    };
}

/** Summarize the trace confidence for ONE downstream artifact (Data Model or
 * Implementation Plan) across the traced screens. Reads each screen bridge's
 * artifact-specific confidence — NOT `bridge.overall.confidence` — so a manifest
 * entry can never claim "Strong" for an artifact whose every trace is missing
 * just because the other artifact matched. Returns undefined when no screen
 * carried a trace bridge. */
function summarizeArtifactTrace(
    handoffs: readonly ScreenImplementationHandoff[],
    kind: 'dataModel' | 'implementationPlan',
): string | undefined {
    let traced = 0, strong = 0, estimated = 0, missing = 0;
    for (const h of handoffs) {
        const bridge = h.traceBridge;
        if (!bridge) continue;
        traced += 1;
        const c = kind === 'dataModel' ? bridge.dataModel.confidence : bridge.implementationPlan.confidence;
        if (c === 'explicit' || c === 'strong') strong += 1;
        else if (c === 'weak' || c === 'estimated') estimated += 1;
        else missing += 1;
    }
    if (traced === 0) return undefined;
    if (strong === traced) return 'Strong across all traced screens';
    if (missing === traced) return 'No matches across traced screens';
    return `${strong} strong · ${estimated} estimated · ${missing} missing (of ${traced} traced)`;
}

// --- Status ------------------------------------------------------------------

/**
 * Derive the export status: the more conservative of the Phase 4B preflight
 * status and the Phase 5A/5B handoff-rollup status. Both already encode the
 * honesty rules — an absent Data Model / Implementation Plan is never a blocker
 * in either, so absence can never force `not_ready`. Folding them (rather than
 * re-deriving) keeps the export from ever contradicting the preflight the user
 * already sees, while letting a handoff-only concern (e.g. a P0 with no
 * build-ready handoff) still down-rank a preflight that reads clean.
 */
export function deriveScreensExportStatus(
    preflight: ScreensPreflightModel,
    handoffRollup: ScreensHandoffRollup,
): ScreensHandoffExportStatus {
    // The handoff rollup speaks the per-screen vocabulary ('blocked'); map it to
    // the export/preflight vocabulary ('not_ready') before folding.
    const rollupStatus = toExportStatus(handoffRollup.status);
    return worseStatus(preflight.status, rollupStatus);
}

// --- Builder -----------------------------------------------------------------

/**
 * Build the full, schema-versioned Screens implementation-handoff export
 * package. Pure and read-only — composes the already-derived preflight,
 * handoffs, trace bridges, and review models. Never mutates an artifact and
 * never embeds binary image data.
 */
export function buildScreensHandoffExportPackage(
    input: ScreensHandoffExportInput,
): ScreensHandoffExportPackage {
    const status = deriveScreensExportStatus(input.preflight, input.handoffRollup);
    const summary = buildSummary(input.handoffs, input.reviewModels, input.p0Ids);

    const screens = input.handoffs.map(h => projectScreen(h, input.reviewModels.get(h.screenId)));

    const preflight: ScreensHandoffExportPreflight = {
        blocking: [...input.preflight.blocking],
        review: [...input.preflight.review],
        info: [...input.preflight.info],
        recommendedNextActions: [...input.preflight.recommendedNextActions],
    };

    const manifest = buildManifest(input, input.preflight.caveats);

    return {
        schemaVersion: 1,
        projectName: input.projectName,
        exportedAt: input.exportedAt,
        status,
        summary,
        preflight,
        screens,
        manifest,
    };
}

// --- Status labels (shared by UI + renderers) --------------------------------

export const EXPORT_STATUS_LABELS: Record<ScreensHandoffExportStatus, string> = {
    ready: 'Ready to export',
    review_recommended: 'Export includes review notes',
    not_ready: 'This handoff is not ready yet',
};

export const EXPORT_STATUS_DESCRIPTIONS: Record<ScreensHandoffExportStatus, string> = {
    ready: 'All P0 screens are signed off and no blocking handoff issues were found.',
    review_recommended: 'This package is usable, but includes trace/mockup caveats for developers.',
    not_ready: 'The export will include the current screens, but the issues below may affect implementation.',
};

// --- Markdown renderer -------------------------------------------------------

/** Render the export package as a copy/paste-ready markdown handoff document.
 * Practical structure (summary → preflight → manifest → per-screen sections),
 * easy to drop into a coding agent, GitHub, Linear, or a spec doc. Never embeds
 * image data; missing/estimated data is labeled honestly. */
export function renderScreensHandoffExportMarkdown(pkg: ScreensHandoffExportPackage): string {
    const lines: string[] = [];
    const push = (s = '') => lines.push(s);

    push('# Screens Implementation Handoff');
    if (pkg.projectName) push(`Project: ${pkg.projectName}`);
    push(`Status: ${EXPORT_STATUS_LABELS[pkg.status]}`);
    push(`Exported: ${pkg.exportedAt}`);
    push();

    // Summary
    const s = pkg.summary;
    push('## Summary');
    push(`- Screens: ${s.totalScreens} total`);
    push(`- P0 screens: ${s.p0Screens}`);
    push(`- Accepted: ${s.acceptedScreens}`);
    push(`- Implementation-ready: ${s.implementationReadyScreens}`);
    push(`- Blocked handoffs: ${s.blockedScreens}`);
    push(`- Review recommended: ${s.reviewRecommendedScreens}`);
    push(`- Trace: ${s.trace.explicit} explicit · ${s.trace.strong} strong · ${s.trace.weak} weak · ${s.trace.estimated} estimated · ${s.trace.missing} missing`);
    push(`- Mockups: ${s.mockups.generated} generated · ${s.mockups.missing} missing · ${s.mockups.stale} stale · ${s.mockups.unknownFreshness} unknown freshness`);
    push();

    // Preflight
    push('## Preflight');
    if (pkg.preflight.blocking.length > 0) {
        push('### Blocking');
        for (const b of pkg.preflight.blocking) push(`- ${b}`);
        push();
    }
    if (pkg.preflight.review.length > 0) {
        push('### Review recommended');
        for (const r of pkg.preflight.review) push(`- ${r}`);
        push();
    }
    if (pkg.preflight.info.length > 0) {
        push('### For your information');
        for (const i of pkg.preflight.info) push(`- ${i}`);
        push();
    }
    if (pkg.preflight.recommendedNextActions.length > 0) {
        push('### Recommended next actions');
        pkg.preflight.recommendedNextActions.forEach((a, i) => push(`${i + 1}. ${a}`));
        push();
    }
    if (pkg.preflight.blocking.length === 0 && pkg.preflight.review.length === 0
        && pkg.preflight.info.length === 0 && pkg.preflight.recommendedNextActions.length === 0) {
        push('- No blocking or review items detected.');
        push();
    }

    // Manifest
    push('## Export Manifest');
    for (const a of pkg.manifest.includedArtifacts) {
        const v = a.versionId ? ` — ${a.versionId}` : '';
        const t = a.traceConfidence ? ` (trace: ${a.traceConfidence})` : '';
        push(`- ${a.title ?? a.kind}${v}${t}`);
    }
    push();
    push('Caveats:');
    for (const c of pkg.manifest.caveats) push(`- ${c}`);
    push();

    // Screens
    for (const screen of pkg.screens) {
        push('---');
        push();
        const priority = screen.priority ? ` (${screen.priority})` : '';
        push(`# Screen: ${screen.title}${priority}`);
        if (screen.reviewStatus) push(`Review: ${screen.reviewStatus}`);
        if (screen.systemReadiness) push(`System readiness: ${screen.systemReadiness}`);
        if (screen.handoffReadiness) push(`Handoff readiness: ${screen.handoffReadiness}`);
        if (screen.trace.overallConfidence) push(`Trace confidence: ${screen.trace.overallConfidence}`);
        push();

        push('## Route');
        push(screen.route ? `- \`${screen.route}\`` : '- Not specified');
        push();

        renderList(push, 'Components', screen.components);
        renderList(push, 'State', screen.state);
        renderList(push, 'Events', screen.events);
        renderList(push, 'Data Dependencies', screen.dataDependencies,
            'No linked data model entities found — review before implementation.');

        push('## Mockups');
        if (screen.mockupReferences.length > 0) {
            for (const m of screen.mockupReferences) {
                const bits: string[] = [];
                if (m.freshness) bits.push(`freshness ${m.freshness.toLowerCase()}`);
                if (m.coverage) bits.push(`coverage ${m.coverage}`);
                push(`- ${m.label}${bits.length ? ` — ${bits.join(', ')}` : ''}`);
            }
        } else {
            push('- No generated mockups to reference yet.');
        }
        push();

        renderList(push, 'Acceptance Criteria', screen.acceptanceCriteria);
        renderList(push, 'QA Checklist', screen.qaChecklist);
        renderList(push, 'Build Tasks', screen.buildTasks);

        push('## Data Model Support');
        if (screen.trace.dataModelMatches.length > 0) {
            for (const m of screen.trace.dataModelMatches) push(`- ${m}`);
        } else {
            push('- No linked Data Model entities found.');
        }
        push();

        push('## Related Implementation Plan Items');
        if (screen.trace.implementationPlanMatches.length > 0) {
            for (const m of screen.trace.implementationPlanMatches) push(`- ${m}`);
        } else {
            push('- No related Implementation Plan tasks found.');
        }
        push();

        const anyIssues = screen.issues.blocking.length > 0 || screen.issues.review.length > 0;
        if (anyIssues) {
            push('## Issues');
            if (screen.issues.blocking.length > 0) {
                push('Blocking:');
                for (const i of screen.issues.blocking) push(`- ${i}`);
            }
            if (screen.issues.review.length > 0) {
                push('Review:');
                for (const i of screen.issues.review) push(`- ${i}`);
            }
            push();
        }

        if (screen.trace.warnings.length > 0) {
            push('## Trace Notes');
            for (const w of screen.trace.warnings) push(`- ${w}`);
            push();
        }
    }

    return lines.join('\n').replace(/\n+$/, '') + '\n';
}

function renderList(push: (s?: string) => void, title: string, items: readonly string[], empty = 'Not specified') {
    push(`## ${title}`);
    if (items.length > 0) for (const it of items) push(`- ${it}`);
    else push(`- ${empty}`);
    push();
}

// --- JSON renderer -----------------------------------------------------------

/** Render the export package as pretty-printed JSON (two-space indent). The
 * package already carries only references/labels — no binary image data — so
 * this is a straight serialization. */
export function renderScreensHandoffExportJson(pkg: ScreensHandoffExportPackage): string {
    return JSON.stringify(pkg, null, 2);
}

// --- Filename helper ----------------------------------------------------------

/** Build a safe download filename for an export. */
export function screensHandoffExportFilename(
    pkg: ScreensHandoffExportPackage, format: ScreensHandoffExportFormat,
): string {
    const base = (pkg.projectName ?? 'screens')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'screens';
    const ext = format === 'json' ? 'json' : 'md';
    return `${base}-screens-handoff.${ext}`;
}
