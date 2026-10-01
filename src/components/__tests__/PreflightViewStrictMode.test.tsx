import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '../../store/projectStore';
import { PreflightView } from '../preflight/PreflightView';
import { generatePreflightQuestions } from '../../lib/llmProvider';
import type { PreflightQuestion } from '../../types';

// The view's only LLM dependency is mocked so the test controls exactly when
// the question request settles; runPrdGeneration is never reached here.
vi.mock('../../lib/llmProvider', () => ({
    generatePreflightQuestions: vi.fn(),
    generatePreflightSummary: vi.fn(),
    toPreflightContext: vi.fn(),
}));
vi.mock('../../lib/runPrdGeneration', () => ({ runPrdGeneration: vi.fn() }));

const QUESTIONS: PreflightQuestion[] = [
    { id: 'q1', question: 'Who reaches for this app first?', intent: 'Pins down the primary user.' },
    { id: 'q2', question: 'What must the first release prove?' },
];

type QuestionsResult = { questions: PreflightQuestion[]; usedFallback: boolean };

const realSetPreflightQuestions = useProjectStore.getState().setPreflightQuestions;
let setQuestionsSpy: ReturnType<typeof vi.fn<typeof realSetPreflightQuestions>>;
let resolveQuestions: (result: QuestionsResult) => void;
let projectId = '';
let spineId = '';

// Mirrors the workspace host: the session prop is read from the store, so the
// view re-renders once the questions land.
function Host() {
    const session = useProjectStore(state =>
        state.spineVersions[projectId]?.find(spine => spine.id === spineId)?.preflightSession);
    if (!session) return null;
    return <PreflightView projectId={projectId} spineId={spineId} session={session} />;
}

const storedSession = () =>
    useProjectStore.getState().spineVersions[projectId]?.find(spine => spine.id === spineId)?.preflightSession;

beforeEach(() => {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
    });
    localStorage.clear();
    setQuestionsSpy = vi.fn(realSetPreflightQuestions);
    useProjectStore.setState({ setPreflightQuestions: setQuestionsSpy });
    const store = useProjectStore.getState();
    ({ projectId, spineId } = store.createProject('Preflight test', 'A habit tracker for busy parents'));
    store.initPreflightSession(projectId, spineId, 'quick', 'A habit tracker for busy parents');
    vi.mocked(generatePreflightQuestions).mockReset();
    vi.mocked(generatePreflightQuestions).mockImplementation(() => new Promise<QuestionsResult>(resolve => {
        resolveQuestions = resolve;
    }));
});

describe('PreflightView question generation', () => {
    it('stores the questions exactly once under React StrictMode (dev double-invoked effects)', async () => {
        render(
            <StrictMode>
                <Host />
            </StrictMode>,
        );
        expect(screen.getByText('Preparing your clarification questions…')).toBeInTheDocument();
        expect(generatePreflightQuestions).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveQuestions({ questions: QUESTIONS, usedFallback: false });
        });

        expect(await screen.findByText(QUESTIONS[0].question)).toBeInTheDocument();
        expect(screen.queryByText('Preparing your clarification questions…')).toBeNull();
        expect(generatePreflightQuestions).toHaveBeenCalledTimes(1);
        expect(setQuestionsSpy).toHaveBeenCalledTimes(1);
        expect(storedSession()).toMatchObject({ status: 'answering', questions: QUESTIONS });
    });

    it('lets a remount reuse the in-flight request instead of paying for a second one', async () => {
        const first = render(<Host />);
        expect(generatePreflightQuestions).toHaveBeenCalledTimes(1);
        // Navigate away and back while the request is still pending.
        first.unmount();
        render(<Host />);
        expect(generatePreflightQuestions).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveQuestions({ questions: QUESTIONS, usedFallback: false });
        });

        expect(await screen.findByText(QUESTIONS[0].question)).toBeInTheDocument();
        expect(setQuestionsSpy).toHaveBeenCalledTimes(1);
        expect(storedSession()?.status).toBe('answering');
    });
});
