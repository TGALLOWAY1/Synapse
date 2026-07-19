import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import type { OutputAlignment } from '../lib/planning/outputAlignment';
import { outputAlignmentCopy } from '../lib/planning/planningLanguage';

const config = {
    aligned: {
        label: outputAlignmentCopy('aligned').label,
        Icon: CheckCircle2,
        pill: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        icon: 'text-emerald-500',
    },
    possibly_affected: {
        label: outputAlignmentCopy('possibly_affected').label,
        Icon: HelpCircle,
        pill: 'border-amber-200 bg-amber-50 text-amber-800',
        icon: 'text-amber-600',
    },
    stale: {
        label: outputAlignmentCopy('stale').label,
        Icon: AlertTriangle,
        pill: 'border-orange-300 bg-orange-50 text-orange-900',
        icon: 'text-orange-600',
    },
} as const;

export function OutputAlignmentBadge({ alignment }: { alignment: OutputAlignment }) {
    const item = config[alignment.state];
    const Icon = item.Icon;
    return (
        <span
            title={alignment.summary}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${item.pill}`}
        >
            <Icon size={12} aria-hidden="true" />
            {item.label}
        </span>
    );
}

export function OutputAlignmentDot({ alignment }: { alignment?: OutputAlignment }) {
    if (!alignment || alignment.state === 'aligned') return null;
    const item = config[alignment.state];
    const Icon = item.Icon;
    return (
        <Icon
            size={13}
            className={`${item.icon} shrink-0`}
            aria-label={`${item.label}: ${alignment.summary}`}
        />
    );
}

export function OutputAlignmentNotice({ alignment }: { alignment: OutputAlignment }) {
    if (alignment.state === 'aligned') return null;
    const item = config[alignment.state];
    const Icon = item.Icon;
    const confidence = alignment.confidence === 'definite'
        ? 'Confirmed mismatch'
        : alignment.confidence === 'unknown'
            ? 'Alignment unknown'
            : 'Possible impact';

    return (
        <section className={`rounded-lg border px-3 py-2.5 ${item.pill}`} aria-label="Output alignment">
            <div className="flex items-start gap-2">
                <Icon size={15} className={`mt-0.5 shrink-0 ${item.icon}`} aria-hidden="true" />
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <p className="text-xs font-semibold">{item.label}</p>
                        <span className="text-[11px] opacity-75">{confidence}</span>
                    </div>
                    <p className="mt-0.5 text-xs leading-5">{alignment.summary}</p>
                    <p className="mt-1 text-xs leading-5 font-medium">Next: {alignment.nextAction}</p>
                    <p className="mt-1 text-[11px] leading-4 opacity-75">
                        Existing work remains useful for exploration; review it before treating it as build-ready.
                    </p>
                </div>
            </div>
        </section>
    );
}
