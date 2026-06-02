// Structured, low-noise observability for the PRD DAG pipeline. Emits one
// machine-readable record per lifecycle event (queued / started / completed /
// failed / dependency-satisfied / retry / run summary) so a generation run can
// be reconstructed from the console without scattering ad-hoc console.log
// calls through the orchestration code.
//
// Logging is OFF by default (it would flood the console for every run) and is
// enabled by either:
//   - localStorage 'synapse-prd-debug' === 'true', or
//   - a `?prddebug` query param (handy for shareable repro links).
// All access is wrapped in try/catch so this never throws in non-browser
// (test/SSR) contexts.

export type PrdLogSurface = 'mobile' | 'web';

export type PrdLogEvent =
    | 'run_started'
    | 'section_queued'
    | 'section_started'
    | 'section_completed'
    | 'section_failed'
    | 'dependency_satisfied'
    | 'retry_triggered'
    | 'consistency_review'
    | 'run_completed';

export interface PrdLogRecord {
    event: PrdLogEvent;
    sectionId?: string;
    model?: string;
    tier?: 'fast' | 'strong';
    estimatedSeconds?: number;
    actualSeconds?: number;
    retryCount?: number;
    surface?: PrdLogSurface;
    totalMs?: number;
    detail?: string;
    error?: string;
}

const isDebugEnabled = (): boolean => {
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('synapse-prd-debug') === 'true') {
            return true;
        }
        if (typeof window !== 'undefined' && window.location?.search?.includes('prddebug')) {
            return true;
        }
    } catch {
        // Non-browser context — stay silent.
    }
    return false;
};

/**
 * Emit a structured PRD-generation log record. No-op unless debug logging is
 * enabled. Uses `console.debug` so it stays out of the way of real warnings.
 */
export const logPrd = (record: PrdLogRecord): void => {
    if (!isDebugEnabled()) return;
    try {
        // Single-line, grep-friendly prefix + structured payload.
        console.debug(`[prd:${record.event}]`, { t: Date.now(), ...record });
    } catch {
        // Never let logging break generation.
    }
};

/**
 * Best-effort detection of the rendering surface for log context. Returns
 * 'mobile' below the Tailwind `md` breakpoint (767px), 'web' otherwise, and
 * undefined when there is no window (tests/SSR).
 */
export const detectSurface = (): PrdLogSurface | undefined => {
    try {
        if (typeof window === 'undefined') return undefined;
        if (typeof window.matchMedia === 'function') {
            return window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'web';
        }
        return window.innerWidth <= 767 ? 'mobile' : 'web';
    } catch {
        return undefined;
    }
};
