import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Branch } from '../../types';

vi.mock('@formkit/auto-animate/react', () => ({ useAutoAnimate: () => [() => undefined] }));
vi.mock('../../lib/llmProvider', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/llmProvider')>()),
    replyInBranch: vi.fn(),
}));

import { BranchList } from '../BranchList';
import { replyInBranch } from '../../lib/llmProvider';
import { useProjectStore } from '../../store/projectStore';
import { useToastStore } from '../../store/toastStore';

const replyMock = vi.mocked(replyInBranch);
const projectId = 'p-branch';
const spineId = 'spine-1';

function seedBranch(overrides: Partial<Branch> = {}): Branch {
    const branch: Branch = {
        id: 'b1',
        projectId,
        spineVersionId: spineId,
        anchorText: 'Users can export reports',
        status: 'active',
        createdAt: 1,
        messages: [
            { id: 'm1', role: 'user', content: 'Clarify: what formats?', createdAt: 1 },
            { id: 'm2', role: 'assistant', content: 'CSV and PDF.', createdAt: 2 },
        ],
        ...overrides,
    };
    useProjectStore.setState({
        projects: { [projectId]: { id: projectId, name: 'P', createdAt: 1 } },
        branches: { [projectId]: [branch] },
    });
    return branch;
}

const storedBranch = () => useProjectStore.getState().branches[projectId]?.[0];
const renderList = () => render(
    <BranchList projectId={projectId} spineVersionId={spineId} onConsolidate={vi.fn()} />,
);

beforeEach(() => {
    replyMock.mockReset();
    useToastStore.setState({ toasts: [] });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('BranchList — a reply in flight survives a reload as an "interrupted" note', () => {
    it('shows the note and restores the message on mount, without re-sending', () => {
        seedBranch({
            messages: [
                { id: 'm1', role: 'user', content: 'Clarify: what formats?', createdAt: 1 },
                { id: 'm2', role: 'assistant', content: 'CSV and PDF.', createdAt: 2 },
                { id: 'm3', role: 'user', content: 'Add XLSX too', createdAt: 3 },
            ],
            pendingReply: { startedAt: 3, message: 'Add XLSX too' },
        });

        renderList();

        expect(screen.getByText(/Reply was interrupted — send again/)).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Reply...')).toHaveValue('Add XLSX too');
        expect(replyMock).not.toHaveBeenCalled();
    });

    it('sends again on request — answering the unanswered message instead of duplicating it', async () => {
        seedBranch({
            messages: [
                { id: 'm1', role: 'user', content: 'Clarify: what formats?', createdAt: 1 },
                { id: 'm2', role: 'assistant', content: 'CSV and PDF.', createdAt: 2 },
                { id: 'm3', role: 'user', content: 'Add XLSX too', createdAt: 3 },
            ],
            pendingReply: { startedAt: 3, message: 'Add XLSX too' },
        });
        replyMock.mockResolvedValue('Added XLSX.');

        renderList();
        fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

        await waitFor(() => expect(storedBranch()?.messages.at(-1)?.content).toBe('Added XLSX.'));
        const call = replyMock.mock.calls[0]?.[0];
        expect(call?.intent).toBe('Add XLSX too');
        expect(call?.threadHistory.map((m) => m.content)).toEqual(['Clarify: what formats?', 'CSV and PDF.']);
        expect(storedBranch()?.messages.filter((m) => m.content === 'Add XLSX too')).toHaveLength(1);
        expect(storedBranch()?.pendingReply).toBeUndefined();
        expect(screen.queryByText(/Reply was interrupted/)).toBeNull();
    });
});

describe('BranchList — the pending-reply marker is cleared on the normal paths', () => {
    it('marks the reply pending while in flight and clears it when the reply lands', async () => {
        seedBranch();
        let resolveReply!: (text: string) => void;
        replyMock.mockImplementation(() => new Promise<string>((resolve) => { resolveReply = resolve; }));

        renderList();
        fireEvent.change(screen.getByPlaceholderText('Reply...'), { target: { value: 'And JSON?' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

        await waitFor(() => expect(storedBranch()?.pendingReply?.message).toBe('And JSON?'));
        // Live in this page load → typing, not "interrupted".
        expect(screen.getByText('Assistant is typing...')).toBeInTheDocument();
        expect(screen.queryByText(/Reply was interrupted/)).toBeNull();

        resolveReply('JSON too.');
        await waitFor(() => expect(storedBranch()?.pendingReply).toBeUndefined());
        expect(storedBranch()?.messages.map((m) => m.content)).toEqual([
            'Clarify: what formats?', 'CSV and PDF.', 'And JSON?', 'JSON too.',
        ]);
    });

    it('clears the marker when the reply fails (and reports the failure)', async () => {
        seedBranch();
        replyMock.mockRejectedValue(new Error('Gemini API Error: 400 - bad request'));

        renderList();
        fireEvent.change(screen.getByPlaceholderText('Reply...'), { target: { value: 'And JSON?' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

        await waitFor(() => expect(useToastStore.getState().toasts.map((t) => t.title)).toContain('Reply failed'));
        expect(storedBranch()?.pendingReply).toBeUndefined();
        expect(screen.queryByText(/Reply was interrupted/)).toBeNull();
    });
});
