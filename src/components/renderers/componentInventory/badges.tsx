// Small badge primitives for component cards. Complexity uses the app's
// green/amber/red scale; category and usage use the indigo/neutral accents.

import type { ComponentItem } from '../../../types';

const COMPLEXITY_STYLES: Record<ComponentItem['complexity'], string> = {
    simple: 'bg-green-100 text-green-700',
    moderate: 'bg-amber-100 text-amber-700',
    complex: 'bg-red-100 text-red-700',
};

export function ComplexityBadge({ complexity }: { complexity: ComponentItem['complexity'] }) {
    const label = complexity.charAt(0).toUpperCase() + complexity.slice(1);
    return (
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium capitalize ${COMPLEXITY_STYLES[complexity]}`}>
            {label}
        </span>
    );
}

export function CategoryBadge({ category }: { category: string }) {
    return (
        <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200">
            {category}
        </span>
    );
}

export function UsageBadge({ count }: { count: number }) {
    return (
        <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-neutral-100 text-neutral-600 ring-1 ring-neutral-200">
            Used in {count}
        </span>
    );
}
