import type { QualityGateRunStatus } from '../../../lib/services/implementationPlanInsights';

// Own module (not a component file) — the react-refresh/only-export-components
// rule forbids constant exports from component files.
//
// Honest-status rule: a gate is `not_run` until the user records an outcome.
// Green styling is reserved for `passed` — never show a green check for a
// gate that hasn't been verified.
export const GATE_STATUS_LABELS: Record<QualityGateRunStatus, string> = {
    not_run: 'Not run',
    passed: 'Passed',
    failed: 'Failed',
    needs_review: 'Needs review',
    blocked: 'Blocked',
};

export const GATE_STATUS_BADGE_STYLE: Record<QualityGateRunStatus, string> = {
    not_run: 'bg-neutral-100 text-neutral-600 border-neutral-300',
    passed: 'bg-emerald-50 text-emerald-700 border-emerald-300',
    failed: 'bg-red-50 text-red-700 border-red-300',
    needs_review: 'bg-amber-50 text-amber-700 border-amber-300',
    blocked: 'bg-slate-100 text-slate-700 border-slate-300',
};

export const GATE_STATUS_ORDER: QualityGateRunStatus[] = [
    'not_run', 'passed', 'failed', 'needs_review', 'blocked',
];
