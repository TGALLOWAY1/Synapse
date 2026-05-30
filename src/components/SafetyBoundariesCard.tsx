import { ShieldCheck } from 'lucide-react';
import type { SpineSafetyReview } from '../types';

/**
 * Shown above a normally-generated PRD when the request was classified
 * `allowed_with_restrictions`. Explains that generation was constrained to
 * safe, authorized, transparent use — the visible counterpart to the
 * restriction directive injected into the generation prompt.
 */
export function SafetyBoundariesCard({ review }: { review: SpineSafetyReview }) {
    return (
        <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50/70 p-4">
            <div className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5 w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center">
                    <ShieldCheck size={16} className="text-sky-600" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sky-900 text-sm">Safety Boundaries</p>
                    <p className="text-sm text-sky-800 mt-1 leading-relaxed">
                        {review.userFacingReason ||
                            'This product touches sensitive territory, so generation was constrained to ' +
                            'authorized, transparent, consent-based, defensive, and educational use.'}
                    </p>
                    <p className="text-xs text-sky-700/90 mt-2">
                        Intentionally excluded: credential harvesting, covert or silent collection,
                        evasion/anti-detection, persistence mechanisms, and any real-world abuse instructions.
                    </p>
                    {review.detectedConcerns.length > 0 && (
                        <ul className="mt-3 flex flex-wrap gap-2">
                            {review.detectedConcerns.map((concern, i) => (
                                <li
                                    key={i}
                                    className="text-xs px-2 py-1 rounded-md bg-sky-100 text-sky-800 border border-sky-200"
                                >
                                    {concern}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
