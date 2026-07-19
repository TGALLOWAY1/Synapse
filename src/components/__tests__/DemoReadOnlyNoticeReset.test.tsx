import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoReadOnlyNotice } from '../DemoReadOnlyNotice';

// The notice drives the reset through the single-flight wrapper, not the
// store directly — mock that seam so this test stays focused on the
// component's confirm → resetting → settle state machine.
vi.mock('../../lib/demoRouteHydration', () => ({
    resetDemoProjectSingleFlight: vi.fn(),
}));

import { resetDemoProjectSingleFlight } from '../../lib/demoRouteHydration';

const mockedReset = vi.mocked(resetDemoProjectSingleFlight);

beforeEach(() => {
    mockedReset.mockReset();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// The reset affordance lives behind the collapsible "Details" toggle, which
// is collapsed on initial render — expand it before exercising the flow.
function renderExpanded() {
    render(<DemoReadOnlyNotice />);
    fireEvent.click(screen.getByRole('button', { name: /Details/ }));
}

describe('DemoReadOnlyNotice — reset demo', () => {
    it('confirms, shows a resetting state, then returns to idle on success', async () => {
        let resolveReset: (value: { available: boolean }) => void = () => {};
        mockedReset.mockReturnValue(
            new Promise((resolve) => {
                resolveReset = resolve;
            }),
        );

        renderExpanded();

        fireEvent.click(screen.getByRole('button', { name: /reset demo/i }));
        expect(screen.getByText('Reset the example to its original state?')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
        expect(await screen.findByText('Resetting…')).toBeInTheDocument();
        expect(mockedReset).toHaveBeenCalledTimes(1);

        resolveReset({ available: true });

        await waitFor(() => expect(screen.getByRole('button', { name: /reset demo/i })).toBeEnabled());
        expect(screen.queryByText('Resetting…')).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('cancel dismisses the confirm without resetting', () => {
        renderExpanded();

        fireEvent.click(screen.getByRole('button', { name: /reset demo/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByText('Reset the example to its original state?')).not.toBeInTheDocument();
        expect(mockedReset).not.toHaveBeenCalled();
    });

    it('shows an inline error and re-enables the button on failure', async () => {
        mockedReset.mockRejectedValue(new Error('network down'));

        renderExpanded();
        fireEvent.click(screen.getByRole('button', { name: /reset demo/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('network down');
        expect(screen.getByRole('button', { name: /reset demo/i })).toBeEnabled();
    });

    it('shows an inline error when the reset resolves but the demo is unavailable', async () => {
        mockedReset.mockResolvedValue({ available: false });

        renderExpanded();
        fireEvent.click(screen.getByRole('button', { name: /reset demo/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('could not be reset');
        expect(screen.getByRole('button', { name: /reset demo/i })).toBeEnabled();
    });
});
