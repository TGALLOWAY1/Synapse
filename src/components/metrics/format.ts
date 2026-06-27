// Small, pure display formatters for the Metrics dashboard. Kept separate so
// the rendering components stay declarative and these can be unit-tested.

/** Human-friendly duration from milliseconds: "320ms", "4.2s", "1m 12s". */
export function formatDuration(ms: number): string {
    if (!isFinite(ms) || ms < 0) return '—';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const totalSeconds = ms / 1000;
    if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds % 60);
    return `${minutes}m ${seconds}s`;
}

/** Speedup ratio as "2.5×". */
export function formatSpeedup(ratio: number): string {
    if (!isFinite(ratio) || ratio <= 0) return '—';
    return `${ratio.toFixed(ratio >= 10 ? 0 : 1)}×`;
}

/** Compact token count: "812", "12.3k", "1.4M". */
export function formatTokens(n: number): string {
    if (!n) return '0';
    if (n < 1000) return `${n}`;
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
    return `${(n / 1_000_000).toFixed(2)}M`;
}

/** USD cost estimate: "$0.0123", "<$0.001", "$0.00". */
export function formatCost(usd: number): string {
    if (!usd) return '$0.00';
    if (usd < 0.001) return '<$0.001';
    if (usd < 1) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
}

/** Ratio 0–1 → "92%". */
export function formatPercent(ratio: number): string {
    if (!isFinite(ratio)) return '—';
    return `${Math.round(ratio * 100)}%`;
}

/** Epoch ms → "Jun 27, 3:14 PM". */
export function formatTimestamp(ms: number): string {
    try {
        return new Date(ms).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    } catch {
        return '—';
    }
}

/** Concurrency level like "2.4×" → here just a plain number to 1 decimal. */
export function formatConcurrency(n: number): string {
    if (!isFinite(n) || n <= 0) return '—';
    return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}
