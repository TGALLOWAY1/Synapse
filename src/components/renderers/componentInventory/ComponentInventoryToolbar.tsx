// Sticky search + filter toolbar. The chip rows scroll horizontally on narrow
// screens so the controls stay compact and component cards remain visible
// above the fold on mobile.

import { Search } from 'lucide-react';
import { ALL, type FilterState } from './filter';

interface Props {
    state: FilterState;
    onChange: (next: Partial<FilterState>) => void;
    categories: string[];
    usedInScreens: string[];
}

const COMPLEXITIES = ['simple', 'moderate', 'complex'];

function ChipRow({ options, selected, onSelect }: { options: string[]; selected: string; onSelect: (v: string) => void }) {
    return (
        <div className="flex gap-1.5 overflow-x-auto flex-nowrap pb-0.5 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[ALL, ...options].map(opt => {
                const active = selected === opt;
                return (
                    <button
                        key={opt}
                        type="button"
                        onClick={() => onSelect(opt)}
                        className={`shrink-0 text-xs px-3 py-1 rounded-full font-medium capitalize transition-colors ${
                            active
                                ? 'bg-indigo-600 text-white'
                                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                        }`}
                    >
                        {opt}
                    </button>
                );
            })}
        </div>
    );
}

function Dropdown({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
    return (
        <label className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
            <span className="shrink-0">{label}</span>
            <select
                value={value}
                onChange={e => onChange(e.target.value)}
                className="text-xs text-neutral-700 bg-white border border-neutral-200 rounded-md px-2 py-1 focus:outline-none focus:border-indigo-400 max-w-[10rem]"
            >
                {[ALL, ...options].map(opt => (
                    <option key={opt} value={opt} className="capitalize">{opt}</option>
                ))}
            </select>
        </label>
    );
}

export function ComponentInventoryToolbar({ state, onChange, categories, usedInScreens }: Props) {
    return (
        <div className="sticky top-0 z-10 -mx-4 md:-mx-8 px-4 md:px-8 py-3 bg-neutral-50/95 backdrop-blur border-b border-neutral-200 space-y-2.5">
            <div className="flex items-center gap-2 bg-white border border-neutral-200 rounded-lg px-3 py-2">
                <Search size={15} className="text-neutral-400 shrink-0" />
                <input
                    type="text"
                    value={state.searchQuery}
                    onChange={e => onChange({ searchQuery: e.target.value })}
                    placeholder="Search components..."
                    className="flex-1 min-w-0 text-sm text-neutral-700 outline-none bg-transparent placeholder:text-neutral-400"
                />
            </div>

            <ChipRow
                options={categories}
                selected={state.selectedCategory}
                onSelect={v => onChange({ selectedCategory: v })}
            />

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Dropdown
                    label="Complexity:"
                    value={state.selectedComplexity}
                    options={COMPLEXITIES}
                    onChange={v => onChange({ selectedComplexity: v })}
                />
                <Dropdown
                    label="Used In:"
                    value={state.selectedUsedIn}
                    options={usedInScreens}
                    onChange={v => onChange({ selectedUsedIn: v })}
                />
            </div>
        </div>
    );
}
