// Pure read-side join layer for the Component Inventory artifact.
//
// `component_inventory` used to be a hidden artifact with no renderer (it only
// fed the mockup spec builder via MOCKUP_DEPENDENCIES). W4 of
// docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md makes it reviewable, which means
// a reader has to be able to answer "where is this component actually used?"
// and "does any screen cite a component that doesn't exist?".
//
// Both answers are DERIVED at read time from artifact contents that already
// live in the store — nothing here is persisted, no new collection, no
// snapshot/sync wiring (cross-cutting rules 6 & 10). It must stay pure (no
// Zustand, no IDB, no React) so it is unit-testable in isolation.
//
// The screen side of the join is NOT re-derived here: callers pass the screens
// already produced by the canonical Screens join layer
// (`buildScreenIndex` → `ScreenExperienceIndex`), projected through
// `componentJoinScreensFromIndex`. There must never be a second screen join.
//
// Honesty rules (rule 10): every reference below is a NAME comparison, not a
// stored link. The UI must present it as "derived", and every contradiction is
// **advisory** — it gates nothing (not rendering, not generation, not
// readiness).

import type { ComponentInventoryContent, ComponentItem } from '../types';
import { slugifyScreenName } from './screenInventoryImageStore';
import type { ScreenExperienceIndex } from './screenExperience';

/**
 * The minimum a screen has to expose for the component join. Deliberately
 * narrow so this module never depends on the full `ScreenExperienceItem`.
 */
export interface ComponentJoinScreen {
    /** Canonical, rename-safe screen id (the navigation/selection key). */
    id: string;
    /** Slug of the STORED generated name — the join key `usedIn` matches. */
    slug: string;
    /** Display name (effective screen, i.e. with the user's rename overlay). */
    name: string;
    /**
     * Component names this screen explicitly cites. Only the generated
     * screen-contract field `handoff.primaryComponents` qualifies —
     * `coreUIElements` / the legacy `components` alias hold prose UI regions
     * ("Header with date filters"), so comparing them against an inventory of
     * component names would manufacture contradictions that aren't real.
     */
    citedComponents: string[];
}

/**
 * Project the canonical Screens index into the component join's input shape.
 * Reuses the existing derived screen layer — do not build a second join.
 */
export function componentJoinScreensFromIndex(
    index: Pick<ScreenExperienceIndex, 'items'>,
): ComponentJoinScreen[] {
    return index.items.map(item => ({
        id: item.id,
        slug: item.slug,
        name: item.screen.name || item.id,
        // Read the STORED contract (baseScreen) — the overlay only renames.
        citedComponents: (item.baseScreen.handoff?.primaryComponents ?? [])
            .map(name => (typeof name === 'string' ? name.trim() : ''))
            .filter(Boolean),
    }));
}

/** Why we believe a screen references a component. */
export type ComponentScreenRefSource =
    /** The component's own `usedIn` names this screen. */
    | 'component_used_in'
    /** The screen's `handoff.primaryComponents` names this component. */
    | 'screen_contract';

export interface ComponentScreenRef {
    /** Canonical screen id — pass to screen navigation. */
    screenId: string;
    /** Slug of the stored screen name (the navigation key the Screens view uses). */
    slug: string;
    /** Display name. */
    screenName: string;
    /** Every piece of evidence found, in a stable order. */
    sources: ComponentScreenRefSource[];
    /**
     * `exact` when the names matched after normalization; `partial` when one
     * normalized name contained the other (weaker — label it as such, never
     * present it as confirmed).
     */
    confidence: 'exact' | 'partial';
}

/** One component, plus everything the screens say about it. */
export interface ComponentInventoryEntry {
    /** Deterministic display/anchor id — NOT a persisted identity. */
    id: string;
    name: string;
    categoryName: string;
    /** The parsed component, verbatim. Legacy items lack most optional fields. */
    component: ComponentItem;
    /** Screens that reference this component, in screen (inventory) order. */
    screenRefs: ComponentScreenRef[];
    /** `usedIn` entries that matched no canonical screen (advisory). */
    unresolvedUsedIn: string[];
}

export type ComponentReferenceIssueKind =
    /** A screen contract cites a component that is not in the inventory. */
    | 'screen_cites_unknown_component'
    /** A component's `usedIn` names a screen that is not in the inventory. */
    | 'component_used_in_unknown_screen'
    /** A component no screen references at all. */
    | 'component_unreferenced';

/**
 * A derived component/screen contradiction. **Advisory only** — surfaced for
 * review, never a gate. `severity: 'review'` means "worth a look", `'info'`
 * means "for your information"; neither blocks anything.
 */
export interface ComponentReferenceIssue {
    /** Stable de-dupe key (also the React key). */
    key: string;
    kind: ComponentReferenceIssueKind;
    severity: 'review' | 'info';
    message: string;
    /** Canonical screen id, when the issue is anchored on a screen. */
    screenId?: string;
    /** Slug for screen navigation, when anchored on a screen. */
    screenSlug?: string;
    /** Inventory component name, when anchored on a component. */
    componentName?: string;
}

export interface ComponentInventorySummary {
    categoryCount: number;
    componentCount: number;
    /** Components with at least one resolved screen reference. */
    referencedCount: number;
    /** Components with no resolved screen reference. */
    unreferencedCount: number;
    /** Screens with at least one component pointing at them. */
    screensWithComponents: number;
    /** Total screens supplied by the join (0 when no screens were passed). */
    screenTotal: number;
    /**
     * False when no screens were supplied — the back-reference and
     * contradiction layers then have no evidence and stay empty rather than
     * reporting everything as unreferenced.
     */
    joinAvailable: boolean;
}

export interface ComponentInventoryModel {
    categories: { name: string; components: ComponentInventoryEntry[] }[];
    /** Flat list in category → component order. */
    entries: ComponentInventoryEntry[];
    /** Normalized-name lookup (see `normalizeComponentKey`). First wins. */
    byNameKey: Map<string, ComponentInventoryEntry>;
    /** Advisory contradictions — review-severity first, then info. */
    issues: ComponentReferenceIssue[];
    summary: ComponentInventorySummary;
}

/**
 * Stable empty model. Returned for every "no inventory" case so a memo holding
 * the result never sees a fresh allocation for the same empty state (the
 * Selector-stability rule).
 */
export const EMPTY_COMPONENT_INVENTORY_MODEL: ComponentInventoryModel = {
    categories: [],
    entries: [],
    byNameKey: new Map(),
    issues: [],
    summary: {
        categoryCount: 0,
        componentCount: 0,
        referencedCount: 0,
        unreferencedCount: 0,
        screensWithComponents: 0,
        screenTotal: 0,
        joinAvailable: false,
    },
};

/**
 * Comparison key for a component name. `CaseListTable`, `Case List Table`, and
 * `case-list-table` are the same component as far as a name-based join can
 * tell; anything shorter than `MIN_PARTIAL_KEY` is too generic to partial-match.
 */
export function normalizeComponentKey(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Below this length a containment match is noise ("Bar" inside "Sidebar"). */
const MIN_PARTIAL_KEY = 5;

/** Cap the advisory list so a badly-generated pair of artifacts can't wall the UI. */
const MAX_ISSUES = 30;

const slugify = (name: string): string => slugifyScreenName(name);

/**
 * Join a parsed component inventory to the canonical screens.
 *
 * `inventory` is `parseComponentInventoryMarkdown(version.content)` (it also
 * accepts the raw JSON shape). `screens` comes from
 * `componentJoinScreensFromIndex(screenIndex)`; pass none (the default) when
 * the screen inventory is missing — the model then renders the components with
 * no back-references and reports no contradictions, because there is no
 * evidence either way.
 */
export function buildComponentInventoryModel(
    inventory: ComponentInventoryContent | null,
    screens: readonly ComponentJoinScreen[] = [],
): ComponentInventoryModel {
    const categoriesIn = inventory?.categories ?? [];
    if (categoriesIn.length === 0) return EMPTY_COMPONENT_INVENTORY_MODEL;

    const joinAvailable = screens.length > 0;
    const screensBySlug = new Map<string, ComponentJoinScreen>();
    for (const screen of screens) {
        if (!screensBySlug.has(screen.slug)) screensBySlug.set(screen.slug, screen);
    }
    // Screen order drives ref ordering so the UI is deterministic.
    const screenOrder = new Map(screens.map((screen, index) => [screen.id, index]));

    const categories: { name: string; components: ComponentInventoryEntry[] }[] = [];
    const entries: ComponentInventoryEntry[] = [];
    const byNameKey = new Map<string, ComponentInventoryEntry>();
    // component entry id → screen id → ref (accumulates evidence from both sides)
    const refsByEntry = new Map<string, Map<string, ComponentScreenRef>>();
    const usedIds = new Set<string>();

    for (const category of categoriesIn) {
        const categoryName = category?.name ?? 'Components';
        const components: ComponentInventoryEntry[] = [];
        for (const component of category?.components ?? []) {
            if (!component?.name) continue;
            const baseId = `${slugify(categoryName)}--${slugify(component.name)}`;
            let id = baseId;
            let n = 2;
            while (usedIds.has(id)) {
                id = `${baseId}-${n}`;
                n += 1;
            }
            usedIds.add(id);
            const entry: ComponentInventoryEntry = {
                id,
                name: component.name,
                categoryName,
                component,
                screenRefs: [],
                unresolvedUsedIn: [],
            };
            components.push(entry);
            entries.push(entry);
            refsByEntry.set(id, new Map());
            const key = normalizeComponentKey(component.name);
            if (key && !byNameKey.has(key)) byNameKey.set(key, entry);
        }
        if (components.length > 0) categories.push({ name: categoryName, components });
    }

    if (entries.length === 0) return EMPTY_COMPONENT_INVENTORY_MODEL;

    const issues: ComponentReferenceIssue[] = [];
    const reviewIssues: ComponentReferenceIssue[] = [];
    const infoIssues: ComponentReferenceIssue[] = [];

    const addRef = (
        entry: ComponentInventoryEntry,
        screen: ComponentJoinScreen,
        source: ComponentScreenRefSource,
        confidence: ComponentScreenRef['confidence'],
    ) => {
        const refs = refsByEntry.get(entry.id)!;
        const existing = refs.get(screen.id);
        if (!existing) {
            refs.set(screen.id, {
                screenId: screen.id,
                slug: screen.slug,
                screenName: screen.name,
                sources: [source],
                confidence,
            });
            return;
        }
        if (!existing.sources.includes(source)) existing.sources.push(source);
        // Two weak signals never become strong; one exact match does.
        if (confidence === 'exact') existing.confidence = 'exact';
    };

    // --- Direction 1: component.usedIn → screens -----------------------------
    for (const entry of entries) {
        const usedIn = entry.component.usedIn ?? [];
        const unresolved: string[] = [];
        for (const raw of usedIn) {
            const name = typeof raw === 'string' ? raw.trim() : '';
            if (!name) continue;
            const screen = joinAvailable ? screensBySlug.get(slugify(name)) : undefined;
            if (screen) {
                addRef(entry, screen, 'component_used_in', 'exact');
            } else if (joinAvailable && !unresolved.includes(name)) {
                unresolved.push(name);
            }
        }
        entry.unresolvedUsedIn = unresolved;
        for (const name of unresolved) {
            infoIssues.push({
                key: `component-usedin:${entry.id}:${slugify(name)}`,
                kind: 'component_used_in_unknown_screen',
                severity: 'info',
                message: `${entry.name} lists “${name}” under Used in, but no screen with that name exists in the screen inventory.`,
                componentName: entry.name,
            });
        }
    }

    // --- Direction 2: screen contract → components (the contradiction) -------
    // A screen citing a component the inventory does not contain is the
    // component/screen contradiction W4 asks for. Exact and containment
    // matches both count as "found" — only a citation that matches nothing at
    // all is reported, which keeps the advisory honest instead of noisy.
    for (const screen of screens) {
        for (const cited of screen.citedComponents) {
            const key = normalizeComponentKey(cited);
            if (!key) continue;
            const exact = byNameKey.get(key);
            if (exact) {
                addRef(exact, screen, 'screen_contract', 'exact');
                continue;
            }
            const partial = key.length >= MIN_PARTIAL_KEY
                ? entries.find(entry => {
                    const entryKey = normalizeComponentKey(entry.name);
                    if (entryKey.length < MIN_PARTIAL_KEY) return false;
                    return entryKey.includes(key) || key.includes(entryKey);
                })
                : undefined;
            if (partial) {
                addRef(partial, screen, 'screen_contract', 'partial');
                continue;
            }
            reviewIssues.push({
                key: `screen-component:${screen.id}:${key}`,
                kind: 'screen_cites_unknown_component',
                severity: 'review',
                message: `${screen.name} lists “${cited}” as a primary component, but the component inventory has no matching component.`,
                screenId: screen.id,
                screenSlug: screen.slug,
                componentName: cited,
            });
        }
    }

    // Materialize refs in screen order.
    const screensWithComponents = new Set<string>();
    let referencedCount = 0;
    for (const entry of entries) {
        const refs = [...refsByEntry.get(entry.id)!.values()].sort(
            (a, b) => (screenOrder.get(a.screenId) ?? 0) - (screenOrder.get(b.screenId) ?? 0),
        );
        entry.screenRefs = refs;
        if (refs.length > 0) {
            referencedCount += 1;
            refs.forEach(ref => screensWithComponents.add(ref.screenId));
        } else if (joinAvailable) {
            infoIssues.push({
                key: `component-unreferenced:${entry.id}`,
                kind: 'component_unreferenced',
                severity: 'info',
                message: `${entry.name} is not referenced by any screen — it may be unused, or its Used in list may be missing.`,
                componentName: entry.name,
            });
        }
    }

    issues.push(...reviewIssues, ...infoIssues);

    return {
        categories,
        entries,
        byNameKey,
        issues: issues.slice(0, MAX_ISSUES),
        summary: {
            categoryCount: categories.length,
            componentCount: entries.length,
            referencedCount,
            unreferencedCount: joinAvailable ? entries.length - referencedCount : 0,
            screensWithComponents: screensWithComponents.size,
            screenTotal: screens.length,
            joinAvailable,
        },
    };
}
