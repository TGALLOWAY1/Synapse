import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { PreflightQuestion } from '../../types';

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
});

const setup = () => {
    const store = useProjectStore.getState();
    const { projectId, spineId } = store.createProject('Test', 'A songwriting app');
    return { projectId, spineId };
};

const session = (projectId: string) =>
    useProjectStore.getState().getLatestSpine(projectId)?.preflightSession;

describe('preflight session store actions', () => {
    it('round-trips init → questions → answer(skip) → summary → complete', () => {
        const { projectId, spineId } = setup();
        const store = useProjectStore.getState();

        store.initPreflightSession(projectId, spineId, 'quick', 'A songwriting app');
        expect(session(projectId)).toMatchObject({
            mode: 'quick',
            status: 'awaiting_questions',
            completed: false,
            currentQuestionIndex: 0,
        });

        const questions: PreflightQuestion[] = [
            { id: 'q1', question: 'Who is the user?' },
            { id: 'q2', question: 'Monetization?' },
        ];
        store.setPreflightQuestions(projectId, spineId, questions, false);
        expect(session(projectId)?.status).toBe('answering');
        expect(session(projectId)?.questions).toHaveLength(2);

        store.setPreflightAnswer(projectId, spineId, 'q1', 'Musicians', false);
        store.setPreflightAnswer(projectId, spineId, 'q2', '', true);
        const qs = session(projectId)!.questions;
        expect(qs.find((q) => q.id === 'q1')?.answer).toBe('Musicians');
        expect(qs.find((q) => q.id === 'q2')?.skipped).toBe(true);

        store.setPreflightSummary(projectId, spineId, {
            summary: '- Users are musicians.',
            assumptions: ['Mobile-first'],
            unknowns: ['Monetization undecided'],
        });
        expect(session(projectId)).toMatchObject({
            status: 'summary',
            summary: '- Users are musicians.',
        });
        expect(session(projectId)?.unknowns).toContain('Monetization undecided');

        store.completePreflightSession(projectId, spineId);
        expect(session(projectId)).toMatchObject({ completed: true, status: 'completed' });
    });

    it('re-enters answering when editing from the summary', () => {
        const { projectId, spineId } = setup();
        const store = useProjectStore.getState();
        store.initPreflightSession(projectId, spineId, 'quick', 'idea');
        store.setPreflightQuestions(projectId, spineId, [
            { id: 'q1', question: 'Q1' },
            { id: 'q2', question: 'Q2' },
        ]);
        store.setPreflightSummary(projectId, spineId, { summary: 's', assumptions: [], unknowns: [] });
        expect(session(projectId)?.status).toBe('summary');

        store.setPreflightIndex(projectId, spineId, 0);
        expect(session(projectId)?.status).toBe('answering');
        expect(session(projectId)?.currentQuestionIndex).toBe(0);
    });

    it('persists the session on the spine (survives serialization)', () => {
        const { projectId, spineId } = setup();
        useProjectStore.getState().initPreflightSession(projectId, spineId, 'deep', 'idea');
        const serialized = JSON.stringify(useProjectStore.getState().spineVersions);
        const restored = JSON.parse(serialized);
        expect(restored[projectId][0].preflightSession.mode).toBe('deep');
    });
});
