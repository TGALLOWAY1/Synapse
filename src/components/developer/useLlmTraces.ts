import { useEffect, useSyncExternalStore } from 'react';
import {
    subscribeTraces,
    getTracesSnapshot,
    hydrateTraces,
} from '../../lib/trace/traceRecorder';
import type { LlmTraceCall } from '../../lib/trace/traceTypes';

/**
 * Subscribe to the live in-memory trace registry (developer-only). Hydrates
 * persisted traces from IndexedDB once on mount so the viewer can inspect
 * generations from earlier sessions. The snapshot reference is stable between
 * mutations (see traceRecorder), satisfying useSyncExternalStore.
 */
export function useLlmTraces(): LlmTraceCall[] {
    useEffect(() => {
        void hydrateTraces();
    }, []);
    return useSyncExternalStore(subscribeTraces, getTracesSnapshot, getTracesSnapshot);
}
