import { describe, it, expect } from 'vitest';
import {
    flattenComponents, categoryOptions, usedInOptions, matchesFilters, ALL,
    type FilterState, type FlatComponent,
} from '../filter';
import type { ComponentInventoryContent } from '../../../../types';

const inventory: ComponentInventoryContent = {
    categories: [
        {
            name: 'Navigation',
            components: [
                { name: 'SettingsAccordion', purpose: 'Collapsible container', complexity: 'simple', usedIn: ['Settings', 'Device Setup'] },
            ],
        },
        {
            name: 'Forms',
            components: [
                { name: 'AddressSearchInput', purpose: 'Geospatial search', complexity: 'moderate', usedIn: ['Mapping', 'Settings'] },
                { name: 'ToggleSwitch', purpose: 'Boolean toggle', complexity: 'simple', usedIn: ['Settings'] },
            ],
        },
    ],
};

const base: FilterState = { searchQuery: '', selectedCategory: ALL, selectedComplexity: ALL, selectedUsedIn: ALL };

describe('flattenComponents', () => {
    it('flattens and tags each component with its category', () => {
        const flat = flattenComponents(inventory);
        expect(flat).toHaveLength(3);
        expect(flat[0]).toMatchObject({ name: 'SettingsAccordion', category: 'Navigation' });
        expect(flat[1]).toMatchObject({ name: 'AddressSearchInput', category: 'Forms' });
    });
});

describe('option helpers', () => {
    it('lists distinct categories and the usedIn union in first-seen order', () => {
        expect(categoryOptions(inventory)).toEqual(['Navigation', 'Forms']);
        expect(usedInOptions(flattenComponents(inventory))).toEqual(['Settings', 'Device Setup', 'Mapping']);
    });
});

describe('matchesFilters', () => {
    const flat = flattenComponents(inventory);
    const find = (name: string) => flat.find(c => c.name === name) as FlatComponent;

    it('passes everything when no filters are set', () => {
        expect(flat.every(c => matchesFilters(c, base))).toBe(true);
    });

    it('search matches name, purpose, category, and usedIn', () => {
        expect(matchesFilters(find('AddressSearchInput'), { ...base, searchQuery: 'geospatial' })).toBe(true);
        expect(matchesFilters(find('AddressSearchInput'), { ...base, searchQuery: 'forms' })).toBe(true);
        expect(matchesFilters(find('SettingsAccordion'), { ...base, searchQuery: 'device setup' })).toBe(true);
        expect(matchesFilters(find('SettingsAccordion'), { ...base, searchQuery: 'nonexistent' })).toBe(false);
    });

    it('ANDs the dropdown filters together', () => {
        expect(matchesFilters(find('ToggleSwitch'), { ...base, selectedCategory: 'Forms' })).toBe(true);
        expect(matchesFilters(find('ToggleSwitch'), { ...base, selectedCategory: 'Navigation' })).toBe(false);
        expect(matchesFilters(find('AddressSearchInput'), { ...base, selectedComplexity: 'moderate' })).toBe(true);
        expect(matchesFilters(find('AddressSearchInput'), { ...base, selectedComplexity: 'simple' })).toBe(false);
        expect(matchesFilters(find('SettingsAccordion'), { ...base, selectedUsedIn: 'Mapping' })).toBe(false);
        expect(matchesFilters(find('AddressSearchInput'), { ...base, selectedUsedIn: 'Mapping' })).toBe(true);
    });
});
