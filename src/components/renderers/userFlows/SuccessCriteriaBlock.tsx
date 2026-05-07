import { CheckCircle2, Sparkles, TestTube2 } from 'lucide-react';
import type { ParsedFlow } from './types';
import { inlineMd } from './markdown';

interface Props {
    flow: ParsedFlow;
}

const MEASURABLE_RE = /(<\s*\d|>=?\s*\d|\b\d+\s*(s|sec|seconds|m|min|minutes|h|hr|hours|ms|%)\b|\bwithin\b|\bunder\b|\bbefore\b|\bno longer\b|\bnot require[ds]?\b)/i;
const QA_RE = /(fallback|retry|timeout|denied|blocked|unauthenticated|offline|degraded|backoff|circuit\s?breaker)/i;

function splitToLines(block: string): string[] {
    return block
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => l.replace(/^[-*]\s+/, ''));
}

function extractFromSteps(flow: ParsedFlow): { qa: string[]; criteria: string[] } {
    const qa: string[] = [];
    const criteria: string[] = [];
    for (const step of flow.steps) {
        for (const e of step.errorRefs) {
            if (QA_RE.test(e) && qa.length < 4) qa.push(e);
        }
        const text = `${step.userAction ?? ''} ${step.systemBehavior ?? ''}`.trim();
        if (text && MEASURABLE_RE.test(text) && criteria.length < 4) {
            criteria.push(text);
        }
    }
    return { qa, criteria };
}

export function SuccessCriteriaBlock({ flow }: Props) {
    const lines = flow.successOutcome ? splitToLines(flow.successOutcome) : [];
    const userOutcome = lines[0] ?? flow.successOutcome;
    const remaining = lines.slice(1);

    const productCriteria: string[] = remaining.filter(l => MEASURABLE_RE.test(l));
    const engineeringChecks: string[] = remaining.filter(l => QA_RE.test(l) && !productCriteria.includes(l));

    const fromSteps = extractFromSteps(flow);
    const productAll = Array.from(new Set([...productCriteria, ...fromSteps.criteria]));
    const qaAll = Array.from(new Set([...engineeringChecks, ...fromSteps.qa]));

    if (!userOutcome && productAll.length === 0 && qaAll.length === 0) return null;

    return (
        <section className="bg-white rounded-xl border border-neutral-200 p-5 mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 flex items-center gap-1 mb-3">
                <Sparkles size={11} /> Success criteria
            </p>
            <div className="space-y-3 text-sm">
                {userOutcome && (
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                            User outcome
                        </p>
                        <div className="flex items-start gap-2 text-neutral-800">
                            <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-emerald-600" />
                            <div className="min-w-0">{inlineMd(userOutcome)}</div>
                        </div>
                    </div>
                )}
                {productAll.length > 0 && (
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                            Product success criteria
                        </p>
                        <ul className="space-y-1">
                            {productAll.map((line, i) => (
                                <li key={i} className="flex items-start gap-2 text-neutral-800">
                                    <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-emerald-600" />
                                    <div className="min-w-0">{inlineMd(line)}</div>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {qaAll.length > 0 && (
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1 flex items-center gap-1">
                            <TestTube2 size={11} /> Engineering / QA checks
                        </p>
                        <ul className="space-y-1">
                            {qaAll.map((line, i) => (
                                <li key={i} className="flex items-start gap-2 text-neutral-700">
                                    <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-amber-600" />
                                    <div className="min-w-0">{inlineMd(line)}</div>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </section>
    );
}
