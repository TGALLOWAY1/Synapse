import type { SectionId } from '../../lib/schemas/prdSchemas';

/**
 * - `pending`     — waiting on dependencies (an upstream section isn't done)
 * - `queued`      — dependencies satisfied, waiting for a free concurrency slot
 * - `in_progress` — model call running
 * - `completed` / `failed` — settled
 */
export type GenerationStepStatus = 'pending' | 'queued' | 'in_progress' | 'completed' | 'failed';

/**
 * One node in the PRD generation timeline. A node is either a leaf section or a
 * synthetic concurrent group (`executionMode: 'concurrent'`) whose `children`
 * are the parallel leaf sections. Times are in seconds; `actualSeconds` is the
 * measured wall-clock duration, `elapsedSeconds` is the live counter while a
 * step runs.
 */
export type GenerationStep = {
    /** Stable id — the SectionId for leaves, or a synthetic id for groups. */
    id: string;
    /** Display label e.g. "1", "2", "2A". */
    label: string;
    title: string;
    description: string;
    status: GenerationStepStatus;
    modelName: string;
    estimatedSeconds?: number;
    elapsedSeconds?: number;
    actualSeconds?: number;
    startedAt?: number;
    errorMessage?: string;
    canRetry?: boolean;
    children?: GenerationStep[];
    executionMode?: 'sequential' | 'concurrent';
    /** Present on leaf rows that map to a real pipeline section (retry target). */
    sectionId?: SectionId;
    /** Titles of the sections this step waits on (shown while pending). */
    dependsOn?: string[];
    /** Number of manual retries applied to this section (badge when > 0). */
    retryCount?: number;
};
