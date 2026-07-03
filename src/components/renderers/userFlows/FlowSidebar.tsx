import { useEffect, useState } from 'react';
import {
    Clock, GitBranch, Menu, PanelLeftClose, PanelLeftOpen, Sparkles, X,
} from 'lucide-react';
import type { FlowCategory, FlowIssueKind, FlowRiskLevel, ParsedFlow } from './types';
import { CATEGORY_ORDER } from './categorize';

const RISK_DOT: Record<FlowRiskLevel, { color: string; label: string }> = {
    low: { color: 'bg-emerald-400', label: 'Low risk' },
    medium: { color: 'bg-amber-400', label: 'Medium risk' },
    high: { color: 'bg-red-500', label: 'High risk' },
};

interface Props {
    flows: ParsedFlow[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    isMobileOpen: boolean;
    onToggleMobile: (open: boolean) => void;
    /** Optional per-flow time-to-value strings (computed once at parent level). */
    ttvByFlow?: (string | null)[];
}

type Grouped = { category: FlowCategory; items: Array<{ flow: ParsedFlow; originalIndex: number }> };

function groupFlows(flows: ParsedFlow[]): Grouped[] {
    const map = new Map<FlowCategory, Array<{ flow: ParsedFlow; originalIndex: number }>>();
    flows.forEach((flow, originalIndex) => {
        const list = map.get(flow.category) ?? [];
        list.push({ flow, originalIndex });
        map.set(flow.category, list);
    });
    return CATEGORY_ORDER
        .filter(cat => map.has(cat))
        .map(category => ({ category, items: map.get(category)! }));
}

const ALT_PATH_KINDS: FlowIssueKind[] = ['alternate_path', 'failure_mode'];

function summarizeIssues(flow: ParsedFlow): {
    altPaths: number;
    edgeCases: number;
    unresolved: number;
} {
    let altPaths = 0;
    let edgeCases = 0;
    let unresolved = 0;
    for (const issue of flow.issues) {
        if (ALT_PATH_KINDS.includes(issue.kind)) altPaths++;
        else if (issue.kind === 'edge_case') edgeCases++;
        else if (issue.kind === 'unresolved_reference') unresolved++;
        else if (issue.kind === 'validation_warning') edgeCases++;
    }
    return { altPaths, edgeCases, unresolved };
}

export function FlowSidebar({
    flows, selectedIndex, onSelect, isMobileOpen, onToggleMobile, ttvByFlow,
}: Props) {
    const grouped = groupFlows(flows);
    const selected = flows[selectedIndex];
    // Desktop rail collapses to a narrow numbered strip so the flow list is
    // one click away without permanently dominating horizontal space. A
    // single-flow artifact never needs a switcher, so the rail hides entirely.
    const [railExpanded, setRailExpanded] = useState(false);
    const multiFlow = flows.length > 1;

    useEffect(() => {
        if (!isMobileOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onToggleMobile(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isMobileOpen, onToggleMobile]);

    const renderList = (onPick: (i: number) => void) => (
        <div className="space-y-4">
            {grouped.map(group => (
                <div key={group.category}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5 px-2">
                        {group.category}
                    </p>
                    <ul className="space-y-1">
                        {group.items.map(({ flow, originalIndex }) => {
                            const active = originalIndex === selectedIndex;
                            const stepCount = flow.steps.length;
                            const { altPaths, edgeCases, unresolved } = summarizeIssues(flow);
                            const featureCount = flow.featureRefs.length;
                            const ttv = ttvByFlow?.[originalIndex] ?? null;
                            const risk = RISK_DOT[flow.risk];
                            // Only surface the risk dot when there's something to
                            // warn about — a green "low risk" dot on every flow
                            // teaches the eye to ignore the indicator.
                            const showRisk = flow.risk !== 'low' || flow.issues.length > 0;
                            return (
                                <li key={originalIndex}>
                                    <button
                                        type="button"
                                        onClick={() => onPick(originalIndex)}
                                        aria-current={active ? 'true' : undefined}
                                        className={`w-full text-left px-2.5 py-2.5 rounded-md transition border ${
                                            active
                                                ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-200 text-indigo-900 shadow-sm'
                                                : 'border-transparent hover:bg-neutral-50 text-neutral-700'
                                        }`}
                                    >
                                        <div className="flex items-start gap-2">
                                            <span
                                                className={`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                                                    active
                                                        ? 'bg-indigo-600 text-white'
                                                        : 'bg-neutral-200 text-neutral-700'
                                                }`}
                                            >
                                                {originalIndex + 1}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-start gap-1.5">
                                                    <p
                                                        className="text-sm font-medium leading-snug break-words min-w-0 flex-1"
                                                        title={flow.title}
                                                    >
                                                        {flow.title}
                                                    </p>
                                                    {showRisk && (
                                                        <span
                                                            className={`mt-1.5 shrink-0 inline-block w-2 h-2 rounded-full ${risk.color}`}
                                                            title={risk.label}
                                                            aria-label={risk.label}
                                                        />
                                                    )}
                                                </div>
                                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-neutral-500">
                                                    <span className="inline-flex items-center gap-0.5">
                                                        <GitBranch size={10} />
                                                        {stepCount} {stepCount === 1 ? 'step' : 'steps'}
                                                    </span>
                                                    {featureCount > 0 && (
                                                        <span className="inline-flex items-center gap-0.5">
                                                            <Sparkles size={10} className="text-fuchsia-500" />
                                                            {featureCount} {featureCount === 1 ? 'feature' : 'features'}
                                                        </span>
                                                    )}
                                                    {altPaths > 0 && (
                                                        <span>
                                                            {altPaths} alt {altPaths === 1 ? 'path' : 'paths'}
                                                        </span>
                                                    )}
                                                    {edgeCases > 0 && (
                                                        <span>
                                                            {edgeCases} edge {edgeCases === 1 ? 'case' : 'cases'}
                                                        </span>
                                                    )}
                                                    {unresolved > 0 && (
                                                        <span className="text-amber-700">
                                                            {unresolved} unresolved
                                                        </span>
                                                    )}
                                                    {ttv && (
                                                        <span className="inline-flex items-center gap-0.5">
                                                            <Clock size={10} /> {ttv} to value
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );

    // Narrow collapsed rail: numbered buttons only, name on hover/tooltip.
    const renderCollapsedRail = () => (
        <ul className="space-y-1.5" aria-label="Flows">
            {flows.map((flow, i) => {
                const active = i === selectedIndex;
                const showRisk = flow.risk !== 'low' || flow.issues.length > 0;
                const risk = RISK_DOT[flow.risk];
                return (
                    <li key={i} className="relative flex justify-center">
                        <button
                            type="button"
                            onClick={() => onSelect(i)}
                            aria-current={active ? 'true' : undefined}
                            title={`Flow ${i + 1}: ${flow.title}`}
                            className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition ${
                                active
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                            }`}
                        >
                            {i + 1}
                        </button>
                        {showRisk && (
                            <span
                                className={`absolute top-0 right-1 w-2 h-2 rounded-full ring-2 ring-white ${risk.color}`}
                                title={risk.label}
                                aria-label={risk.label}
                            />
                        )}
                    </li>
                );
            })}
        </ul>
    );

    return (
        <>
            {/* Desktop rail — collapsible; hidden entirely for single-flow artifacts */}
            {multiFlow && (
                <aside
                    className={`hidden md:block shrink-0 self-start sticky top-0 max-h-[calc(100vh-6rem)] overflow-y-auto border-r border-neutral-200 transition-[width] duration-200 ${
                        railExpanded ? 'w-64 pr-2' : 'w-14 pr-1'
                    }`}
                    aria-label="Flow navigation"
                >
                    <div className={`mb-3 flex items-center ${railExpanded ? 'px-2 justify-between' : 'justify-center'}`}>
                        {railExpanded && (
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-700">
                                User Flows
                            </p>
                        )}
                        <button
                            type="button"
                            onClick={() => setRailExpanded(e => !e)}
                            aria-expanded={railExpanded}
                            aria-label={railExpanded ? 'Collapse flow list' : 'Expand flow list'}
                            title={railExpanded ? 'Collapse flow list' : 'Expand flow list'}
                            className="p-1.5 rounded hover:bg-neutral-100 text-neutral-500"
                        >
                            {railExpanded ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
                        </button>
                    </div>
                    {railExpanded ? renderList(onSelect) : renderCollapsedRail()}
                </aside>
            )}

            {/* Mobile trigger — full-width current-flow selector that opens the
                drawer. Single-flow artifacts have nothing to switch between. */}
            {multiFlow && (
            <div className="md:hidden mb-3">
                <button
                    type="button"
                    onClick={() => onToggleMobile(true)}
                    aria-label={
                        selected
                            ? `Browse flows — current: flow ${selectedIndex + 1} of ${flows.length}, ${selected.title}`
                            : 'Browse flows'
                    }
                    className="w-full flex items-center gap-3 px-3 py-2.5 bg-white border border-neutral-300 rounded-lg text-left hover:bg-neutral-50 active:bg-neutral-100 transition"
                >
                    <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-bold">
                        {selectedIndex + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400 truncate">
                            {selected
                                ? `${selected.category} · ${selectedIndex + 1} of ${flows.length}`
                                : `${flows.length} ${flows.length === 1 ? 'flow' : 'flows'}`}
                        </span>
                        <span className="block text-sm font-medium text-neutral-800 truncate">
                            {selected?.title ?? 'Select a flow'}
                        </span>
                    </span>
                    <Menu size={16} className="shrink-0 text-neutral-400" />
                </button>
            </div>
            )}

            {/* Mobile drawer overlay + panel */}
            {isMobileOpen && (
                <button
                    type="button"
                    aria-label="Close flow navigation"
                    onClick={() => onToggleMobile(false)}
                    className="md:hidden fixed inset-0 bg-black/40 z-40"
                />
            )}
            <aside
                className={`md:hidden fixed top-0 left-0 h-full w-80 max-w-[85vw] bg-white border-r border-neutral-200 z-50 transform transition-transform duration-200 ease-out ${
                    isMobileOpen ? 'translate-x-0' : '-translate-x-full'
                }`}
                aria-hidden={!isMobileOpen}
            >
                <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200">
                    <span className="text-sm font-semibold text-neutral-900">Flows</span>
                    <button
                        type="button"
                        onClick={() => onToggleMobile(false)}
                        className="p-1 rounded hover:bg-neutral-100 text-neutral-500"
                        aria-label="Close"
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="overflow-y-auto h-[calc(100%-2.75rem)] p-2">
                    {renderList(i => {
                        onSelect(i);
                        onToggleMobile(false);
                    })}
                </div>
            </aside>
        </>
    );
}
