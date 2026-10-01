import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useProjectStore } from '../../store/projectStore';
import { StructuredPRDView } from '../StructuredPRDView';
import type { SpineVersion, StructuredPRD } from '../../types';

// mark.js walks real DOM ranges — irrelevant here and flaky in jsdom.
vi.mock('mark.js', () => ({
    default: class {
        mark() {}
        unmark() {}
    },
}));

const PROJECT_ID = 'p-edit-guards';
const SPINE_ID = 'spine-edit-guards';
const LOCK_NOTICE = 'Editing unlocks when generation finishes.';

const prd: StructuredPRD = {
    vision: 'Every parent keeps one small habit going.',
    targetUsers: ['Busy parents', 'Night-shift workers'],
    coreProblem: 'Habit apps punish missed days.',
    architecture: 'Local-first.',
    risks: [],
    features: [
        { id: 'f1', name: 'Quick Capture', description: 'd', userValue: 'v', complexity: 'low', tier: 'mvp' },
    ],
};

beforeEach(() => {
    const spine: SpineVersion = {
        id: SPINE_ID,
        projectId: PROJECT_ID,
        promptText: 'idea',
        responseText: 'md',
        structuredPRD: prd,
        isLatest: true,
        isFinal: false,
        createdAt: 1,
    };
    useProjectStore.setState({
        projects: { [PROJECT_ID]: { id: PROJECT_ID, name: 'Edit guards', createdAt: 1 } },
        spineVersions: { [PROJECT_ID]: [spine] },
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        planningRecords: {},
    });
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

const versions = () => useProjectStore.getState().spineVersions[PROJECT_ID];

const view = (props: { readOnly: boolean; readOnlyNotice?: string }) => (
    <StructuredPRDView projectId={PROJECT_ID} spineId={SPINE_ID} structuredPRD={prd} {...props} />
);

describe('StructuredPRDView — edit lock while a PRD run is in flight', () => {
    it('hides every edit control and explains why while locked', () => {
        render(view({ readOnly: true, readOnlyNotice: LOCK_NOTICE }));
        expect(screen.getByRole('status')).toHaveTextContent(LOCK_NOTICE);
        expect(screen.queryByRole('button', { name: 'Edit vision' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Edit target users' })).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: /Features/ }));
        expect(screen.queryByRole('button', { name: /^Add$/ })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Delete feature' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Edit feature' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Confirm feature/ })).toBeNull();
    });

    it('shows no lock notice when editable, or when read-only for a permanent reason', () => {
        const { rerender } = render(view({ readOnly: false, readOnlyNotice: LOCK_NOTICE }));
        expect(screen.queryByText(LOCK_NOTICE)).toBeNull();
        // The same controls the locked test expects to be gone are present
        // when editable, so those absence checks cannot pass vacuously.
        expect(screen.getByRole('button', { name: 'Edit vision' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Edit target users' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: /Features/ }));
        expect(screen.getByRole('button', { name: /^Add$/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete feature' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Edit feature' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Confirm feature/ })).toBeInTheDocument();

        rerender(view({ readOnly: true }));
        expect(screen.queryByText(LOCK_NOTICE)).toBeNull();
    });

    it('writes nothing — and keeps the draft open — when the lock engages mid-edit', () => {
        const { rerender } = render(view({ readOnly: false }));
        fireEvent.click(screen.getByRole('button', { name: 'Edit vision' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A rewritten vision.' } });

        // A PRD run starts (e.g. a section retry) while the editor is open.
        rerender(view({ readOnly: true, readOnlyNotice: LOCK_NOTICE }));
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        expect(versions()).toHaveLength(1);
        expect(versions()[0].structuredPRD?.vision).toBe(prd.vision);
        expect(screen.getByRole('textbox')).toHaveValue('A rewritten vision.');
    });
});

describe('StructuredPRDView — saving a section unchanged', () => {
    it('appends no version when Save is pressed without changes', () => {
        render(view({ readOnly: false }));
        fireEvent.click(screen.getByRole('button', { name: 'Edit vision' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        expect(versions()).toHaveLength(1);
        expect(useProjectStore.getState().historyEvents[PROJECT_ID] ?? []).toHaveLength(0);
        // The editor still closes, exactly as after a real save.
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.getByRole('button', { name: 'Edit vision' })).toBeInTheDocument();
    });

    it('treats whitespace-only and identical list edits as unchanged', () => {
        render(view({ readOnly: false }));
        fireEvent.click(screen.getByRole('button', { name: 'Edit vision' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: `  ${prd.vision}\n` } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        fireEvent.click(screen.getByRole('button', { name: 'Edit target users' }));
        fireEvent.change(screen.getByPlaceholderText('One item per line'), {
            target: { value: 'Busy parents\n\n  Night-shift workers  \n' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        expect(versions()).toHaveLength(1);
    });

    it('still appends a version for a real change', () => {
        render(view({ readOnly: false }));
        fireEvent.click(screen.getByRole('button', { name: 'Edit vision' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A rewritten vision.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        expect(versions()).toHaveLength(2);
        expect(versions().find(spine => spine.isLatest)?.structuredPRD?.vision).toBe('A rewritten vision.');
    });
});
