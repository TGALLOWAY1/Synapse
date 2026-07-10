import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { GenerationProgress } from '../GenerationProgress';
import { getArtifactStages } from '../generationStages';

// Regression test for the "Queued — will start as a slot frees up" card that
// simultaneously showed a marching progress bar and a late stage label
// ("Documenting decision points…"). The card fell into GenerationProgress's
// timer-driven fallback (no real `history` while a slot is merely queued), so
// it fabricated stage rotation + bar fill for work that had NOT started. The
// `waiting` prop makes a queued slot render an honest not-started state.

const USER_FLOWS_STAGES = getArtifactStages('user_flows');
const FIRST_STAGE = USER_FLOWS_STAGES[0].label; // "Mapping user journeys..."
const LAST_STAGE = USER_FLOWS_STAGES[USER_FLOWS_STAGES.length - 1].label; // "Documenting decision points..."
const QUEUED_SUBTITLE = 'Queued — will start as a generation slot frees up';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('GenerationProgress — a queued/waiting slot never fakes progress', () => {
    // Control: proves the same props WITHOUT `waiting` fabricate progress, so
    // the `waiting` assertions below aren't passing vacuously. The fabrication
    // is present at mount (before any real work), which is exactly the lie the
    // fix removes — a queued slot has done nothing yet.
    it('WITHOUT `waiting`, progress is already fabricated at mount (the old behavior)', () => {
        vi.useFakeTimers();
        const { queryByText, container } = render(
            <GenerationProgress
                stages={USER_FLOWS_STAGES}
                title="Queued: User Flows"
                subtitle={QUEUED_SUBTITLE}
            />,
        );

        // At mount, before any timer fires and before any work happens: a work
        // stage label is shown, a stage dot is active (`w-5`), and the bar
        // already reads > 0% — fabricated progress.
        expect(queryByText(FIRST_STAGE)).toBeInTheDocument();
        expect(container.querySelectorAll('.w-5').length).toBe(1);
        const barAtMount = container.querySelector<HTMLDivElement>('.h-full');
        expect(barAtMount).not.toBeNull();
        expect(barAtMount!.style.width).not.toBe('0%');
    });

    it('WITH `waiting`, no stage label ever shows, no dot is active, and the bar stays at 0%', async () => {
        vi.useFakeTimers();
        const { queryByText, container } = render(
            <GenerationProgress
                stages={USER_FLOWS_STAGES}
                title="Queued: User Flows"
                subtitle={QUEUED_SUBTITLE}
                waiting
            />,
        );

        // No fabricated work-stage label at mount…
        expect(queryByText(FIRST_STAGE)).not.toBeInTheDocument();
        expect(queryByText(LAST_STAGE)).not.toBeInTheDocument();

        // …and none appears once time passes: the rotation timer is disabled.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(20000);
        });
        expect(queryByText(FIRST_STAGE)).not.toBeInTheDocument();
        expect(queryByText(LAST_STAGE)).not.toBeInTheDocument();

        // The honest queued message is still shown.
        expect(queryByText(QUEUED_SUBTITLE)).toBeInTheDocument();

        // Every stage dot is inert — none is marked active (`w-5`) or complete (`w-3`).
        expect(container.querySelectorAll('.w-5').length).toBe(0);
        expect(container.querySelectorAll('.w-3').length).toBe(0);

        // The progress bar reflects zero real progress.
        const bar = container.querySelector<HTMLDivElement>('.h-full');
        expect(bar).not.toBeNull();
        expect(bar!.style.width).toBe('0%');
    });
});
