// Pure join layer for the screen-centric Experience workspace.
//
// The Experience view treats each Screen (from the screen_inventory artifact)
// as the canonical object and joins the other two experience artifacts onto it
// **at render time**:
//
//   - user_flows steps reference screens via the bracketed `[Screen Name]`
//     step-title convention (see parseFlow.ts / the user_flows prompt);
//   - mockup screens copy their `name` from the inventory screen they were
//     derived from (see mockupService.generateMockup).
//
// There is no persisted screen id anywhere, so the MVP join key is the same
// slug the per-screen image stores already use: `slugifyScreenName(name)`.
// Nothing here is persisted — this module is a read-side index over artifact
// contents that already live in the store. It must stay pure (no Zustand, no
// IDB, no React) so it can be unit-tested in isolation.

import type {
    MockupPayload,
    MockupScreen,
    ScreenInventoryContent,
    ScreenItem,
    ScreenPriority,
} from '../types';
import { slugifyScreenName } from './screenInventoryImageStore';
import type {
    ParsedFlow,
    ParsedStep,
} from '../components/renderers/userFlows/types';

/**
 * User edit overlay for one screen, keyed by the canonical screen id and
 * stored on the screen_inventory ArtifactVersion as `metadata.screenEdits`
 * (the same overlay pattern as prompt_pack's `metadata.promptEdits`). The
 * generated content is never rewritten: renames change only the *displayed*
 * name, while every join and image key derives from the stored generated
 * name — which is what makes renames unable to orphan relationships.
 */
export interface ScreenMetadataEdit {
    name?: string;
    purpose?: string;
    userIntent?: string;
    priority?: ScreenPriority;
    /** Free-form user notes shown on the screen's Overview tab. */
    notes?: string;
}

export type ScreenEditsMap = Record<string, ScreenMetadataEdit>;

const VALID_EDIT_PRIORITIES: ReadonlySet<string> = new Set(['P0', 'P1', 'P2', 'P3']);

/** Safely extract the screenEdits overlay from ArtifactVersion metadata. */
export function readScreenEdits(metadata: Record<string, unknown> | undefined): ScreenEditsMap {
    const raw = metadata?.screenEdits;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_SCREEN_EDITS;
    const out: ScreenEditsMap = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const v = value as Record<string, unknown>;
        const edit: ScreenMetadataEdit = {};
        if (typeof v.name === 'string' && v.name.trim()) edit.name = v.name.trim();
        if (typeof v.purpose === 'string') edit.purpose = v.purpose;
        if (typeof v.userIntent === 'string') edit.userIntent = v.userIntent;
        if (typeof v.priority === 'string' && VALID_EDIT_PRIORITIES.has(v.priority)) {
            edit.priority = v.priority as ScreenPriority;
        }
        if (typeof v.notes === 'string') edit.notes = v.notes;
        if (Object.keys(edit).length > 0) out[id] = edit;
    }
    return Object.keys(out).length > 0 ? out : EMPTY_SCREEN_EDITS;
}

export const EMPTY_SCREEN_EDITS: ScreenEditsMap = {};

/** Apply an edit overlay to a stored screen, producing the effective screen. */
function applyScreenEdit(base: ScreenItem, edit: ScreenMetadataEdit | undefined): ScreenItem {
    if (!edit) return base;
    const effective: ScreenItem = { ...base };
    if (edit.name) effective.name = edit.name;
    if (edit.purpose !== undefined) effective.purpose = edit.purpose;
    if (edit.userIntent !== undefined) effective.userIntent = edit.userIntent;
    if (edit.priority) effective.priority = edit.priority;
    return effective;
}

/** One flow step that references a screen (matched by slug of the step title). */
export interface ScreenFlowRef {
    flow: ParsedFlow;
    /** Index of the flow within the parsed user_flows document. */
    flowIndex: number;
    step: ParsedStep;
    /** `step.index` hoisted for convenience (StepCard anchors key off it). */
    stepIndex: number;
}

/** A canonical screen plus everything the other artifacts say about it. */
export interface ScreenExperienceItem {
    /**
     * Stable canonical screen id — the rename-safe join/selection key.
     * Normally stamped by `assignStableScreenIds` during inventory
     * normalization; derived here with the same precedence (content id →
     * unique slug) as a safety net for inventories that skipped it.
     */
    id: string;
    /** Slug of the STORED generated name — the image/flow join key. Stable
     * across display renames. */
    slug: string;
    /** Effective screen: stored content with the user's edit overlay applied.
     * Views render this. */
    screen: ScreenItem;
    /** The stored generated screen, untouched by edits. Joins and image keys
     * derive from this — pass its name to image galleries as `storageName`. */
    baseScreen: ScreenItem;
    /** True when a user edit overlay applies to this screen. */
    isEdited: boolean;
    /** The applied edit overlay (when isEdited). */
    edit?: ScreenMetadataEdit;
    /** Title of the inventory section the screen belongs to. */
    sectionTitle: string;
    relatedFlows: ScreenFlowRef[];
    /** The matching mockup screen spec, when the mockup payload covers it. */
    mockupScreen?: MockupScreen;
}

/** Inventory section grouping preserved for the Screens list view. */
export interface ScreenExperienceSection {
    title: string;
    description?: string;
    flowSummary?: string;
    items: ScreenExperienceItem[];
}

/** Two or more distinct screen names collapsing to one slug. */
export interface ScreenSlugCollision {
    slug: string;
    names: string[];
}

export interface ScreenExperienceIndex {
    items: ScreenExperienceItem[];
    /** Canonical lookup — id is the stable, rename-safe key. */
    byId: Map<string, ScreenExperienceItem>;
    /** Name-based lookup for artifacts that only know names (flow steps,
     * legacy mockups). First screen wins on slug collision. */
    bySlug: Map<string, ScreenExperienceItem>;
    sections: ScreenExperienceSection[];
    collisions: ScreenSlugCollision[];
    /** Slugs with a canonical screen — used to gate flow-node navigation. */
    availableSlugs: ReadonlySet<string>;
}

// Stable empty index. Returned for every "no inventory" case so consumers
// (and any memo/selector holding the result) never see a fresh allocation
// for the same empty state — see the Selector-stability rule in CLAUDE.md.
export const EMPTY_SCREEN_EXPERIENCE_INDEX: ScreenExperienceIndex = {
    items: [],
    byId: new Map(),
    bySlug: new Map(),
    sections: [],
    collisions: [],
    availableSlugs: new Set(),
};

/** Strip surrounding markdown backticks (step titles are often `` `Name` ``). */
const stripBackticks = (text: string): string => text.replace(/^`+|`+$/g, '').trim();

/**
 * Slug of the screen a parsed flow step points at, or null when the step has
 * no usable title. Guarding the empty title matters because
 * `slugifyScreenName('')` falls back to the literal `'screen'`, which could
 * otherwise false-match a real screen that slugs to the same value.
 */
export function stepScreenSlug(step: Pick<ParsedStep, 'title'>): string | null {
    const title = step.title ? stripBackticks(step.title) : '';
    if (!title) return null;
    return slugifyScreenName(title);
}

/**
 * Build the screen-centric index by joining the three experience artifacts.
 * All inputs are the *normalized/parsed* artifact contents:
 *   - `inventory`: `parseScreenInventory(version.content)` (never raw legacy
 *     JSON — normalization maps `groups[]`/legacy priorities upstream);
 *   - `flows`: `parseFlows(version.content)`;
 *   - `mockupPayload`: `tryParsePayload(version)`.
 * Any of them may be null/empty; the index degrades gracefully (no inventory
 * → the stable empty index; no flows/mockup → items with empty relations).
 * On slug collision the first screen in inventory order wins `bySlug`; the
 * colliding names are surfaced in `collisions` for the UI to warn about.
 * `edits` is the per-version user overlay (`readScreenEdits`) — it changes
 * only what views display; every join key stays derived from stored content.
 */
export function buildScreenIndex(
    inventory: ScreenInventoryContent | null,
    flows: readonly ParsedFlow[],
    mockupPayload: MockupPayload | null,
    edits: ScreenEditsMap = EMPTY_SCREEN_EDITS,
): ScreenExperienceIndex {
    if (!inventory || !inventory.sections || inventory.sections.length === 0) {
        return EMPTY_SCREEN_EXPERIENCE_INDEX;
    }

    const items: ScreenExperienceItem[] = [];
    const byId = new Map<string, ScreenExperienceItem>();
    const bySlug = new Map<string, ScreenExperienceItem>();
    const namesBySlug = new Map<string, string[]>();
    const sections: ScreenExperienceSection[] = [];

    for (const section of inventory.sections) {
        const sectionItems: ScreenExperienceItem[] = [];
        for (const screen of section.screens ?? []) {
            if (!screen.name) continue;
            const slug = slugifyScreenName(screen.name);
            const names = namesBySlug.get(slug) ?? [];
            names.push(screen.name);
            namesBySlug.set(slug, names);
            // Canonical id: normalization (assignStableScreenIds) stamps one;
            // derive the same way here for inventories that bypassed it, and
            // unique-ify defensively so byId never drops a screen.
            const baseId = (typeof screen.id === 'string' && screen.id.trim()) || slug;
            let id = baseId;
            let n = 2;
            while (byId.has(id)) {
                id = `${baseId}-${n}`;
                n += 1;
            }
            const edit = edits[id];
            const item: ScreenExperienceItem = {
                id,
                slug,
                screen: applyScreenEdit(screen, edit),
                baseScreen: screen,
                isEdited: Boolean(edit),
                edit,
                sectionTitle: section.title,
                relatedFlows: [],
            };
            byId.set(id, item);
            // Name-keyed lookup keeps first-wins semantics on collisions
            // (later same-name screens still exist as items, keyed by id).
            if (!bySlug.has(slug)) bySlug.set(slug, item);
            items.push(item);
            sectionItems.push(item);
        }
        if (sectionItems.length > 0) {
            sections.push({
                title: section.title,
                description: section.description,
                flowSummary: section.flowSummary,
                items: sectionItems,
            });
        }
    }

    if (items.length === 0) return EMPTY_SCREEN_EXPERIENCE_INDEX;

    // Join flow steps by exact slug of the parsed step title. Substring /
    // fuzzy matching is deliberately avoided: "Sign In" must not match
    // "Sign In Confirmation". (Flows are markdown and only know names.)
    flows.forEach((flow, flowIndex) => {
        for (const step of flow.steps) {
            const slug = stepScreenSlug(step);
            if (!slug) continue;
            const item = bySlug.get(slug);
            if (!item) continue;
            item.relatedFlows.push({ flow, flowIndex, step, stepIndex: step.index });
        }
    });

    // Join mockup screens: stable `sourceScreenId` wins (rename-safe, stamped
    // by generateMockup on new payloads); legacy payloads fall back to
    // slugified-name matching. A mockup screen that matches nothing is not
    // surfaced here (it stays visible in the legacy mockup viewer).
    if (mockupPayload) {
        for (const mockupScreen of mockupPayload.screens) {
            const byStableId = mockupScreen.sourceScreenId
                ? byId.get(mockupScreen.sourceScreenId)
                : undefined;
            const item = byStableId
                ?? (mockupScreen.name ? bySlug.get(slugifyScreenName(mockupScreen.name)) : undefined);
            if (item && !item.mockupScreen) item.mockupScreen = mockupScreen;
        }
    }

    const collisions: ScreenSlugCollision[] = [];
    for (const [slug, names] of namesBySlug) {
        if (names.length > 1) collisions.push({ slug, names });
    }

    return {
        items,
        byId,
        bySlug,
        sections,
        collisions,
        availableSlugs: new Set(bySlug.keys()),
    };
}

/** Flow refs for one screen regrouped per flow (a screen can appear in
 * several steps of the same flow — the Flow tab renders one section per
 * flow, not per step). */
export interface ScreenFlowGroup {
    flow: ParsedFlow;
    flowIndex: number;
    steps: Array<{ step: ParsedStep; stepIndex: number }>;
}

export function groupFlowRefsByFlow(refs: readonly ScreenFlowRef[]): ScreenFlowGroup[] {
    const byFlow = new Map<number, ScreenFlowGroup>();
    for (const ref of refs) {
        let group = byFlow.get(ref.flowIndex);
        if (!group) {
            group = { flow: ref.flow, flowIndex: ref.flowIndex, steps: [] };
            byFlow.set(ref.flowIndex, group);
        }
        group.steps.push({ step: ref.step, stepIndex: ref.stepIndex });
    }
    return Array.from(byFlow.values());
}
