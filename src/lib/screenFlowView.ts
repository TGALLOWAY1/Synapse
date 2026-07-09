// Flow-first presentation helpers for the Screens (Experience) list view.
//
// Pure & framework-free (no store / React / IDB) so it can be unit-tested in
// isolation. This module answers the two questions the redesigned Screens list
// leads with — "what flow does a screen belong to?" and "where does the user go
// next?" — by deriving grouping and connection data from the already-joined
// ScreenExperienceIndex. It never mutates the index and never invents a
// connection the artifacts don't already describe.

import type { ScreenExperienceIndex, ScreenExperienceItem } from './screenExperience';
import { stylablePriority } from '../components/renderers/screenPriority';

/** Connections a single screen participates in, derived from its own spec. */
export interface ScreenConnections {
    /** Ways users arrive (entry-point labels from the screen contract). */
    incoming: string[];
    /** Where users go next — exit-path target screen names (deduped, in order). */
    outgoing: string[];
    /** Titles of the user flows this screen appears in (deduped, flow order). */
    flowTitles: string[];
}

const dedupe = (values: Iterable<string>): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of values) {
        const value = raw.trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        out.push(value);
    }
    return out;
};

/**
 * Derive the human-readable connections for one screen — names, not counts.
 * Outgoing comes from `exitPaths[].target` (usually a screen name), incoming
 * from `entryPoints` (arrival triggers / origins), and the flow titles from the
 * joined `relatedFlows`. Everything is deduped and order-preserving.
 */
export function deriveScreenConnections(item: ScreenExperienceItem): ScreenConnections {
    const { screen } = item;
    const outgoing = dedupe((screen.exitPaths ?? []).map(p => p.target ?? '').filter(Boolean));
    const incoming = dedupe((screen.entryPoints ?? []).filter(Boolean));
    const flowTitles = dedupe(item.relatedFlows.map(ref => ref.flow.title).filter(Boolean));
    return { incoming, outgoing, flowTitles };
}

// --- Grouping -----------------------------------------------------------------

export type ScreenGroupMode = 'flow' | 'section' | 'priority';

/** One display group of screens for the list (a flow, a section, or a tier). */
export interface ScreenDisplayGroup {
    /** Stable key for React lists / group state. */
    id: string;
    title: string;
    subtitle?: string;
    items: ScreenExperienceItem[];
}

/** The primary flow a screen belongs to — the flow where it appears earliest.
 * Ties break on flow order, then step order, so the assignment is stable. */
function primaryFlowRef(item: ScreenExperienceItem): { flowIndex: number; stepIndex: number; title: string } | null {
    let best: { flowIndex: number; stepIndex: number; title: string } | null = null;
    for (const ref of item.relatedFlows) {
        if (!ref.flow.title) continue;
        if (
            !best
            || ref.stepIndex < best.stepIndex
            || (ref.stepIndex === best.stepIndex && ref.flowIndex < best.flowIndex)
        ) {
            best = { flowIndex: ref.flowIndex, stepIndex: ref.stepIndex, title: ref.flow.title };
        }
    }
    return best;
}

const OTHER_GROUP_ID = '__other__';

/** Group screens by their primary user flow, ordered by flow appearance. Screens
 * not referenced by any flow collect in a trailing "Other screens" group so
 * nothing is dropped. Within a flow, screens follow their step order. */
function groupByFlow(index: ScreenExperienceIndex): ScreenDisplayGroup[] {
    interface Bucket {
        flowIndex: number;
        title: string;
        entries: Array<{ item: ScreenExperienceItem; stepIndex: number; order: number }>;
    }
    const buckets = new Map<number, Bucket>();
    const other: ScreenExperienceItem[] = [];

    index.items.forEach((item, order) => {
        const primary = primaryFlowRef(item);
        if (!primary) {
            other.push(item);
            return;
        }
        let bucket = buckets.get(primary.flowIndex);
        if (!bucket) {
            bucket = { flowIndex: primary.flowIndex, title: primary.title, entries: [] };
            buckets.set(primary.flowIndex, bucket);
        }
        bucket.entries.push({ item, stepIndex: primary.stepIndex, order });
    });

    const groups: ScreenDisplayGroup[] = [...buckets.values()]
        .sort((a, b) => a.flowIndex - b.flowIndex)
        .map(bucket => {
            const items = bucket.entries
                .sort((a, b) => (a.stepIndex - b.stepIndex) || (a.order - b.order))
                .map(e => e.item);
            return {
                id: `flow:${bucket.flowIndex}`,
                title: bucket.title,
                subtitle: `${items.length} ${items.length === 1 ? 'screen' : 'screens'}`,
                items,
            };
        });

    if (other.length > 0) {
        groups.push({
            id: OTHER_GROUP_ID,
            title: 'Other screens',
            subtitle: 'Not referenced by a user flow yet',
            items: other,
        });
    }
    return groups;
}

/** Group screens by the inventory section they were generated under. */
function groupBySection(index: ScreenExperienceIndex): ScreenDisplayGroup[] {
    return index.sections.map((section, i) => ({
        id: `section:${i}`,
        title: section.title,
        subtitle: section.description,
        items: section.items,
    }));
}

const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3'] as const;
const PRIORITY_TITLES: Record<string, string> = {
    P0: 'P0 · Critical',
    P1: 'P1 · Important',
    P2: 'P2 · Secondary',
    P3: 'P3 · Nice to have',
};

/** Group screens by priority tier, highest first. */
function groupByPriority(index: ScreenExperienceIndex): ScreenDisplayGroup[] {
    const byTier = new Map<string, ScreenExperienceItem[]>();
    for (const item of index.items) {
        const tier = stylablePriority(item.screen.priority);
        const list = byTier.get(tier) ?? [];
        list.push(item);
        byTier.set(tier, list);
    }
    return PRIORITY_ORDER
        .filter(tier => byTier.has(tier))
        .map(tier => {
            const items = byTier.get(tier)!;
            return {
                id: `priority:${tier}`,
                title: PRIORITY_TITLES[tier],
                subtitle: `${items.length} ${items.length === 1 ? 'screen' : 'screens'}`,
                items,
            };
        });
}

/** Build the display groups for the given grouping mode. */
export function buildScreenGroups(index: ScreenExperienceIndex, mode: ScreenGroupMode): ScreenDisplayGroup[] {
    switch (mode) {
        case 'flow':
            return groupByFlow(index);
        case 'priority':
            return groupByPriority(index);
        case 'section':
        default:
            return groupBySection(index);
    }
}

/** True when at least one screen is referenced by a user flow — the signal for
 * defaulting the list to flow grouping. */
export function hasFlowGrouping(index: ScreenExperienceIndex): boolean {
    return index.items.some(item => primaryFlowRef(item) !== null);
}

/** Distinct flow titles across the index, for the Flow filter dropdown. */
export function flowFilterOptions(index: ScreenExperienceIndex): string[] {
    return dedupe(index.items.flatMap(item => item.relatedFlows.map(ref => ref.flow.title)));
}
