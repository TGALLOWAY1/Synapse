import { useEffect, useRef, useState } from 'react';
import { Loader2, ChevronLeft, ChevronRight, SkipForward, Sparkles, Info, Pencil } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import {
    generatePreflightQuestions,
    generatePreflightSummary,
    type PreflightContext,
} from '../../lib/llmProvider';
import { runPrdGeneration } from '../../lib/runPrdGeneration';
import {
    SafetyBlockedError,
    buildBlockedSafetyReview,
    buildSafetyReviewMarkdown,
} from '../../lib/safety';
import type { PreflightSession, ProjectPlatform } from '../../types';

interface PreflightViewProps {
    projectId: string;
    spineId: string;
    session: PreflightSession;
    platform?: ProjectPlatform;
}

/** Build the PRD-generation context from a (completed) clarification session. */
const toPreflightContext = (session: PreflightSession): PreflightContext => ({
    mode: session.mode,
    clarificationResponses: session.questions.map((q) => {
        const skipped = !!q.skipped || !q.answer || !q.answer.trim();
        return {
            question: q.question,
            answer: skipped ? null : q.answer!.trim(),
            skipped,
            intent: q.intent,
        };
    }),
    summary: session.summary,
    assumptions: session.assumptions,
    unknowns: session.unknowns,
});

/**
 * Optional preflight clarification flow, hosted in the workspace. Generates
 * idea-specific questions, collects answers one at a time, shows a summary, and
 * hands off to PRD generation. Mobile-first: one question per card, large tap
 * targets, a pinned bottom action bar with safe-area insets.
 */
export function PreflightView({ projectId, spineId, session, platform }: PreflightViewProps) {
    const {
        setPreflightQuestions,
        setPreflightAnswer,
        setPreflightIndex,
        setPreflightSummary,
        completePreflightSession,
        setSpineSafetyReview,
    } = useProjectStore();

    const [isWorking, setIsWorking] = useState(false);
    const generationStarted = useRef(false);

    const mode = session.mode === 'deep' ? 'deep' : 'quick';
    const total = session.questions.length;

    // Generate questions once when the session is first opened.
    useEffect(() => {
        if (session.status !== 'awaiting_questions' || generationStarted.current) return;
        generationStarted.current = true;
        let cancelled = false;
        (async () => {
            try {
                const { questions, usedFallback } = await generatePreflightQuestions(
                    session.originalIdea,
                    mode,
                );
                if (cancelled) return;
                setPreflightQuestions(projectId, spineId, questions, usedFallback);
            } catch (e) {
                if (cancelled) return;
                if (e instanceof SafetyBlockedError) {
                    // Disallowed idea — stop the flow and show the Safety Review.
                    setSpineSafetyReview(
                        projectId,
                        spineId,
                        buildBlockedSafetyReview(e.result),
                        buildSafetyReviewMarkdown(e.result),
                    );
                } else {
                    console.error('[preflight] unexpected question generation error', e);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [session.status, session.originalIdea, mode, projectId, spineId, setPreflightQuestions, setSpineSafetyReview]);

    // ---- Loading state: generating questions --------------------------------
    if (session.status === 'awaiting_questions' || total === 0) {
        return (
            <PreflightShell>
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Loader2 size={28} className="animate-spin text-indigo-500 mb-4" />
                    <p className="font-medium text-neutral-700">Preparing your clarification questions…</p>
                    <p className="text-sm text-neutral-500 mt-1">
                        Tailoring {mode === 'deep' ? '10' : '5'} questions to your idea.
                    </p>
                </div>
            </PreflightShell>
        );
    }

    // ---- Summary step -------------------------------------------------------
    if (session.status === 'summary') {
        return (
            <PreflightShell>
                <PreflightSummaryStep
                    session={session}
                    isWorking={isWorking}
                    onEdit={() => setPreflightIndex(projectId, spineId, 0)}
                    onGenerate={() => {
                        completePreflightSession(projectId, spineId);
                        void runPrdGeneration({
                            projectId,
                            spineId,
                            sourcePrompt: session.originalIdea,
                            platform,
                            preflight: toPreflightContext(session),
                        });
                    }}
                />
            </PreflightShell>
        );
    }

    // ---- Answering one question at a time -----------------------------------
    const index = Math.min(session.currentQuestionIndex, total - 1);
    const question = session.questions[index];
    const isLast = index === total - 1;

    const advance = () => {
        if (isLast) {
            // Move to the summary; generate it from the answers.
            setIsWorking(true);
            (async () => {
                const summary = await generatePreflightSummary(session.originalIdea, session.questions);
                setPreflightSummary(projectId, spineId, summary);
                setIsWorking(false);
            })();
        } else {
            setPreflightIndex(projectId, spineId, index + 1);
        }
    };

    const commitAndAdvance = (answer: string, skipped: boolean) => {
        setPreflightAnswer(projectId, spineId, question.id, answer, skipped);
        advance();
    };

    return (
        <PreflightShell>
            <QuestionCard
                key={question.id}
                index={index}
                total={total}
                question={question.question}
                intent={question.intent}
                initialAnswer={question.answer ?? ''}
                usedFallback={!!session.usedFallback}
                isWorking={isWorking}
                canGoBack={index > 0}
                isLast={isLast}
                onBack={(draft) => {
                    setPreflightAnswer(projectId, spineId, question.id, draft, draft.trim() === '');
                    setPreflightIndex(projectId, spineId, index - 1);
                }}
                onSkip={() => commitAndAdvance('', true)}
                onNext={(draft) => commitAndAdvance(draft, draft.trim() === '')}
            />
        </PreflightShell>
    );
}

// --- Presentational pieces ---------------------------------------------------

function PreflightShell({ children }: { children: React.ReactNode }) {
    return (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/80 p-6 md:p-10 mb-8">
            {children}
        </div>
    );
}

interface QuestionCardProps {
    index: number;
    total: number;
    question: string;
    intent?: string;
    initialAnswer: string;
    usedFallback: boolean;
    isWorking: boolean;
    canGoBack: boolean;
    isLast: boolean;
    onBack: (draft: string) => void;
    onSkip: () => void;
    onNext: (draft: string) => void;
}

function QuestionCard({
    index,
    total,
    question,
    intent,
    initialAnswer,
    usedFallback,
    isWorking,
    canGoBack,
    isLast,
    onBack,
    onSkip,
    onNext,
}: QuestionCardProps) {
    // Local draft, seeded from the stored answer. Card is keyed by question id
    // so this remounts (and reseeds) on every navigation.
    const [draft, setDraft] = useState(initialAnswer);
    const progress = Math.round(((index + 1) / total) * 100);

    return (
        <div className="flex flex-col min-h-[60vh] md:min-h-0">
            {/* Progress header */}
            <div className="mb-6">
                <div className="flex items-center justify-between text-sm mb-2">
                    <span className="font-medium text-indigo-600">
                        Question {index + 1} of {total}
                    </span>
                    <span className="text-neutral-400">{progress}%</span>
                </div>
                <div className="h-1.5 w-full bg-neutral-100 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                    />
                </div>
                {usedFallback && (
                    <p className="mt-3 text-xs text-amber-600 flex items-center gap-1.5">
                        <Info size={12} /> Using default clarification questions.
                    </p>
                )}
            </div>

            {/* Question + answer (grows to push the action bar down on mobile) */}
            <div className="flex-1">
                <h2 className="text-xl md:text-2xl font-semibold text-neutral-900 leading-snug">{question}</h2>
                {intent && <p className="mt-2 text-sm text-neutral-500">{intent}</p>}
                <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    autoFocus
                    placeholder="Type your answer… or skip this question."
                    className="mt-5 w-full min-h-[140px] rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-[15px] leading-relaxed text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 resize-none"
                />
            </div>

            {/* Action bar — pinned near the bottom with safe-area inset */}
            <div
                className="sticky bottom-0 mt-6 flex items-center gap-3 bg-white/95 backdrop-blur pt-4 border-t border-neutral-100"
                style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.25rem)' }}
            >
                <button
                    onClick={() => onBack(draft)}
                    disabled={!canGoBack || isWorking}
                    className="inline-flex items-center gap-1.5 px-4 py-3 min-h-[44px] rounded-xl text-sm font-medium text-neutral-600 hover:bg-neutral-100 transition disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <ChevronLeft size={16} /> Back
                </button>
                <button
                    onClick={onSkip}
                    disabled={isWorking}
                    className="inline-flex items-center gap-1.5 px-4 py-3 min-h-[44px] rounded-xl text-sm font-medium text-neutral-500 hover:bg-neutral-100 transition disabled:opacity-50"
                >
                    <SkipForward size={16} /> Skip
                </button>
                <div className="flex-1" />
                <button
                    onClick={() => onNext(draft)}
                    disabled={isWorking}
                    className="inline-flex items-center gap-1.5 px-6 py-3 min-h-[44px] rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition disabled:opacity-60"
                >
                    {isWorking ? (
                        <>
                            <Loader2 size={16} className="animate-spin" /> Summarizing…
                        </>
                    ) : isLast ? (
                        <>
                            Review <ChevronRight size={16} />
                        </>
                    ) : (
                        <>
                            Next <ChevronRight size={16} />
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}

interface PreflightSummaryStepProps {
    session: PreflightSession;
    isWorking: boolean;
    onEdit: () => void;
    onGenerate: () => void;
}

function PreflightSummaryStep({ session, onEdit, onGenerate }: PreflightSummaryStepProps) {
    // Render the summary as scannable bullet lines.
    const summaryLines = (session.summary ?? '')
        .split('\n')
        .map((l) => l.replace(/^[-•*]\s*/, '').trim())
        .filter(Boolean);

    return (
        <div>
            <div className="flex items-center gap-2 mb-1">
                <Sparkles size={18} className="text-indigo-500" />
                <h2 className="text-xl font-semibold text-neutral-900">Here&apos;s what I learned</h2>
            </div>
            <p className="text-sm text-neutral-500 mb-5">
                Review before generating the PRD. You can edit any answer.
            </p>

            {summaryLines.length > 0 && (
                <ul className="space-y-2 mb-6">
                    {summaryLines.map((line, i) => (
                        <li key={i} className="flex gap-2.5 text-[15px] text-neutral-700">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                            <span className="leading-relaxed">{line}</span>
                        </li>
                    ))}
                </ul>
            )}

            {session.assumptions && session.assumptions.length > 0 && (
                <SummaryGroup title="Assumptions" items={session.assumptions} tone="neutral" />
            )}
            {session.unknowns && session.unknowns.length > 0 && (
                <SummaryGroup title="Open questions" items={session.unknowns} tone="amber" />
            )}

            <div
                className="sticky bottom-0 mt-8 flex items-center gap-3 bg-white/95 backdrop-blur pt-4 border-t border-neutral-100"
                style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.25rem)' }}
            >
                <button
                    onClick={onEdit}
                    className="inline-flex items-center gap-1.5 px-4 py-3 min-h-[44px] rounded-xl text-sm font-medium text-neutral-600 hover:bg-neutral-100 transition"
                >
                    <Pencil size={15} /> Edit answers
                </button>
                <div className="flex-1" />
                <button
                    onClick={onGenerate}
                    className="inline-flex items-center gap-1.5 px-6 py-3 min-h-[44px] rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition"
                >
                    <Sparkles size={16} /> Generate PRD
                </button>
            </div>
        </div>
    );
}

function SummaryGroup({ title, items, tone }: { title: string; items: string[]; tone: 'neutral' | 'amber' }) {
    return (
        <div className="mb-5">
            <h3
                className={`text-xs font-bold uppercase tracking-wider mb-2 ${
                    tone === 'amber' ? 'text-amber-600' : 'text-neutral-400'
                }`}
            >
                {title}
            </h3>
            <ul className="space-y-1.5">
                {items.map((item, i) => (
                    <li key={i} className="text-sm text-neutral-600 leading-relaxed">
                        {item}
                    </li>
                ))}
            </ul>
        </div>
    );
}
