import type { SectionId } from '../../lib/schemas/prdSchemas';
import { getFastModel, getStrongModel } from '../../lib/geminiClient';
import {
    DEFAULT_PRD_SECTIONS,
    selectModelTier,
    type PrdSectionTemplate,
} from '../../lib/services/progressivePrdGeneration';
import { SECTION_TITLES, SECTION_DESCRIPTIONS } from '../../lib/prompts/prdSectionPrompts';
import type { PrdSectionStatusEntry } from '../../store/slices/prdProgressSlice';
import type { GenerationStep, GenerationStepStatus } from './types';

export type SectionStatusMap = Partial<Record<SectionId, PrdSectionStatusEntry | undefined>>;

// ─── Model name formatting ───────────────────────────────────────────────────

const SUFFIX_WORDS = new Set(['preview', 'exp', 'experimental', 'latest']);

/**
 * Render a raw Gemini model id as a human-friendly label, e.g.
 * `gemini-3-flash-preview` → "Gemini 3 Flash (preview)",
 * `gemini-1.5-pro` → "Gemini 1.5 Pro". Derives entirely from the configured id
 * so no model name is ever hardcoded.
 */
export const formatModelName = (raw?: string): string => {
    if (!raw || !raw.trim()) return 'Gemini';
    let id = raw.trim();
    if (id.startsWith('models/')) id = id.slice('models/'.length);

    const parts = id.split('-').filter(Boolean);
    const main: string[] = [];
    const suffixes: string[] = [];
    for (const p of parts) {
        if (SUFFIX_WORDS.has(p.toLowerCase())) suffixes.push(p.toLowerCase());
        else main.push(p);
    }

    const titled = main.map((p, i) => {
        if (i === 0 && p.toLowerCase() === 'gemini') return 'Gemini';
        if (/^[0-9]/.test(p)) return p; // version numbers stay as-is (1.5, 2.0, 3)
        return p.charAt(0).toUpperCase() + p.slice(1);
    });

    let label = titled.join(' ');
    if (suffixes.length) label += ` (${suffixes.join(' ')})`;
    return label || raw;
};

// ─── Dependency waves (topological levels) ──────────────────────────────────

/**
 * Group sections into dependency "waves": a wave is the set of sections at the
 * same topological depth (level = 1 + max(level of dependencies)). Sections in
 * the same wave can run concurrently. Purely graph-derived, so it supports
 * arbitrary dependency graphs, multiple concurrent groups, and any step count.
 * Within a wave, sections are ordered by their declared `order` for stability.
 */
export const computeWaves = (
    sections: PrdSectionTemplate[] = DEFAULT_PRD_SECTIONS,
): PrdSectionTemplate[][] => {
    const byId = new Map(sections.map((s) => [s.id, s]));
    const levelCache = new Map<string, number>();

    const levelOf = (id: string, seen: Set<string> = new Set()): number => {
        if (levelCache.has(id)) return levelCache.get(id)!;
        if (seen.has(id)) return 0; // cycle guard
        seen.add(id);
        const section = byId.get(id as SectionId);
        const deps = section?.dependencies ?? [];
        const level = deps.length === 0
            ? 1
            : 1 + Math.max(...deps.map((d) => levelOf(d, seen)));
        levelCache.set(id, level);
        return level;
    };

    const waves = new Map<number, PrdSectionTemplate[]>();
    for (const s of sections) {
        const lvl = levelOf(s.id);
        if (!waves.has(lvl)) waves.set(lvl, []);
        waves.get(lvl)!.push(s);
    }

    return [...waves.keys()]
        .sort((a, b) => a - b)
        .map((lvl) => waves.get(lvl)!.sort((a, b) => a.order - b.order));
};

// ─── Status mapping ──────────────────────────────────────────────────────────

const mapStatus = (s?: PrdSectionStatusEntry['status']): GenerationStepStatus => {
    if (s === 'complete') return 'completed';
    if (s === 'error') return 'failed';
    if (s === 'generating') return 'in_progress';
    // 'queued' = dependencies satisfied, waiting for a concurrency slot — kept
    // distinct from 'pending' (waiting on deps) so the UI can label them apart.
    if (s === 'queued') return 'queued';
    return 'pending';
};

const groupStatus = (children: GenerationStep[]): GenerationStepStatus => {
    if (children.some((c) => c.status === 'failed')) return 'failed';
    if (children.some((c) => c.status === 'in_progress')) return 'in_progress';
    if (children.some((c) => c.status === 'queued')) return 'queued';
    if (children.length > 0 && children.every((c) => c.status === 'completed')) return 'completed';
    return 'pending';
};

const COLUMN_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// ─── Step builder ────────────────────────────────────────────────────────────

export type BuildOptions = {
    sections?: PrdSectionTemplate[];
    fastModel?: string;
    strongModel?: string;
};

const buildLeaf = (
    template: PrdSectionTemplate,
    label: string,
    status: SectionStatusMap,
    fastModel: string,
    strongModel: string,
    executionMode: 'sequential' | 'concurrent',
): GenerationStep => {
    const entry = status[template.id];
    const stepStatus = mapStatus(entry?.status);
    const tier = selectModelTier(template.risk);
    const modelName = formatModelName(entry?.model ?? (tier === 'fast' ? fastModel : strongModel));
    // Resolve dependency ids to human titles for the "Waits on:" hint.
    const depIds = entry?.dependsOn ?? template.dependencies ?? [];
    const dependsOn = depIds.map((d) => SECTION_TITLES[d] ?? d);
    return {
        id: template.id,
        sectionId: template.id,
        label,
        title: SECTION_TITLES[template.id],
        description: SECTION_DESCRIPTIONS[template.id],
        status: stepStatus,
        modelName,
        estimatedSeconds: entry?.estimatedSeconds ?? template.estimatedSeconds,
        actualSeconds: entry?.ms != null ? entry.ms / 1000 : undefined,
        startedAt: entry?.startedAt,
        errorMessage: entry?.error,
        canRetry: stepStatus === 'failed',
        executionMode,
        dependsOn,
        retryCount: entry?.retryCount,
    };
};

/**
 * Build the timeline tree from live section status. Single-section waves become
 * sequential rows; multi-section waves become a synthetic "Running concurrently"
 * group whose children are the parallel sections (labeled "2A", "2B", …).
 */
export const buildGenerationSteps = (
    status: SectionStatusMap = {},
    opts: BuildOptions = {},
): GenerationStep[] => {
    const sections = opts.sections ?? DEFAULT_PRD_SECTIONS;
    const fastModel = opts.fastModel ?? getFastModel();
    const strongModel = opts.strongModel ?? getStrongModel();
    const waves = computeWaves(sections);

    return waves.map((wave, waveIdx) => {
        const number = String(waveIdx + 1);
        if (wave.length === 1) {
            return buildLeaf(wave[0], number, status, fastModel, strongModel, 'sequential');
        }
        const children = wave.map((template, childIdx) =>
            buildLeaf(
                template,
                `${number}${COLUMN_LABELS[childIdx] ?? childIdx + 1}`,
                status,
                fastModel,
                strongModel,
                'concurrent',
            ),
        );
        return {
            id: `wave-${number}`,
            label: number,
            title: 'Running concurrently',
            description: '',
            status: groupStatus(children),
            modelName: '',
            executionMode: 'concurrent',
            children,
        };
    });
};

// ─── Aggregate selectors ─────────────────────────────────────────────────────

export const flattenLeaves = (steps: GenerationStep[]): GenerationStep[] =>
    steps.flatMap((s) => (s.children?.length ? s.children : [s]));

export type TimelineSummary = {
    completed: number;
    total: number;
    percent: number;
    status: GenerationStepStatus;
};

export const summarizeSteps = (steps: GenerationStep[]): TimelineSummary => {
    const leaves = flattenLeaves(steps);
    const total = leaves.length;
    const completed = leaves.filter((l) => l.status === 'completed').length;
    const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

    let status: GenerationStepStatus;
    if (total > 0 && completed === total) status = 'completed';
    else if (leaves.some((l) => l.status === 'in_progress')) status = 'in_progress';
    else if (leaves.some((l) => l.status === 'failed')) status = 'failed';
    else status = 'in_progress'; // all pending — generation is starting up

    return { completed, total, percent, status };
};
