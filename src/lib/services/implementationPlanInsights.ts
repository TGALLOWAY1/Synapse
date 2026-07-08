/**
 * Pure render-time derivations for the Implementation Plan view: prompt-pack
 * build order and "next prompt" resolution, quality-gate rows with milestone/
 * prompt linkage, the coverage matrix with change-impact analysis, critical
 * path resolution, and structured prompt previews. No store/LLM/React access.
 *
 * Gate run-status is NEVER invented: every gate defaults to `not_run`. Only a
 * user-set status — persisted as the `planProgress` metadata overlay on the
 * implementation_plan ArtifactVersion (same pattern as screenEdits /
 * promptEdits: per-version, cleared by regeneration) — can change it. Copied
 * prompt packs are tracked in the same overlay so "Copy next prompt" advances.
 */

import type {
    ConsolidatedImplementationPlan,
    ImplementationPromptPack,
    ImplementationQualityGate,
} from '../../types';

// --- planProgress metadata overlay ------------------------------------------

export type QualityGateRunStatus = 'not_run' | 'passed' | 'failed' | 'needs_review' | 'blocked';

export const GATE_RUN_STATUSES: QualityGateRunStatus[] = [
    'not_run', 'passed', 'failed', 'needs_review', 'blocked',
];

export interface ImplementationPlanProgress {
    /** User-verified gate outcomes keyed by gate id. Absent = not run. */
    gateStatuses: Record<string, QualityGateRunStatus>;
    /** Prompt-pack ids the user has copied, in the order they copied them. */
    copiedPacks: string[];
}

export const EMPTY_PLAN_PROGRESS: ImplementationPlanProgress = { gateStatuses: {}, copiedPacks: [] };

/** Defensively read the overlay off persisted version metadata. */
export function readPlanProgress(metadata?: Record<string, unknown>): ImplementationPlanProgress {
    const raw = metadata?.planProgress;
    if (!raw || typeof raw !== 'object') return EMPTY_PLAN_PROGRESS;
    const candidate = raw as Partial<ImplementationPlanProgress>;
    const gateStatuses: Record<string, QualityGateRunStatus> = {};
    if (candidate.gateStatuses && typeof candidate.gateStatuses === 'object') {
        for (const [id, status] of Object.entries(candidate.gateStatuses)) {
            if (GATE_RUN_STATUSES.includes(status as QualityGateRunStatus)) {
                gateStatuses[id] = status as QualityGateRunStatus;
            }
        }
    }
    const copiedPacks = Array.isArray(candidate.copiedPacks)
        ? candidate.copiedPacks.filter((id): id is string => typeof id === 'string')
        : [];
    return { gateStatuses, copiedPacks };
}

// --- Plan scope ---------------------------------------------------------------

export interface PlanScope {
    milestones: number;
    tasks: number;
    promptPacks: number;
    qualityGates: number;
}

export function computePlanScope(plan: ConsolidatedImplementationPlan): PlanScope {
    return {
        milestones: plan.milestones.length,
        tasks: plan.milestones.reduce((n, m) => n + m.tasks.length, 0),
        promptPacks:
            plan.milestones.reduce((n, m) => n + (m.promptPacks?.length ?? 0), 0)
            + plan.unassignedPromptPacks.length,
        qualityGates:
            plan.globalQualityGates.length
            + plan.milestones.reduce((n, m) => n + (m.qualityGates?.length ?? 0), 0),
    };
}

// --- Prompt-pack build order ----------------------------------------------------

export interface OrderedPromptPack {
    pack: ImplementationPromptPack;
    /** 1-based position in the recommended execution order. */
    order: number;
    milestoneId?: string;
    milestoneName?: string;
    /** 0-based milestone index (for the "M2" label). Absent for unassigned packs. */
    milestoneIndex?: number;
    /** Display names of milestones that must complete first. Empty = start anywhere. */
    prerequisiteNames: string[];
    /** Titles of the owning milestone's quality gates. */
    relatedGateTitles: string[];
}

/** All prompt packs in recommended execution order (milestone order, then unassigned). */
export function orderPromptPacks(plan: ConsolidatedImplementationPlan): OrderedPromptPack[] {
    const nameById = new Map(plan.milestones.map(m => [m.id, m.name] as const));
    const out: OrderedPromptPack[] = [];
    let order = 1;
    plan.milestones.forEach((m, milestoneIndex) => {
        for (const pack of m.promptPacks ?? []) {
            out.push({
                pack,
                order: order++,
                milestoneId: m.id,
                milestoneName: m.name,
                milestoneIndex,
                prerequisiteNames: (m.dependencies ?? []).map(d => nameById.get(d) ?? d),
                relatedGateTitles: (m.qualityGates ?? []).map(g => g.title),
            });
        }
    });
    for (const pack of plan.unassignedPromptPacks) {
        out.push({ pack, order: order++, prerequisiteNames: [], relatedGateTitles: [] });
    }
    return out;
}

/** First pack the user hasn't copied yet; null when every pack was copied. */
export function findNextPromptPack(
    ordered: OrderedPromptPack[],
    copiedPackIds: ReadonlySet<string>,
): OrderedPromptPack | null {
    return ordered.find(o => !copiedPackIds.has(o.pack.id)) ?? null;
}

// --- Quality-gate rows ----------------------------------------------------------

export interface QualityGateRowModel {
    gate: ImplementationQualityGate;
    /** Absent for plan-wide (global) gates. */
    milestoneId?: string;
    milestoneName?: string;
    milestoneIndex?: number;
    /** Titles of the owning milestone's prompt packs (the work this gate checks). */
    relatedPackTitles: string[];
    /** The owning milestone's validation commands — the concrete "how to verify". */
    verifyCommands: string[];
    /** "M2 · Ingestion UI" for required milestone gates — what this gate blocks. */
    blocksLabel?: string;
}

export function buildGateRows(plan: ConsolidatedImplementationPlan): QualityGateRowModel[] {
    const rows: QualityGateRowModel[] = plan.globalQualityGates.map(gate => ({
        gate,
        relatedPackTitles: [],
        verifyCommands: [],
    }));
    plan.milestones.forEach((m, milestoneIndex) => {
        for (const gate of m.qualityGates ?? []) {
            rows.push({
                gate,
                milestoneId: m.id,
                milestoneName: m.name,
                milestoneIndex,
                relatedPackTitles: (m.promptPacks ?? []).map(p => p.title),
                verifyCommands: m.validationCommands ?? [],
                blocksLabel: gate.required ? `M${milestoneIndex + 1} · ${m.name}` : undefined,
            });
        }
    });
    return rows;
}

export interface GateStatusSummary {
    total: number;
    required: number;
    byStatus: Record<QualityGateRunStatus, number>;
}

export function summarizeGateStatuses(
    rows: QualityGateRowModel[],
    statuses: Record<string, QualityGateRunStatus>,
): GateStatusSummary {
    const byStatus: Record<QualityGateRunStatus, number> = {
        not_run: 0, passed: 0, failed: 0, needs_review: 0, blocked: 0,
    };
    for (const row of rows) {
        byStatus[statuses[row.gate.id] ?? 'not_run']++;
    }
    return {
        total: rows.length,
        required: rows.filter(r => r.gate.required).length,
        byStatus,
    };
}

const GATE_STATUS_MARKDOWN_LABELS: Record<QualityGateRunStatus, string> = {
    not_run: 'Not run',
    passed: 'Passed',
    failed: 'Failed',
    needs_review: 'Needs review',
    blocked: 'Blocked',
};

/** A copyable manual-validation checklist (checked only for user-verified passes). */
export function validationChecklistMarkdown(
    rows: QualityGateRowModel[],
    statuses: Record<string, QualityGateRunStatus>,
): string {
    const lines: string[] = ['# Validation Checklist', ''];
    const render = (row: QualityGateRowModel) => {
        const status = statuses[row.gate.id] ?? 'not_run';
        const mark = status === 'passed' ? 'x' : ' ';
        const meta = [row.gate.category, row.gate.required ? 'required' : 'optional'];
        if (status !== 'not_run') meta.push(GATE_STATUS_MARKDOWN_LABELS[status]);
        lines.push(`- [${mark}] ${row.gate.title} _(${meta.join(' · ')})_`);
        if (row.gate.description) lines.push(`  - Why: ${row.gate.description}`);
        for (const cmd of row.verifyCommands) lines.push(`  - Verify: \`${cmd}\``);
    };
    const global = rows.filter(r => !r.milestoneId);
    if (global.length) {
        lines.push('## Plan-wide gates', '');
        global.forEach(render);
        lines.push('');
    }
    const seen = new Set<string>();
    for (const row of rows) {
        if (!row.milestoneId || seen.has(row.milestoneId)) continue;
        seen.add(row.milestoneId);
        lines.push(`## M${(row.milestoneIndex ?? 0) + 1} · ${row.milestoneName}`, '');
        rows.filter(r => r.milestoneId === row.milestoneId).forEach(render);
        lines.push('');
    }
    return lines.join('\n').trim() + '\n';
}

// --- Coverage matrix + change impact ---------------------------------------------

export type CoverageCellState = 'covered' | 'missing' | 'not_tracked';

export interface CoverageCell {
    state: CoverageCellState;
    items: string[];
}

export interface CoverageRowModel {
    milestoneId: string;
    milestoneTitle: string;
    milestoneIndex: number;
    screens: CoverageCell;
    dataModels: CoverageCell;
    components: CoverageCell;
    promptPacks: CoverageCell;
    qualityGates: CoverageCell;
    /** Human-readable gaps ("No prompt pack", "No linked screens"). Empty = covered. */
    gaps: string[];
}

export interface ChangeImpactEntry {
    source: 'prd' | 'screens' | 'data_model' | 'design_system';
    label: string;
    /**
     * all     — every milestone is affected.
     * some    — the listed milestones are affected.
     * none    — this plan links the artifact kind, and no milestone uses it.
     * unknown — the plan records no links of this kind, so impact can't be scoped.
     */
    scope: 'all' | 'some' | 'none' | 'unknown';
    milestones: Array<{ id: string; title: string; index: number }>;
    promptPackCount: number;
    qualityGateCount: number;
    note: string;
}

export interface CoverageMatrix {
    rows: CoverageRowModel[];
    /** Whether the plan records any links of each artifact kind at all. */
    tracked: { screens: boolean; dataModels: boolean; components: boolean };
    impact: ChangeImpactEntry[];
    /** Total gap count across all rows. */
    gapCount: number;
}

function coverageCell(items: string[], kindTracked: boolean): CoverageCell {
    if (items.length > 0) return { state: 'covered', items };
    return { state: kindTracked ? 'missing' : 'not_tracked', items: [] };
}

export function buildCoverageMatrix(plan: ConsolidatedImplementationPlan): CoverageMatrix {
    const packTitleById = new Map<string, string>();
    for (const o of orderPromptPacks(plan)) packTitleById.set(o.pack.id, o.pack.title);
    const gateTitleById = new Map<string, string>();
    plan.globalQualityGates.forEach(g => gateTitleById.set(g.id, g.title));
    plan.milestones.forEach(m => (m.qualityGates ?? []).forEach(g => gateTitleById.set(g.id, g.title)));

    const tracked = {
        screens: plan.traceability.some(r => r.screens.length > 0),
        dataModels: plan.traceability.some(r => r.dataModels.length > 0),
        components: plan.traceability.some(r => r.components.length > 0),
    };

    const rows: CoverageRowModel[] = plan.traceability.map((r, index) => {
        const screens = coverageCell(r.screens, tracked.screens);
        const dataModels = coverageCell(r.dataModels, tracked.dataModels);
        const components = coverageCell(r.components, tracked.components);
        const promptPacks = coverageCell(r.promptPackIds.map(id => packTitleById.get(id) ?? id), true);
        const qualityGates = coverageCell(r.qualityGateIds.map(id => gateTitleById.get(id) ?? id), true);
        const gaps: string[] = [];
        if (promptPacks.state === 'missing') gaps.push('No prompt pack');
        if (qualityGates.state === 'missing') gaps.push('No quality gates');
        if (screens.state === 'missing') gaps.push('No linked screens');
        if (dataModels.state === 'missing') gaps.push('No linked data models');
        if (components.state === 'missing') gaps.push('No linked components');
        return {
            milestoneId: r.milestoneId,
            milestoneTitle: r.milestoneTitle,
            milestoneIndex: index,
            screens, dataModels, components, promptPacks, qualityGates,
            gaps,
        };
    });

    const impactFor = (
        source: ChangeImpactEntry['source'],
        label: string,
        affected: CoverageRowModel[],
        kindTracked: boolean,
        notes: { some: string; none: string; unknown: string },
    ): ChangeImpactEntry => {
        const milestones = affected.map(r => ({ id: r.milestoneId, title: r.milestoneTitle, index: r.milestoneIndex }));
        const promptPackCount = affected.reduce((n, r) => n + r.promptPacks.items.length, 0);
        const qualityGateCount = affected.reduce((n, r) => n + r.qualityGates.items.length, 0);
        if (!kindTracked) {
            return { source, label, scope: 'unknown', milestones: [], promptPackCount: 0, qualityGateCount: 0, note: notes.unknown };
        }
        if (affected.length === 0) {
            return { source, label, scope: 'none', milestones: [], promptPackCount: 0, qualityGateCount: 0, note: notes.none };
        }
        return { source, label, scope: 'some', milestones, promptPackCount, qualityGateCount, note: notes.some };
    };

    const uiRows = rows.filter(r => r.screens.state === 'covered' || r.components.state === 'covered');
    const impact: ChangeImpactEntry[] = [
        {
            source: 'prd',
            label: 'PRD changes',
            scope: 'all',
            milestones: rows.map(r => ({ id: r.milestoneId, title: r.milestoneTitle, index: r.milestoneIndex })),
            promptPackCount: rows.reduce((n, r) => n + r.promptPacks.items.length, 0),
            qualityGateCount: rows.reduce((n, r) => n + r.qualityGates.items.length, 0) + plan.globalQualityGates.length,
            note: 'Every milestone, prompt, and gate derives from the PRD — regenerate this plan after meaningful PRD changes.',
        },
        impactFor('screens', 'Screens changes', rows.filter(r => r.screens.state === 'covered'), tracked.screens, {
            some: 'Milestones that build against the screen inventory.',
            none: 'No milestone links screens — screen changes likely have no scoped impact here.',
            unknown: 'This plan records no screen links, so impact can’t be scoped — assume any milestone may be affected.',
        }),
        impactFor('data_model', 'Data model changes', rows.filter(r => r.dataModels.state === 'covered'), tracked.dataModels, {
            some: 'Milestones that build against the data model.',
            none: 'No milestone links data models — data model changes likely have no scoped impact here.',
            unknown: 'This plan records no data-model links, so impact can’t be scoped — assume any milestone may be affected.',
        }),
        impactFor('design_system', 'Design system changes', uiRows, tracked.screens || tracked.components, {
            some: 'Milestones that build UI (linked screens or components) inherit the visual direction.',
            none: 'No milestone links UI artifacts — design changes likely have no scoped impact here.',
            unknown: 'This plan records no UI links, so impact can’t be scoped — assume UI milestones are affected.',
        }),
    ];

    return {
        rows,
        tracked,
        impact,
        gapCount: rows.reduce((n, r) => n + r.gaps.length, 0),
    };
}

// --- Critical path resolution ------------------------------------------------------

export interface CriticalPathStep {
    label: string;
    /** Set when the step resolves to a plan milestone (clickable in the UI). */
    milestoneId?: string;
}

/**
 * Resolve `summary.criticalPath` entries — which may be milestone ids
 * (`m_setup`), milestone names, or free text with `→` chains — into display
 * steps linked back to milestones where possible.
 */
export function resolveCriticalPath(plan: ConsolidatedImplementationPlan): CriticalPathStep[] {
    const entries = plan.summary.criticalPath ?? [];
    const byId = new Map(plan.milestones.map(m => [m.id, m] as const));
    const byName = new Map(plan.milestones.map(m => [m.name.trim().toLowerCase(), m] as const));
    const steps: CriticalPathStep[] = [];
    for (const entry of entries) {
        for (const part of entry.split(/→|->/)) {
            const label = part.trim();
            if (!label) continue;
            const milestone = byId.get(label) ?? byName.get(label.toLowerCase());
            steps.push(milestone ? { label: milestone.name, milestoneId: milestone.id } : { label });
        }
    }
    return steps;
}

// --- Structured prompt preview --------------------------------------------------------

export interface PromptSectionPreview {
    /** Heading text (`## Goal` → "Goal"); null for content before the first heading. */
    heading: string | null;
    body: string;
}

/**
 * Split a prompt body on its markdown headings (the generated packs use a
 * fixed `## Goal / ## Scope / …` structure) for a structured preview.
 * Headings inside fenced code blocks are ignored. Returns a single
 * heading-less section when the prompt has no structure (plain fallback).
 */
export function parsePromptSections(prompt: string): PromptSectionPreview[] {
    const sections: PromptSectionPreview[] = [];
    let current: PromptSectionPreview = { heading: null, body: '' };
    let inFence = false;
    for (const line of prompt.split('\n')) {
        if (/^\s*```/.test(line)) inFence = !inFence;
        const heading = !inFence && line.match(/^#{1,3}\s+(.+?)\s*$/);
        if (heading) {
            if (current.heading !== null || current.body.trim()) sections.push(current);
            current = { heading: heading[1], body: '' };
        } else {
            current.body += (current.body ? '\n' : '') + line;
        }
    }
    if (current.heading !== null || current.body.trim()) sections.push(current);
    return sections.map(s => ({ ...s, body: s.body.replace(/^\n+|\s+$/g, '') }));
}
