// Two-phase mockup completion. A mockup artifact has two independent phases:
//   1. the SPEC (screens/layout) — persisted as an ArtifactVersion, marked done
//      by the job controller as soon as it lands, and
//   2. the IMAGES — one AI render (or upload) per screen, generated
//      asynchronously and independently, which can partially fail.
//
// A mockup whose spec exists but whose images partially failed must NOT read as
// "fully complete". This pure calculator derives the visual (image) completion
// state from per-screen image results so the UI can distinguish complete vs
// partial (some failed / some awaiting) vs still-generating.
//
// Pure and store-free so it is trivially unit-testable.

export type MockupVisualStatus = 'none' | 'generating' | 'partial' | 'complete';

export interface ScreenImageState {
    screenId: string;
    /** A render (AI or upload) exists for this screen. */
    generated: boolean;
    /** The last generation attempt for this screen failed. */
    failed: boolean;
    /** A generation is currently in flight for this screen. */
    generating: boolean;
}

export interface MockupImageCompletion {
    total: number;
    generated: number;
    failed: number;
    generating: number;
    awaiting: number;
    failedScreenIds: string[];
    status: MockupVisualStatus;
    /** True only when every screen has a render. */
    visuallyComplete: boolean;
}

export function computeMockupImageCompletion(states: ScreenImageState[]): MockupImageCompletion {
    const total = states.length;
    let generated = 0;
    let failed = 0;
    let generating = 0;
    const failedScreenIds: string[] = [];

    for (const s of states) {
        if (s.generated) { generated++; continue; }
        if (s.generating) { generating++; continue; }
        if (s.failed) { failed++; failedScreenIds.push(s.screenId); continue; }
    }
    const awaiting = total - generated - failed - generating;

    let status: MockupVisualStatus;
    if (total === 0) {
        status = 'none';
    } else if (generated === total) {
        status = 'complete';
    } else if (generating > 0) {
        status = 'generating';
    } else if (generated === 0 && failed === 0) {
        // Nothing generated, nothing failed, nothing in flight → not started.
        status = 'none';
    } else {
        // Some renders and/or some failures, none in flight → partial.
        status = 'partial';
    }

    return {
        total,
        generated,
        failed,
        generating,
        awaiting,
        failedScreenIds,
        status,
        visuallyComplete: status === 'complete',
    };
}
