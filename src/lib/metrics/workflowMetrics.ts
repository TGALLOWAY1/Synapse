// Pure, dependency-free metric math for the orchestration Metrics dashboard.
//
// Everything here is derived from per-node timings, so the same functions work
// for a PRD run (sections) or an artifact bundle (artifacts). No model calls,
// no store access — just arithmetic over intervals — which keeps them trivially
// unit-testable and is why the "did concurrency actually help?" numbers can be
// trusted.
//
// All timestamps are milliseconds. `startedAt`/`completedAt` may be either
// epoch ms or run-relative ms — every function here only uses *differences*, so
// the origin does not matter as long as a single run is internally consistent.

/** Minimal node shape the metric functions need. */
export interface MetricNode {
    nodeId: string;
    startedAt: number;
    completedAt: number;
    durationMs: number;
    dependencyIds?: string[];
}

/**
 * Hypothetical one-after-another runtime: the sum of every node's own
 * duration. This is the baseline the concurrent executor is compared against.
 */
export function sequentialEstimateMs(nodes: Pick<MetricNode, 'durationMs'>[]): number {
    return nodes.reduce((sum, n) => sum + Math.max(0, n.durationMs), 0);
}

/** Total node runtime — identical math to the sequential estimate, named for clarity at call sites. */
export const totalNodeRuntimeMs = sequentialEstimateMs;

/**
 * Wall-clock runtime of the run, derived from the node span:
 * max(completedAt) − min(startedAt). Returns 0 for an empty run.
 */
export function actualRuntimeMs(nodes: Pick<MetricNode, 'startedAt' | 'completedAt'>[]): number {
    if (nodes.length === 0) return 0;
    let min = Infinity;
    let max = -Infinity;
    for (const n of nodes) {
        if (n.startedAt < min) min = n.startedAt;
        if (n.completedAt > max) max = n.completedAt;
    }
    return Math.max(0, max - min);
}

/** Time saved by running concurrently: sequential estimate − actual runtime (never negative). */
export function parallelTimeSavedMs(sequentialMs: number, actualMs: number): number {
    return Math.max(0, sequentialMs - actualMs);
}

/**
 * Speedup ratio: sequential / actual. 1 means no benefit (or a single node);
 * 2.5 means the run finished 2.5× faster than running each node in series.
 * Guards divide-by-zero and rounds to 2 decimals.
 */
export function speedupRatio(sequentialMs: number, actualMs: number): number {
    if (actualMs <= 0) return sequentialMs > 0 ? sequentialMs : 1;
    return Math.round((sequentialMs / actualMs) * 100) / 100;
}

/**
 * Peak number of nodes running at the same instant. Sweep-line over node
 * start/end events: +1 on a start, −1 on an end, tracking the running max.
 * Ends are processed before starts at the same timestamp so two strictly
 * back-to-back nodes are not counted as overlapping.
 */
export function maxConcurrency(nodes: Pick<MetricNode, 'startedAt' | 'completedAt'>[]): number {
    if (nodes.length === 0) return 0;
    type Ev = { t: number; delta: number };
    const events: Ev[] = [];
    for (const n of nodes) {
        // Skip zero/negative-width intervals — they cannot overlap with anything.
        if (n.completedAt <= n.startedAt) {
            events.push({ t: n.startedAt, delta: 1 });
            events.push({ t: n.startedAt, delta: -1 });
            continue;
        }
        events.push({ t: n.startedAt, delta: 1 });
        events.push({ t: n.completedAt, delta: -1 });
    }
    // Sort by time; at a tie, ends (−1) before starts (+1).
    events.sort((a, b) => (a.t - b.t) || (a.delta - b.delta));
    let cur = 0;
    let peak = 0;
    for (const e of events) {
        cur += e.delta;
        if (cur > peak) peak = cur;
    }
    return peak;
}

/**
 * Average number of nodes in flight over the run: total node runtime / actual
 * runtime. Equivalent to the area under the concurrency curve divided by its
 * width. Rounded to 2 decimals.
 */
export function averageConcurrency(totalRuntimeMs: number, actualMs: number): number {
    if (actualMs <= 0) return 0;
    return Math.round((totalRuntimeMs / actualMs) * 100) / 100;
}

/**
 * Longest dependency chain through the graph, weighted by node duration. This
 * is the theoretical floor on runtime: even with infinite concurrency the run
 * cannot finish faster than its critical path.
 *
 * Computed by memoized DFS — for each node, its chain cost is its own duration
 * plus the max chain cost of its dependencies. Unknown dependency ids are
 * ignored (treated as no-ops). When no dependencies are recorded anywhere, the
 * critical path collapses to the single longest node, which is the correct
 * answer for a fully-parallel graph.
 */
export function criticalPathMs(nodes: MetricNode[]): number {
    if (nodes.length === 0) return 0;
    const byId = new Map<string, MetricNode>();
    for (const n of nodes) byId.set(n.nodeId, n);

    const memo = new Map<string, number>();
    const visiting = new Set<string>();

    const cost = (id: string): number => {
        const node = byId.get(id);
        if (!node) return 0;
        const cached = memo.get(id);
        if (cached !== undefined) return cached;
        // Cycle guard (the PRD graph is validated acyclic upstream, but stay safe).
        if (visiting.has(id)) return Math.max(0, node.durationMs);
        visiting.add(id);
        let depMax = 0;
        for (const dep of node.dependencyIds ?? []) {
            depMax = Math.max(depMax, cost(dep));
        }
        visiting.delete(id);
        const total = Math.max(0, node.durationMs) + depMax;
        memo.set(id, total);
        return total;
    };

    let longest = 0;
    for (const n of nodes) longest = Math.max(longest, cost(n.nodeId));
    return longest;
}

/** Success rate of a set of runs (0–1), counting non-error runs as successful. */
export function successRate(statuses: Array<'complete' | 'partial' | 'error'>): number {
    if (statuses.length === 0) return 0;
    const ok = statuses.filter((s) => s !== 'error').length;
    return ok / statuses.length;
}
