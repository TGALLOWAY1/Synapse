import type { StalenessState } from '../types';

interface StalenessBadgeProps {
    staleness: StalenessState;
}

const config: Record<StalenessState, { label: string; className: string }> = {
    current: {
        label: 'Current',
        className: 'bg-green-50 text-green-700 border-green-200',
    },
    possibly_outdated: {
        label: 'May be outdated',
        className: 'bg-amber-50 text-amber-700 border-amber-200',
    },
    outdated: {
        label: 'Outdated',
        className: 'bg-red-50 text-red-700 border-red-200',
    },
};

export function StalenessBadge({ staleness }: StalenessBadgeProps) {
    if (staleness === 'current') return null;

    const { label, className } = config[staleness];

    return (
        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${className}`}>
            {label}
        </span>
    );
}
