import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, RefreshCcw, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import type { SpineSafetyReview } from '../types';

interface SafetyReviewViewProps {
    review: SpineSafetyReview;
    /** Scroll to / focus the prompt so the user can revise and regenerate. */
    onRevise?: () => void;
    canRevise?: boolean;
}

/**
 * Dedicated blocked-state screen shown instead of the PRD when a request was
 * classified `disallowed`. Communicates the block clearly without looking
 * broken, and offers only safe next actions — never a path to generate
 * workspace artifacts, screens, or implementation plans from the blocked PRD.
 */
export function SafetyReviewView({ review, onRevise, canRevise }: SafetyReviewViewProps) {
    const navigate = useNavigate();
    const [showDetails, setShowDetails] = useState(false);

    return (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-6 md:p-8">
            <div className="flex items-start gap-4">
                <div className="shrink-0 mt-0.5 w-11 h-11 rounded-full bg-amber-100 flex items-center justify-center">
                    <ShieldAlert size={22} className="text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h2 className="text-xl font-bold text-amber-900">Request Cannot Be Fulfilled</h2>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 font-medium whitespace-nowrap">
                            Blocked · Disallowed Request
                        </span>
                    </div>
                    <p className="text-sm text-amber-800 leading-relaxed">
                        Synapse identified that this request falls into a restricted category.
                        <span className="block mt-1 font-medium">No project artifacts were generated.</span>
                    </p>

                    {review.userFacingReason && (
                        <p className="text-sm text-amber-900/90 mt-4 p-3 rounded-lg bg-amber-100/70 border border-amber-200 whitespace-pre-wrap">
                            {review.userFacingReason}
                        </p>
                    )}

                    {review.safeAlternatives.length > 0 && (
                        <div className="mt-5">
                            <h3 className="text-sm font-semibold text-amber-900 mb-2">
                                Safe alternatives
                            </h3>
                            <p className="text-sm text-amber-800 mb-2">
                                If your goal is legitimate security research, compliance testing, employee
                                training, or defensive monitoring, reframe the project around authorized and
                                transparent use:
                            </p>
                            <ul className="space-y-1.5">
                                {review.safeAlternatives.map((alt, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-amber-900">
                                        <span className="text-amber-500 mt-0.5">•</span>
                                        <span>{alt}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 mt-6">
                        {canRevise && (
                            <button
                                onClick={onRevise}
                                className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition"
                            >
                                <RefreshCcw size={15} />
                                Revise Request
                            </button>
                        )}
                        <button
                            onClick={() => navigate('/')}
                            className="flex items-center gap-1.5 px-4 py-2 bg-white text-amber-800 text-sm font-medium rounded-lg border border-amber-300 hover:bg-amber-100 transition"
                        >
                            <Plus size={15} />
                            Start New Project
                        </button>
                    </div>

                    {review.detectedConcerns.length > 0 && (
                        <div className="mt-5 pt-4 border-t border-amber-200/70">
                            <button
                                onClick={() => setShowDetails(v => !v)}
                                className="flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-900 select-none"
                            >
                                {showDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                View Safety Details
                            </button>
                            {showDetails && (
                                <ul className="mt-2 flex flex-wrap gap-2">
                                    {review.detectedConcerns.map((concern, i) => (
                                        <li
                                            key={i}
                                            className="text-xs px-2 py-1 rounded-md bg-amber-100 text-amber-800 border border-amber-200"
                                        >
                                            {concern}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
