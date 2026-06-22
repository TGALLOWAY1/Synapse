import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useProjectStore } from '../../store/projectStore';

// Regression test for React #185 ("Maximum update depth exceeded") when the
// demo project is opened.
//
// The two components that subscribe to per-project task lists use the
// `s.tasks[projectId] ?? []` selector pattern. A literal `[]` allocates a
// fresh array each call, which makes useSyncExternalStore see a snapshot
// change on every render. React then re-runs the selector, gets another new
// array, schedules another update — an infinite loop that React aborts with
// #185 once the nested update counter overflows.
//
// The fix: a module-level stable empty array. This test guarantees both
// components survive a render when no tasks exist for the project.

beforeEach(() => {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        tasks: {},
    });
    // jsdom has no matchMedia — useIsMobile needs a stub.
    vi.stubGlobal(
        'matchMedia',
        vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    );
});

// Reproduces the bad selector pattern in isolation. With the fresh `[]`
// literal each call, useSyncExternalStore sees a snapshot change on every
// render — React aborts with #185 once the nested update counter overflows.
function BuggyTasksProbe({ projectId }: { projectId: string }) {
    const tasks = useProjectStore(s => s.tasks[projectId] ?? []);
    return <div data-testid="probe">{tasks.length}</div>;
}

// The fix: a module-level stable empty array. Same selector shape, but a
// stable reference so the snapshot only changes when tasks actually change.
const EMPTY: never[] = [];
function FixedTasksProbe({ projectId }: { projectId: string }) {
    const tasks = useProjectStore(s => s.tasks[projectId] ?? EMPTY);
    return <div data-testid="probe">{tasks.length}</div>;
}

describe('per-project task selector — React #185 regression', () => {
    it('the fresh-array selector reproduces the infinite update loop', () => {
        // Swallow React's "Maximum update depth" console.error so it doesn't
        // pollute the test output.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => render(<BuggyTasksProbe projectId="missing-project" />)).toThrow(
            /Maximum update depth/,
        );
        consoleError.mockRestore();
    });

    it('the stable-empty-array selector renders cleanly when no tasks exist', () => {
        expect(() => render(<FixedTasksProbe projectId="missing-project" />)).not.toThrow();
    });
});
