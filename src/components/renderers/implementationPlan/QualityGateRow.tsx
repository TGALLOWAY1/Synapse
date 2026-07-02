import { ShieldAlert, ShieldCheck } from 'lucide-react';
import type { ImplementationQualityGate } from '../../../types';
import { GATE_CATEGORY_LABELS } from './gateCategories';

/** One quality gate line: required marker, title, category chip. */
export function QualityGateRow({ gate }: { gate: ImplementationQualityGate }) {
    const Icon = gate.required ? ShieldCheck : ShieldAlert;
    return (
        <li className="flex items-start gap-2 text-sm text-neutral-800">
            <Icon size={14} className={`mt-0.5 shrink-0 ${gate.required ? 'text-emerald-600' : 'text-neutral-400'}`} />
            <div className="min-w-0">
                <span>{gate.title}</span>
                {gate.description && (
                    <span className="block text-xs text-neutral-500">{gate.description}</span>
                )}
                <span className="inline-flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 border border-neutral-200">
                        {GATE_CATEGORY_LABELS[gate.category] ?? gate.category}
                    </span>
                    <span className="text-[10px] text-neutral-400">{gate.required ? 'Required' : 'Optional'}</span>
                </span>
            </div>
        </li>
    );
}
