// Pure flatten + filter helpers for the Component Inventory renderer. Kept
// framework-free so the filtering predicate is unit-testable in isolation.

import type { ComponentInventoryContent, ComponentItem } from '../../../types';

/** A component flattened out of its category, carrying the category name. */
export interface FlatComponent extends ComponentItem {
    category: string;
}

/** The toolbar's current filter selection. 'All' means no constraint. */
export interface FilterState {
    searchQuery: string;
    selectedCategory: string;
    selectedComplexity: string;
    selectedUsedIn: string;
}

export const ALL = 'All';

/** Flatten categories into a single list, tagging each component with its category. */
export function flattenComponents(inventory: ComponentInventoryContent): FlatComponent[] {
    return inventory.categories.flatMap(cat =>
        cat.components.map(comp => ({ ...comp, category: cat.name })),
    );
}

/** The distinct category names, in first-seen order. */
export function categoryOptions(inventory: ComponentInventoryContent): string[] {
    return inventory.categories.map(c => c.name).filter((n, i, arr) => arr.indexOf(n) === i);
}

/** The union of every component's usedIn screens, in first-seen order. */
export function usedInOptions(components: FlatComponent[]): string[] {
    const seen: string[] = [];
    for (const comp of components) {
        for (const screen of comp.usedIn ?? []) {
            if (!seen.includes(screen)) seen.push(screen);
        }
    }
    return seen;
}

/**
 * True when a flattened component satisfies every active filter. Search is a
 * case-insensitive substring match across name, purpose, category, and the
 * usedIn screens; the three dropdown filters AND together.
 */
export function matchesFilters(item: FlatComponent, state: FilterState): boolean {
    const query = state.searchQuery.trim().toLowerCase();
    if (query) {
        const haystack = [
            item.name,
            item.purpose,
            item.category,
            ...(item.usedIn ?? []),
        ].join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
    }

    if (state.selectedCategory !== ALL && item.category !== state.selectedCategory) return false;
    if (state.selectedComplexity !== ALL && item.complexity !== state.selectedComplexity) return false;
    if (state.selectedUsedIn !== ALL && !(item.usedIn ?? []).includes(state.selectedUsedIn)) return false;

    return true;
}
