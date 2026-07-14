import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Clock3, FileQuestion, RefreshCcw, Sparkles, X } from 'lucide-react';

export type DecisionCenterOptionView = {
    id: string;
    label: string;
    description?: string;
    tradeoffs?: Array<{ kind: 'benefit' | 'cost' | 'risk' | 'constraint'; summary: string }>;
};

export type DecisionCenterPreviewView = {
    id: string;
    status: 'generating' | 'ready' | 'stale' | 'failed' | 'applied' | 'superseded';
    affectedPrdSections: string[];
    affectedArtifactLabels: string[];
    beforeSummary?: string;
    afterSummary?: string;
    explanation?: string;
    error?: string;
    canApply?: boolean;
};

export type DecisionCenterRecordView = {
    id: string;
    type: 'decision' | 'assumption' | 'risk' | 'question' | 'conflict';
    title: string;
    statement?: string;
    whyItMatters?: string;
    status: 'proposed' | 'open' | 'confirmed' | 'rejected' | 'deferred' | 'resolved' | 'invalidated' | 'superseded';
    options?: DecisionCenterOptionView[];
    recommendation?: { optionId?: string; summary: string; rationale?: string; confidence?: string };
    resolution?: string;
    rationale?: string;
    sourceLabels?: string[];
    sourceNotice?: string;
    createdAt: number;
    history?: Array<{ id: string; label: string; at: number; rationale?: string }>;
    preview?: DecisionCenterPreviewView;
};

export type DecisionAction = 'confirm' | 'custom' | 'defer' | 'reject' | 'reopen' | 'revise' | 'invalidate';

interface Props {
    records: DecisionCenterRecordView[];
    readOnly?: boolean;
    onDecide: (recordId: string, action: DecisionAction, value?: string, rationale?: string) => void;
    onPreviewImpact: (recordId: string) => void;
    onApplyToPlan: (recordId: string) => void;
}

const needsReview = (record: DecisionCenterRecordView) => ['proposed', 'open'].includes(record.status);

export function DecisionCenter({ records, readOnly, onDecide, onPreviewImpact, onApplyToPlan }: Props) {
    const [view, setView] = useState<'needs_review' | 'log'>(() => records.some(needsReview) ? 'needs_review' : 'log');
    const visible = useMemo(() => records.filter(record => view === 'needs_review' ? needsReview(record) : !needsReview(record)), [records, view]);
    const [selectedId, setSelectedId] = useState<string>();
    const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
    const [customAnswer, setCustomAnswer] = useState('');
    const [rationale, setRationale] = useState('');
    const detailHeadingRef = useRef<HTMLHeadingElement>(null);
    const selected = visible.find(record => record.id === selectedId) ?? visible[0];
    const unresolvedCount = records.filter(needsReview).length;

    useEffect(() => {
        if (mobileDetailOpen) detailHeadingRef.current?.focus();
    }, [mobileDetailOpen, selected?.id]);

    const choose = (id: string) => {
        setSelectedId(id);
        setMobileDetailOpen(true);
        setCustomAnswer('');
        setRationale('');
    };

    const submit = (action: DecisionAction, value?: string) => {
        if (!selected) return;
        onDecide(selected.id, action, value, rationale.trim() || undefined);
        // A newly recorded answer should remain in view so the user can inspect
        // its consequences and request an impact preview. Moving it out of the
        // needs-review queue must not feel like the reasoning disappeared.
        if (action === 'reopen') {
            setView('needs_review');
        } else if (needsReview(selected)) {
            setView('log');
        }
        setSelectedId(selected.id);
        setMobileDetailOpen(true);
        setCustomAnswer('');
        setRationale('');
    };

    return (
        <div className="flex h-full min-h-0 flex-col bg-neutral-50">
            <header className="shrink-0 border-b border-neutral-200 bg-white px-4 py-4 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Decision Center</h1>
                        <p className="mt-1 text-sm text-neutral-500">Resolve consequential choices, preview their impact, then apply them explicitly.</p>
                    </div>
                    <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800" aria-label={`${unresolvedCount} decisions need review`}>
                        {unresolvedCount} need{unresolvedCount === 1 ? 's' : ''} review
                    </div>
                </div>
            </header>
            {unresolvedCount === 0 && records.length > 0 && (
                <div className="shrink-0 border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 sm:px-6" role="status">
                    All current decisions reviewed
                </div>
            )}

            <div className="min-h-0 flex-1 md:grid md:grid-cols-[300px_minmax(0,1fr)]">
                <aside className={`${mobileDetailOpen ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-r border-neutral-200 bg-white`} aria-label="Decision queue">
                    <div className="flex shrink-0 border-b border-neutral-100 p-2">
                        <button type="button" onClick={() => setView('needs_review')} className={`min-h-10 flex-1 rounded-lg px-2 text-sm font-semibold ${view === 'needs_review' ? 'bg-indigo-50 text-indigo-700' : 'text-neutral-500 hover:bg-neutral-50'}`}>Needs review</button>
                        <button type="button" onClick={() => setView('log')} className={`min-h-10 flex-1 rounded-lg px-2 text-sm font-semibold ${view === 'log' ? 'bg-indigo-50 text-indigo-700' : 'text-neutral-500 hover:bg-neutral-50'}`}>Decision log</button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-2">
                        {visible.length === 0 ? (
                            <div className="px-4 py-10 text-center">
                                {view === 'needs_review' ? <Check className="mx-auto text-emerald-500" size={24} /> : <FileQuestion className="mx-auto text-neutral-300" size={24} />}
                                <p className="mt-3 text-sm font-semibold text-neutral-800">{view === 'needs_review' ? 'All current decisions reviewed' : 'No decision history yet'}</p>
                                <p className="mt-1 text-xs leading-5 text-neutral-500">{view === 'needs_review' ? 'New assumptions and review findings will appear here.' : 'Resolved and deferred choices remain available here.'}</p>
                            </div>
                        ) : visible.map(record => (
                            <button
                                type="button"
                                key={record.id}
                                onClick={() => choose(record.id)}
                                aria-current={selected?.id === record.id ? 'true' : undefined}
                                className={`mb-1 w-full rounded-xl border px-3 py-3 text-left transition ${selected?.id === record.id ? 'border-indigo-200 bg-indigo-50' : 'border-transparent hover:bg-neutral-50'}`}
                            >
                                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                                    <span>{record.type === 'question' ? 'Open question' : record.type.replace('_', ' ')}</span>
                                    <span>·</span><span>{record.status.replace('_', ' ')}</span>
                                </div>
                                <p className="mt-1 text-sm font-semibold leading-5 text-neutral-900">{record.title}</p>
                                {record.sourceLabels?.[0] && <p className="mt-1 truncate text-xs text-neutral-400">From {record.sourceLabels[0]}</p>}
                            </button>
                        ))}
                    </div>
                </aside>

                <main className={`${mobileDetailOpen ? 'block' : 'hidden md:block'} min-h-0 overflow-y-auto`} aria-label="Decision detail">
                    {!selected ? (
                        <div className="mx-auto max-w-xl px-5 py-16 text-center text-sm text-neutral-500">Select a decision to inspect its reasoning and history.</div>
                    ) : (
                        <div className="mx-auto max-w-3xl px-4 py-5 sm:px-7 sm:py-8">
                            <button type="button" onClick={() => setMobileDetailOpen(false)} className="mb-4 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-neutral-600 md:hidden"><ArrowLeft size={16} /> Back to decisions</button>
                            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">{selected.status.replace('_', ' ')} · {selected.type.replace('_', ' ')}</div>
                            <h2 ref={detailHeadingRef} tabIndex={-1} className="mt-2 text-2xl font-bold leading-tight text-neutral-950">{selected.title}</h2>
                            {selected.statement && selected.statement !== selected.title && <p className="mt-2 text-sm leading-6 text-neutral-700">{selected.statement}</p>}
                            {selected.sourceNotice && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">{selected.sourceNotice}</div>}
                            {selected.whyItMatters && <section className="mt-6"><h3 className="text-sm font-semibold text-neutral-900">Why it matters</h3><p className="mt-1 text-sm leading-6 text-neutral-600">{selected.whyItMatters}</p></section>}

                            {selected.options && selected.options.length > 0 && needsReview(selected) && (
                                <section className="mt-6 space-y-2" aria-label="Available options">
                                    {selected.options.map(option => (
                                        <button key={option.id} type="button" disabled={readOnly} onClick={() => submit('confirm', option.id)} className="w-full rounded-xl border border-neutral-200 bg-white p-4 text-left hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-60">
                                            <span className="text-sm font-semibold text-neutral-900">{option.label}</span>
                                            {option.description && <span className="mt-1 block text-sm text-neutral-600">{option.description}</span>}
                                            {option.tradeoffs && option.tradeoffs.length > 0 && <span className="mt-2 block text-xs text-neutral-500">{option.tradeoffs.map(item => item.summary).join(' · ')}</span>}
                                        </button>
                                    ))}
                                </section>
                            )}

                            {selected.recommendation && (
                                <section className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50/70 p-4">
                                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-700"><Sparkles size={14} /> Synapse recommendation</div>
                                    <p className="mt-2 text-sm font-semibold text-indigo-950">{selected.recommendation.summary}</p>
                                    {selected.recommendation.rationale && <p className="mt-1 text-sm leading-6 text-indigo-900/80">{selected.recommendation.rationale}</p>}
                                </section>
                            )}

                            {!readOnly && needsReview(selected) && (
                                <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-4">
                                    <label className="text-sm font-semibold text-neutral-900" htmlFor="decision-answer">Your answer</label>
                                    <textarea id="decision-answer" value={customAnswer} onChange={event => setCustomAnswer(event.target.value)} rows={3} placeholder="Record the product choice in your own words" className="mt-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                                    <label className="mt-3 block text-xs font-medium text-neutral-600" htmlFor="decision-rationale">Why? (optional)</label>
                                    <input id="decision-rationale" value={rationale} onChange={event => setRationale(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                        <button type="button" disabled={!customAnswer.trim()} onClick={() => submit('custom', customAnswer.trim())} className="min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-40">Save decision</button>
                                        {selected.type === 'decision' && !selected.options?.length && <button type="button" onClick={() => submit('confirm', selected.statement || selected.title)} className="min-h-11 rounded-lg border border-emerald-200 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">Confirm decision</button>}
                                        {selected.type === 'assumption' && <button type="button" onClick={() => submit('confirm', selected.statement || selected.title)} className="min-h-11 rounded-lg border border-emerald-200 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">Confirm as true</button>}
                                        <button type="button" onClick={() => submit('defer')} className="min-h-11 rounded-lg border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"><Clock3 size={14} className="mr-1 inline" /> Defer</button>
                                        <button type="button" disabled={!customAnswer.trim()} onClick={() => submit('reject', customAnswer.trim())} className="min-h-11 rounded-lg border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"><X size={14} className="mr-1 inline" /> Reject premise</button>
                                    </div>
                                </section>
                            )}

                            {!needsReview(selected) && selected.status !== 'deferred' && selected.status !== 'invalidated' && (
                                <section className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                                    <h3 className="text-sm font-semibold text-emerald-900">Selected answer</h3>
                                    <p className="mt-1 text-sm text-emerald-800">{selected.resolution || 'Decision recorded'}</p>
                                    {selected.rationale && <p className="mt-1 text-xs text-emerald-700">Reason: {selected.rationale}</p>}
                                </section>
                            )}

                            {selected.preview ? (
                                <section className={`mt-6 rounded-xl border p-4 ${selected.preview.status === 'stale' || selected.preview.status === 'failed' ? 'border-amber-200 bg-amber-50' : 'border-indigo-200 bg-indigo-50/60'}`}>
                                    <h3 className="text-sm font-semibold text-neutral-900">Impact preview · {selected.preview.status}</h3>
                                    {selected.preview.beforeSummary && <p className="mt-3 text-xs text-neutral-500">Before</p>}
                                    {selected.preview.beforeSummary && <p className="text-sm text-neutral-700">{selected.preview.beforeSummary}</p>}
                                    {selected.preview.afterSummary && <p className="mt-3 text-xs text-neutral-500">After</p>}
                                    {selected.preview.afterSummary && <p className="text-sm font-medium text-neutral-900">{selected.preview.afterSummary}</p>}
                                    <p className="mt-3 text-xs text-neutral-500">PRD: {selected.preview.affectedPrdSections.join(', ') || 'No verified changes'}</p>
                                    <p className="mt-1 text-xs text-neutral-500">Assets to review: {selected.preview.affectedArtifactLabels.join(', ') || 'None identified'}</p>
                                    {selected.preview.explanation && <p className="mt-3 text-sm leading-6 text-neutral-700">{selected.preview.explanation}</p>}
                                    {selected.preview.error && <p className="mt-2 text-sm text-red-700">{selected.preview.error}</p>}
                                    {!readOnly && selected.preview.status === 'ready' && selected.preview.canApply && <button type="button" onClick={() => onApplyToPlan(selected.id)} className="mt-4 min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700">Record in working plan</button>}
                                    {!readOnly && (selected.preview.status === 'stale' || selected.preview.status === 'failed') && <button type="button" onClick={() => onPreviewImpact(selected.id)} className="mt-4 min-h-11 rounded-lg border border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-800"><RefreshCcw size={14} className="mr-1 inline" /> Refresh preview</button>}
                                </section>
                            ) : !readOnly && ['confirmed', 'rejected', 'resolved'].includes(selected.status) ? (
                                <button type="button" onClick={() => onPreviewImpact(selected.id)} className="mt-6 min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700">Preview impact</button>
                            ) : null}

                            <details className="mt-7 border-t border-neutral-200 pt-4">
                                <summary className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-semibold text-neutral-700"><ChevronDown size={14} /> Source and history</summary>
                                <p className="mt-2 text-xs text-neutral-500">Sources: {selected.sourceLabels?.join(', ') || 'User-created decision'}</p>
                                <ol className="mt-3 space-y-3 border-l border-neutral-200 pl-4">
                                    {(selected.history ?? []).map(item => <li key={item.id}><p className="text-sm font-medium text-neutral-800">{item.label}</p><p className="text-xs text-neutral-400">{new Date(item.at).toLocaleString()}</p>{item.rationale && <p className="mt-1 text-xs text-neutral-600">{item.rationale}</p>}</li>)}
                                </ol>
                            </details>

                            {!readOnly && ['confirmed', 'rejected', 'resolved'].includes(selected.status) && (
                                <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-4">
                                    <label className="text-sm font-semibold text-neutral-900" htmlFor="decision-revision">Revise or invalidate</label>
                                    <textarea id="decision-revision" value={customAnswer} onChange={event => setCustomAnswer(event.target.value)} rows={2} placeholder="Enter the revised answer or explain why this decision is no longer valid" className="mt-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <button type="button" disabled={!customAnswer.trim()} onClick={() => submit('revise', customAnswer.trim())} className="min-h-11 rounded-lg border border-indigo-200 px-4 text-sm font-semibold text-indigo-700 disabled:opacity-40">Save revision</button>
                                        <button type="button" disabled={!customAnswer.trim()} onClick={() => submit('invalidate', customAnswer.trim())} className="min-h-11 rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-700 disabled:opacity-40">Mark no longer valid</button>
                                    </div>
                                </section>
                            )}

                            {!readOnly && !needsReview(selected) && <button type="button" onClick={() => submit('reopen')} className="mt-6 min-h-11 rounded-lg border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-white"><RefreshCcw size={14} className="mr-1 inline" /> Reopen decision</button>}
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
