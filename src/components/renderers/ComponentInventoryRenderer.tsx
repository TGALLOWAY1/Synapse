import { useMemo, useState } from 'react';
import type { ComponentInventoryContent } from '../../types';
import {
    flattenComponents, categoryOptions, usedInOptions, matchesFilters, ALL,
    type FilterState,
} from './componentInventory/filter';
import { ComponentInventoryToolbar } from './componentInventory/ComponentInventoryToolbar';
import { ComponentCard } from './componentInventory/ComponentCard';

interface Props {
    content: string;
}

function tryParseComponentInventory(content: string): ComponentInventoryContent | null {
    try {
        const parsed = JSON.parse(content);
        if (parsed.categories && Array.isArray(parsed.categories)) return parsed;
    } catch {
        // Not JSON — dispatcher falls back to ReactMarkdown.
    }
    return null;
}

const INITIAL_FILTERS: FilterState = {
    searchQuery: '',
    selectedCategory: ALL,
    selectedComplexity: ALL,
    selectedUsedIn: ALL,
};

export function ComponentInventoryRenderer({ content }: Props) {
    const structured = tryParseComponentInventory(content);
    const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
    // Track expansion by component name; default-expand the first component.
    const [expandedIds, setExpandedIds] = useState<Set<string> | null>(null);

    const flat = useMemo(() => (structured ? flattenComponents(structured) : []), [structured]);
    const categories = useMemo(() => (structured ? categoryOptions(structured) : []), [structured]);
    const usedInScreens = useMemo(() => usedInOptions(flat), [flat]);

    const visible = useMemo(() => flat.filter(c => matchesFilters(c, filters)), [flat, filters]);

    if (!structured) return null;

    // First card expanded by default until the user interacts with expansion.
    const firstId = visible[0]?.name;
    const isExpanded = (id: string) =>
        expandedIds === null ? id === firstId : expandedIds.has(id);

    const toggle = (id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev ?? (firstId ? [firstId] : []));
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <div>
            <ComponentInventoryToolbar
                state={filters}
                onChange={partial => setFilters(f => ({ ...f, ...partial }))}
                categories={categories}
                usedInScreens={usedInScreens}
            />

            <div className="space-y-3 pt-4">
                {visible.length === 0 ? (
                    <p className="text-sm text-neutral-400 text-center py-12">
                        No components match the current filters.
                    </p>
                ) : (
                    visible.map(comp => (
                        <ComponentCard
                            key={`${comp.category}/${comp.name}`}
                            component={comp}
                            expanded={isExpanded(comp.name)}
                            onToggle={() => toggle(comp.name)}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
