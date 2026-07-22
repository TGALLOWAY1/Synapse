import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    Check,
    CheckCircle2,
    ChevronDown,
    Clock3,
    Loader2,
    ShieldCheck,
    Sparkles,
} from 'lucide-react';
import { ScreenShell } from '../components/ScreenShell';
import { DECISION_DEMO } from '../tourData';
import type { ScreenProps } from '../tourTypes';

type RecordId = 'collab-model' | 'pay-before-finish' | 'platform';
type QueueTab = 'attention' | 'log';
type PreviewPhase = 'idle' | 'generating' | 'ready' | 'applied';

const PREVIEW_GEN_MS = 900;

/**
 * Screen 4 — the Decision Center (the workspace's Challenge stage). Mirrors
 * `src/components/review/DecisionCenter.tsx`: a "Needs attention" queue,
 * suggested options with the Synapse recommendation preselected as the
 * default choice (one explicit click approves it — the verdict is still only
 * ever recorded by the user), and a plan-alignment preview that is applied as
 * an explicit, separate step. Teaches that the user decides and Synapse only
 * drafts the consequences.
 */
export default function ScreenDecisions({ reducedMotion }: ScreenProps) {
    const { decision, assumption, resolved, challengeTabs } = DECISION_DEMO;

    const [selectedId, setSelectedId] = useState<RecordId>(decision.id as RecordId);
    const [queueTab, setQueueTab] = useState<QueueTab>('attention');
    const [decisionRecorded, setDecisionRecorded] = useState(false);
    const [assumptionAccepted, setAssumptionAccepted] = useState(false);
    // The recommendation starts preselected, matching the live Decision Center.
    const [answerChoice, setAnswerChoice] = useState<string | undefined>(decision.recommendedId);
    const [previewPhase, setPreviewPhase] = useState<PreviewPhase>('idle');
    const [acceptedProposals, setAcceptedProposals] = useState<string[]>([]);
    const timer = useRef<number | undefined>(undefined);

    useEffect(() => () => window.clearTimeout(timer.current), []);

    const attentionQueue = [
        ...(!decisionRecorded ? [{ id: decision.id, condition: decision.conditionLabel, title: decision.title, source: decision.source }] : []),
        ...(!assumptionAccepted ? [{ id: assumption.id, condition: assumption.conditionLabel, title: assumption.title, source: assumption.source }] : []),
    ];
    const logQueue = [
        ...(decisionRecorded ? [{ id: decision.id, condition: 'Answer recorded', title: decision.title, source: decision.source }] : []),
        ...(assumptionAccepted ? [{ id: assumption.id, condition: 'Accepted · not validated', title: assumption.title, source: assumption.source }] : []),
        { id: resolved.id, condition: resolved.conditionLabel, title: resolved.title, source: resolved.source },
    ];
    const queue = queueTab === 'attention' ? attentionQueue : logQueue;

    const chosenOption = decision.options.find((o) => o.id === answerChoice);

    const saveDecision = () => {
        if (!chosenOption) return;
        setDecisionRecorded(true);
        setQueueTab('log');
    };

    const previewImpact = () => {
        if (reducedMotion) {
            setPreviewPhase('ready');
            return;
        }
        setPreviewPhase('generating');
        timer.current = window.setTimeout(() => setPreviewPhase('ready'), PREVIEW_GEN_MS);
    };

    const toggleProposal = (id: string) =>
        setAcceptedProposals((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

    const selectRecord = (id: RecordId) => setSelectedId(id);

    return (
        <ScreenShell
            title="Challenge the plan."
            accent="The decisions stay yours."
            subtitle="Synapse surfaces the choices and assumptions hiding in your spec. You record the verdict — it previews exactly what changes before anything is applied."
        >
            <div className="overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-800/40">
                {/* Challenge-stage tab strip, mirroring the live workspace */}
                <div className="flex items-center gap-1 border-b border-neutral-700/80 px-3 pt-2" aria-hidden="true">
                    {challengeTabs.map((tab) => (
                        <span
                            key={tab}
                            className={`whitespace-nowrap border-b-2 px-3 pb-2 text-xs font-semibold ${
                                tab === 'Decision Center'
                                    ? 'border-indigo-400 text-indigo-200'
                                    : 'border-transparent text-neutral-500'
                            }`}
                        >
                            {tab}
                        </span>
                    ))}
                    <span className="ml-auto mb-1.5 hidden items-center rounded-lg bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300 sm:inline-flex">
                        {attentionQueue.length} need{attentionQueue.length === 1 ? 's' : ''} attention
                    </span>
                </div>

                <div className="grid md:grid-cols-[240px_minmax(0,1fr)]">
                    {/* Decision queue */}
                    <aside className="border-b border-neutral-700/80 md:border-b-0 md:border-r" aria-label="Decision queue">
                        <div className="flex gap-1 p-2">
                            <button
                                type="button"
                                onClick={() => setQueueTab('attention')}
                                className={`min-h-9 flex-1 rounded-lg px-2 text-xs font-semibold transition ${
                                    queueTab === 'attention' ? 'bg-indigo-500/15 text-indigo-200' : 'text-neutral-500 hover:text-neutral-300'
                                }`}
                            >
                                Needs attention
                            </button>
                            <button
                                type="button"
                                onClick={() => setQueueTab('log')}
                                className={`min-h-9 flex-1 rounded-lg px-2 text-xs font-semibold transition ${
                                    queueTab === 'log' ? 'bg-indigo-500/15 text-indigo-200' : 'text-neutral-500 hover:text-neutral-300'
                                }`}
                            >
                                Resolved &amp; history
                            </button>
                        </div>
                        <div className="flex gap-2 overflow-x-auto px-2 pb-2 md:block md:space-y-1 md:overflow-visible">
                            {queue.length === 0 ? (
                                <p className="flex items-center gap-2 px-3 py-4 text-xs text-neutral-500">
                                    <Check size={13} className="text-emerald-400" /> Nothing needs attention
                                </p>
                            ) : (
                                queue.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => selectRecord(item.id as RecordId)}
                                        aria-current={selectedId === item.id ? 'true' : undefined}
                                        className={`w-64 shrink-0 rounded-xl border px-3 py-2.5 text-left transition md:w-full ${
                                            selectedId === item.id
                                                ? 'border-indigo-500/50 bg-indigo-500/10'
                                                : 'border-transparent hover:bg-white/5'
                                        }`}
                                    >
                                        <span className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                                            {item.condition}
                                        </span>
                                        <span className="mt-0.5 block text-sm font-medium leading-5 text-neutral-100">{item.title}</span>
                                        <span className="mt-0.5 block truncate text-[11px] text-neutral-500">From {item.source}</span>
                                    </button>
                                ))
                            )}
                        </div>
                    </aside>

                    {/* Detail pane */}
                    <div className="p-4 sm:p-5" aria-live="polite">
                        {selectedId === decision.id && (
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                                    {decisionRecorded ? 'Answer recorded' : decision.conditionLabel}
                                </p>
                                <h3 className="mt-1 text-lg font-semibold leading-snug text-white">{decision.title}</h3>
                                <p className="mt-1.5 text-sm text-neutral-400">{decision.statement}</p>
                                <p className="mt-3 text-xs text-neutral-500">
                                    <span className="font-semibold text-neutral-400">Why it matters:</span> {decision.whyItMatters}
                                </p>

                                {!decisionRecorded && (
                                    <>
                                        <div className="mt-4 rounded-xl border border-indigo-500/30 bg-indigo-500/[0.07] px-3.5 py-2.5">
                                            <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-300">Next action</p>
                                            <p className="mt-0.5 text-sm font-medium text-indigo-100">{decision.nextAction}</p>
                                        </div>
                                        <div className="mt-4">
                                            <p className="text-sm font-semibold text-neutral-200" id="tour-decision-answer">
                                                Your answer
                                            </p>
                                            <div className="mt-2 space-y-2" role="radiogroup" aria-labelledby="tour-decision-answer">
                                                {decision.options.map((option) => {
                                                    const isRecommended = option.id === decision.recommendedId;
                                                    const isChosen = answerChoice === option.id;
                                                    return (
                                                        <button
                                                            key={option.id}
                                                            type="button"
                                                            role="radio"
                                                            aria-checked={isChosen}
                                                            onClick={() => setAnswerChoice(option.id)}
                                                            className={`w-full rounded-xl border p-3.5 text-left transition ${
                                                                isChosen
                                                                    ? 'border-indigo-400 bg-indigo-500/15 ring-1 ring-indigo-400/50'
                                                                    : 'border-neutral-700 bg-neutral-800/60 hover:border-indigo-500/50'
                                                            }`}
                                                        >
                                                            <span className="flex flex-wrap items-center gap-2">
                                                                <span className="text-sm font-semibold text-neutral-100">{option.label}</span>
                                                                {isRecommended && (
                                                                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-200">
                                                                        <Sparkles size={10} /> Recommended
                                                                    </span>
                                                                )}
                                                            </span>
                                                            <span className="mt-1 block text-xs leading-5 text-neutral-400">{option.description}</span>
                                                            <span className="mt-1.5 block text-[11px] text-neutral-500">{option.tradeoffs}</span>
                                                            {isRecommended && (
                                                                <span className="mt-2 block border-t border-indigo-500/20 pt-2 text-[11px] leading-4 text-indigo-200/80">
                                                                    Why Synapse suggests this: {decision.recommendationRationale}
                                                                </span>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    disabled={!chosenOption}
                                                    onClick={saveDecision}
                                                    className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-40"
                                                >
                                                    {chosenOption?.id === decision.recommendedId ? 'Approve recommendation' : 'Save decision'}
                                                </button>
                                                <span className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-700 px-4 py-2.5 text-sm font-medium text-neutral-400">
                                                    <Clock3 size={14} /> Defer
                                                </span>
                                            </div>
                                            <p className="mt-2 text-[11px] text-neutral-500">
                                                The recommendation starts selected so approving takes one click — but the verdict is only recorded when you say so.
                                            </p>
                                        </div>
                                    </>
                                )}

                                {decisionRecorded && chosenOption && (
                                    <div className="mt-4 space-y-3">
                                        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] px-3.5 py-2.5">
                                            <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
                                                <CheckCircle2 size={15} /> Answer recorded
                                            </p>
                                            <p className="mt-0.5 text-sm text-neutral-200">{chosenOption.label}</p>
                                        </div>

                                        {previewPhase === 'idle' && (
                                            <button
                                                type="button"
                                                onClick={previewImpact}
                                                className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
                                            >
                                                Preview impact
                                            </button>
                                        )}
                                        {previewPhase === 'generating' && (
                                            <p className="flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/[0.07] px-3.5 py-2.5 text-sm text-indigo-200" role="status">
                                                <Loader2 size={14} className="animate-spin" /> Comparing your answer against the current plan…
                                            </p>
                                        )}

                                        <AnimatePresence initial={false}>
                                            {(previewPhase === 'ready' || previewPhase === 'applied') && (
                                                <motion.div
                                                    initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    className="rounded-xl border border-indigo-500/30 bg-indigo-500/[0.05] p-3.5"
                                                >
                                                    <p className="text-sm font-semibold text-neutral-100">
                                                        Plan alignment · {previewPhase === 'applied' ? 'Change applied' : 'Review changes'}
                                                    </p>
                                                    <p className="mt-2 text-[11px] uppercase tracking-wide text-neutral-500">Before</p>
                                                    <p className="text-xs leading-5 text-neutral-400">{decision.preview.before}</p>
                                                    <p className="mt-2 text-[11px] uppercase tracking-wide text-neutral-500">After</p>
                                                    <p className="text-xs font-medium leading-5 text-neutral-200">{decision.preview.after}</p>
                                                    <p className="mt-2 text-[11px] text-neutral-500">
                                                        PRD: {decision.preview.affectedSections.join(', ')} · Outputs to review:{' '}
                                                        {decision.preview.affectedOutputs.join(', ')}
                                                    </p>

                                                    <div className="mt-3 space-y-2">
                                                        {decision.preview.proposals.map((proposal) => {
                                                            const accepted = acceptedProposals.includes(proposal.id);
                                                            return (
                                                                <div key={proposal.id} className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
                                                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                                                        <p className="text-xs font-semibold text-neutral-100">{proposal.targetLabel}</p>
                                                                        <span
                                                                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                                                                previewPhase === 'applied'
                                                                                    ? accepted
                                                                                        ? 'bg-emerald-500/15 text-emerald-300'
                                                                                        : 'bg-neutral-700 text-neutral-400'
                                                                                    : accepted
                                                                                      ? 'bg-indigo-500/20 text-indigo-200'
                                                                                      : 'bg-neutral-700 text-neutral-400'
                                                                            }`}
                                                                        >
                                                                            {previewPhase === 'applied'
                                                                                ? accepted
                                                                                    ? 'Updated'
                                                                                    : 'Kept current'
                                                                                : accepted
                                                                                  ? 'Will update'
                                                                                  : 'Needs review'}
                                                                        </span>
                                                                    </div>
                                                                    <p className="mt-1.5 text-[11px] text-neutral-500">Current: {proposal.current}</p>
                                                                    <p className="mt-0.5 text-xs font-medium text-neutral-200">Proposed: {proposal.proposed}</p>
                                                                    <p className="mt-1.5 text-[11px] leading-4 text-neutral-500">{proposal.reason}</p>
                                                                    {previewPhase === 'ready' && (
                                                                        <div className="mt-2 flex gap-2">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => toggleProposal(proposal.id)}
                                                                                aria-pressed={accepted}
                                                                                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                                                                                    accepted
                                                                                        ? 'bg-indigo-600 text-white'
                                                                                        : 'border border-indigo-500/40 text-indigo-200 hover:bg-indigo-500/10'
                                                                                }`}
                                                                            >
                                                                                {accepted ? 'Accepted' : 'Accept'}
                                                                            </button>
                                                                            <span className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-400">
                                                                                Keep current
                                                                            </span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>

                                                    {previewPhase === 'ready' && (
                                                        <button
                                                            type="button"
                                                            disabled={acceptedProposals.length === 0}
                                                            onClick={() => setPreviewPhase('applied')}
                                                            className="mt-3 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-40"
                                                        >
                                                            Apply accepted changes
                                                        </button>
                                                    )}
                                                    {previewPhase === 'applied' && (
                                                        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-300" role="status">
                                                            <CheckCircle2 size={14} /> Applied through a version-safe write — a new PRD version is
                                                            appended, nothing is overwritten.
                                                        </p>
                                                    )}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                )}
                            </div>
                        )}

                        {selectedId === assumption.id && (
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                                    {assumptionAccepted ? 'Accepted · not validated' : assumption.conditionLabel}
                                </p>
                                <h3 className="mt-1 text-lg font-semibold leading-snug text-white">{assumption.title}</h3>
                                <p className="mt-1.5 text-sm text-neutral-400">{assumption.statement}</p>
                                <p className="mt-3 text-xs text-neutral-500">
                                    <span className="font-semibold text-neutral-400">Why it matters:</span> {assumption.whyItMatters}
                                </p>
                                {!assumptionAccepted ? (
                                    <>
                                        <div className="mt-4 rounded-xl border border-indigo-500/30 bg-indigo-500/[0.07] px-3.5 py-2.5">
                                            <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-300">Next action</p>
                                            <p className="mt-0.5 text-sm font-medium text-indigo-100">{assumption.nextAction}</p>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setAssumptionAccepted(true)}
                                                className="rounded-xl border border-neutral-600 bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-neutral-100 transition hover:border-indigo-500/50"
                                            >
                                                Yes, that's right
                                            </button>
                                            <span className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-700 px-4 py-2.5 text-sm font-medium text-neutral-400">
                                                <Clock3 size={14} /> Defer
                                            </span>
                                        </div>
                                    </>
                                ) : (
                                    <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-2.5">
                                        <p className="text-sm font-semibold text-amber-200">Accepted for planning · not validated</p>
                                        <p className="mt-0.5 text-xs leading-5 text-amber-100/70">{assumption.acceptedNote}</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {selectedId === resolved.id && (
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">{resolved.conditionLabel}</p>
                                <h3 className="mt-1 text-lg font-semibold leading-snug text-white">{resolved.title}</h3>
                                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] px-3.5 py-2.5">
                                    <p className="text-sm font-semibold text-emerald-300">Selected answer</p>
                                    <p className="mt-0.5 text-sm text-neutral-200">{resolved.resolution}</p>
                                    <p className="mt-1 text-xs text-neutral-400">Reason: {resolved.rationale}</p>
                                </div>
                                <div className="mt-4">
                                    <p className="flex items-center gap-1.5 text-xs font-semibold text-neutral-400">
                                        <ChevronDown size={13} /> Source and history
                                    </p>
                                    <p className="mt-1.5 text-[11px] text-neutral-500">Source: {resolved.source}</p>
                                    <ol className="mt-2 space-y-2 border-l border-neutral-700 pl-3">
                                        {resolved.history.map((item) => (
                                            <li key={item.label}>
                                                <p className="text-xs font-medium text-neutral-300">{item.label}</p>
                                                <p className="text-[11px] text-neutral-500">{item.when}</p>
                                            </li>
                                        ))}
                                    </ol>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Callout */}
            <div className="mt-5 flex items-start gap-4 rounded-2xl border border-neutral-700 bg-neutral-800/40 p-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-300">
                    <ShieldCheck size={20} />
                </span>
                <div>
                    <p className="text-base font-semibold text-white">You decide. Synapse drafts the consequences.</p>
                    <p className="mt-1 text-sm text-neutral-400">
                        Every verdict is recorded with its rationale, previewed against the plan, and applied explicitly —
                        the model never decides for you.
                    </p>
                </div>
            </div>
        </ScreenShell>
    );
}
