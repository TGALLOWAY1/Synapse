import { useMemo, useState } from 'react';
import { ArrowRight, Check, ImageIcon, ListChecks, Sparkles, Workflow } from 'lucide-react';
import type { MockupPayload } from '../../types';
import type { ParsedFlow } from '../renderers/userFlows/types';
import { buildMockupScreenRecommendations } from '../../lib/mockupApproval';

type Props = {
    payload: MockupPayload;
    /** Parsed user_flows (may be empty when the flows artifact is missing). */
    flows: ParsedFlow[];
    /** OpenAI key present — drives the "images will render" vs "add a key" copy. */
    hasImageKey: boolean;
    /** Jump to the Flows artifact so the user can read the full flows. */
    onOpenFlows: () => void;
    /** Record approval + kick off image generation for the selected screen ids. */
    onApprove: (selectedScreenIds: string[]) => void;
};

/**
 * The flow-approval checkpoint shown before any mockup image is generated. The
 * spec (screen list) already exists; this gate makes the user review the flows
 * and approve which screens are worth rendering as images — reinforcing an
 * explicit review of the flow before the costly visual step runs.
 *
 * It is advisory in spirit but deliberately low-friction: one acknowledgement
 * checkbox plus a pre-checked, recommendation-seeded screen list, then a single
 * "Generate mockups" action. Nothing is blocked once approved — the user can
 * still add/regenerate screens afterwards from the mockup view.
 */
export function MockupApprovalGate({ payload, flows, hasImageKey, onOpenFlows, onApprove }: Props) {
    const recommendations = useMemo(
        () => buildMockupScreenRecommendations(payload),
        [payload],
    );

    const [flowsReviewed, setFlowsReviewed] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(
        () => new Set(recommendations.filter(r => r.recommended).map(r => r.screen.id)),
    );

    const toggle = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectedCount = selected.size;
    const canGenerate = flowsReviewed && selectedCount > 0;

    return (
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="px-5 pt-5 pb-4 border-b border-neutral-100">
                <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600">
                        <ImageIcon size={16} />
                    </span>
                    <div>
                        <h3 className="text-base font-bold text-neutral-900 tracking-tight">
                            Approve flows before generating mockups
                        </h3>
                        <p className="text-xs text-neutral-500 mt-0.5">
                            Review your user flows, then choose which screens are worth rendering as
                            images. Mockups aren't generated until you approve.
                        </p>
                    </div>
                </div>
            </div>

            {/* Step 1 — review flows */}
            <div className="px-5 py-4 border-b border-neutral-100">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold mb-2 flex items-center gap-1.5">
                    <Workflow size={12} /> Step 1 · Review the user flows
                </p>
                {flows.length > 0 ? (
                    <ul className="space-y-1.5 mb-3">
                        {flows.map((flow, idx) => (
                            <li
                                key={idx}
                                className="flex items-start gap-2 text-sm text-neutral-700"
                            >
                                <span className="shrink-0 w-5 h-5 rounded bg-neutral-100 text-neutral-500 text-[11px] font-semibold flex items-center justify-center tabular-nums mt-0.5">
                                    {idx + 1}
                                </span>
                                <span className="min-w-0">
                                    <span className="font-medium text-neutral-900">{flow.title}</span>
                                    <span className="text-neutral-400">
                                        {' '}· {flow.steps.length} {flow.steps.length === 1 ? 'step' : 'steps'}
                                    </span>
                                    {flow.goal && (
                                        <span className="block text-xs text-neutral-500 truncate">{flow.goal}</span>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-neutral-500 mb-3">
                        No user flows artifact was found. Review your screens below before generating.
                    </p>
                )}
                <div className="flex items-center gap-3 flex-wrap">
                    <button
                        type="button"
                        onClick={onOpenFlows}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
                    >
                        Open Flows <ArrowRight size={12} />
                    </button>
                    <label className="inline-flex items-center gap-2 text-sm text-neutral-700 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={flowsReviewed}
                            onChange={e => setFlowsReviewed(e.target.checked)}
                            className="w-4 h-4 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        I've reviewed the user flows
                    </label>
                </div>
            </div>

            {/* Step 2 — pick screens */}
            <div className="px-5 py-4">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold mb-2 flex items-center gap-1.5">
                    <ListChecks size={12} /> Step 2 · Choose screens to mock up
                </p>
                <ul className="space-y-1.5">
                    {recommendations.map(({ screen, reason }) => {
                        const checked = selected.has(screen.id);
                        return (
                            <li key={screen.id}>
                                <label
                                    className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition ${
                                        checked
                                            ? 'border-indigo-200 bg-indigo-50/40'
                                            : 'border-neutral-200 hover:bg-neutral-50'
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggle(screen.id)}
                                        className="w-4 h-4 mt-0.5 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-semibold text-neutral-900 truncate">
                                                {screen.name}
                                            </span>
                                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-neutral-200 bg-neutral-50 text-neutral-500 font-medium">
                                                {reason}
                                            </span>
                                        </span>
                                        {screen.purpose && (
                                            <span className="block text-xs text-neutral-500 truncate mt-0.5">
                                                {screen.purpose}
                                            </span>
                                        )}
                                    </span>
                                </label>
                            </li>
                        );
                    })}
                </ul>
            </div>

            {/* Footer — approve */}
            <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50/40 flex items-center gap-3 flex-wrap">
                <button
                    type="button"
                    disabled={!canGenerate}
                    onClick={() => onApprove([...selected])}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition"
                >
                    {hasImageKey ? <Sparkles size={14} /> : <Check size={14} />}
                    Generate mockups
                    <span className="tabular-nums opacity-90">
                        ({selectedCount} {selectedCount === 1 ? 'screen' : 'screens'})
                    </span>
                </button>
                {!flowsReviewed && (
                    <span className="text-xs text-neutral-500">
                        Confirm you've reviewed the flows to continue.
                    </span>
                )}
                {flowsReviewed && !hasImageKey && (
                    <span className="text-xs text-amber-600">
                        No OpenAI key — screens are approved, but add a key to render images.
                    </span>
                )}
            </div>
        </div>
    );
}
