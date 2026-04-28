// Run async tasks with a concurrency limit. Returns settled results in
// the original order so callers can detect per-task failure vs. cancel.
export async function withConcurrency<T>(
    tasks: (() => Promise<T>)[],
    limit: number,
): Promise<PromiseSettledResult<T>[]> {
    const results: PromiseSettledResult<T>[] = new Array(tasks.length);
    let nextIndex = 0;

    async function runNext(): Promise<void> {
        while (nextIndex < tasks.length) {
            const index = nextIndex++;
            try {
                const value = await tasks[index]();
                results[index] = { status: 'fulfilled', value };
            } catch (reason) {
                results[index] = { status: 'rejected', reason };
            }
        }
    }

    const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => runNext());
    await Promise.all(workers);
    return results;
}

export function isAbortError(reason: unknown): boolean {
    return reason instanceof DOMException && reason.name === 'AbortError';
}
