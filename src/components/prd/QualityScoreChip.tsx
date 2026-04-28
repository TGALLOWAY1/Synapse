import { useState } from 'react';
import { Award } from 'lucide-react';
import type { QualityScores } from '../../types';

interface QualityScoreChipProps {
    scores: QualityScores;
    revised?: boolean;
}

const DIMENSIONS: { key: keyof QualityScores; label: string }[] = [
    { key: 'specificity', label: 'Specificity' },
    { key: 'uxUsefulness', label: 'UX usefulness' },
    { key: 'engineeringUsefulness', label: 'Engineering usefulness' },
    { key: 'strategicClarity', label: 'Strategic clarity' },
    { key: 'formatting', label: 'Formatting' },
    { key: 'acceptanceCriteria', label: 'Acceptance criteria' },
    { key: 'downstreamReadiness', label: 'Downstream readiness' },
];

const overallTone = (overall: number) => {
    if (overall >= 4.5) return { chip: 'bg-green-100 text-green-800 border-green-300', dot: 'bg-green-500' };
    if (overall >= 3.5) return { chip: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-500' };
    if (overall >= 2.5) return { chip: 'bg-amber-100 text-amber-800 border-amber-300', dot: 'bg-amber-500' };
    return { chip: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-500' };
};

const barTone = (score: number) => {
    if (score >= 4) return 'bg-green-500';
    if (score >= 3) return 'bg-amber-500';
    return 'bg-red-500';
};

export function QualityScoreChip({ scores, revised }: QualityScoreChipProps) {
    const [open, setOpen] = useState(false);
    const tone = overallTone(scores.overall);
    return (
        <div className="relative inline-block">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${tone.chip}`}
                title="View quality scores"
            >
                <Award size={12} />
                <span>Quality {scores.overall.toFixed(1)}/5</span>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${tone.dot}`} aria-hidden />
            </button>
            {open && (
                <>
                    <button
                        type="button"
                        aria-label="Close quality scores"
                        className="fixed inset-0 z-30 cursor-default"
                        onClick={() => setOpen(false)}
                    />
                    <div className="absolute right-0 mt-2 w-72 z-40 rounded-xl border border-neutral-200 bg-white shadow-xl p-4">
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-sm font-bold text-neutral-900">Quality scores</p>
                            <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${tone.chip}`}>
                                Overall {scores.overall.toFixed(1)}
                            </span>
                        </div>
                        <ul className="space-y-2">
                            {DIMENSIONS.map(d => {
                                const v = scores[d.key];
                                const num = typeof v === 'number' ? v : 0;
                                const pct = Math.max(0, Math.min(100, (num / 5) * 100));
                                return (
                                    <li key={d.key} className="text-xs">
                                        <div className="flex items-center justify-between mb-0.5">
                                            <span className="text-neutral-700">{d.label}</span>
                                            <span className="text-neutral-500 font-mono">{num.toFixed(1)}/5</span>
                                        </div>
                                        <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full ${barTone(num)} transition-all`}
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                        {scores.notes && (
                            <p className="mt-3 text-[11px] text-neutral-500 leading-relaxed">{scores.notes}</p>
                        )}
                        {revised && (
                            <p className="mt-3 text-[11px] text-indigo-600 leading-relaxed">
                                Scores measured before automatic revision pass — final PRD reflects revised content.
                            </p>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
