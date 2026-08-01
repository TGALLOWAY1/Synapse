import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskChecklist } from '../tasks/TaskChecklist';
import { useProjectStore } from '../../store/projectStore';
import type { ProjectTask, TaskStatus } from '../../types';

// Plan §W8 — honest task-progress semantics on the ONE surface where the user
// ticks a checkbox. The states read planned → started → implemented
// (self-reported), and the surface says once that Synapse does not verify
// execution. Nothing about the PERSISTED vocabulary changed, so legacy stored
// values must keep rendering.

const ARTIFACT_ID = 'artifact-plan';

const task = (id: string, status: TaskStatus | string, over: Partial<ProjectTask> = {}): ProjectTask => ({
    id,
    projectId: 'p1',
    sourceArtifactId: ARTIFACT_ID,
    title: `Task ${id}`,
    summary: `Summary for ${id}`,
    acceptanceCriteria: [`${id} works`],
    // Cast: the point of several of these tests is a stored value this build's
    // union does not cover.
    status: status as TaskStatus,
    createdAt: 1,
    updatedAt: 1,
    ...over,
});

const seed = (tasks: ProjectTask[]) => {
    useProjectStore.setState({
        projects: { p1: { id: 'p1', name: 'Test', createdAt: 1 } },
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        tasks: { p1: tasks },
    });
};

const renderChecklist = (props: { readOnly?: boolean } = {}) =>
    render(<TaskChecklist projectId="p1" sourceArtifactId={ARTIFACT_ID} {...props} />);

beforeEach(() => {
    localStorage.clear();
    seed([]);
});

describe('TaskChecklist — self-reported progress labelling', () => {
    it('names each state planned / started / implemented (self-reported)', () => {
        seed([task('a', 'todo'), task('b', 'in_progress'), task('c', 'done')]);
        renderChecklist();

        expect(screen.getByRole('button', { name: 'Planned — click to mark it started' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Started — click to mark it implemented' })).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Implemented (self-reported) — click to reset it to planned' }),
        ).toBeInTheDocument();
    });

    it('counts implemented tasks as "marked implemented", never as done', () => {
        seed([task('a', 'done'), task('b', 'in_progress'), task('c', 'todo')]);
        renderChecklist();

        expect(screen.getByText(/1 of 3 marked implemented/)).toBeInTheDocument();
        expect(screen.getByText(/1 started/)).toBeInTheDocument();
        expect(screen.queryByText(/of 3 done/)).not.toBeInTheDocument();
        expect(screen.queryByText(/in progress/i)).not.toBeInTheDocument();
    });

    it('states once, near the checkboxes, that Synapse does not verify execution', () => {
        seed([task('a', 'done'), task('b', 'done'), task('c', 'todo')]);
        renderChecklist();

        const notes = screen.getAllByText(/Progress is self-reported/);
        expect(notes).toHaveLength(1);
        expect(notes[0]).toHaveTextContent(/never runs or verifies your build/);
    });

    it('labels the progress bar as self-reported', () => {
        seed([task('a', 'done'), task('b', 'todo')]);
        renderChecklist();

        const bar = screen.getByRole('progressbar', { name: /self-reported/i });
        expect(bar).toHaveAttribute('aria-valuenow', '50');
    });

    it('keeps the honest state name in the read-only (demo) label', () => {
        seed([task('a', 'done')]);
        renderChecklist({ readOnly: true });

        const toggle = screen.getByRole('button', { name: 'Implemented (self-reported) (read-only)' });
        expect(toggle).toBeDisabled();
    });

    it('advances planned → started → implemented on click', () => {
        seed([task('a', 'todo')]);
        renderChecklist();

        fireEvent.click(screen.getByRole('button', { name: /^Planned —/ }));
        expect(useProjectStore.getState().getTasks('p1')[0].status).toBe('in_progress');

        fireEvent.click(screen.getByRole('button', { name: /^Started —/ }));
        expect(useProjectStore.getState().getTasks('p1')[0].status).toBe('done');
    });

    it('writes no new persisted vocabulary — the stored values are unchanged', () => {
        seed([task('a', 'todo')]);
        renderChecklist();

        fireEvent.click(screen.getByRole('button', { name: /^Planned —/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Started —/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Implemented \(self-reported\) —/ }));

        // Full cycle returns to the original stored value.
        expect(useProjectStore.getState().getTasks('p1')[0].status).toBe('todo');
    });
});

describe('TaskChecklist — legacy stored values still render', () => {
    it('renders the import-only legacy `blocked` status without claiming progress', () => {
        seed([task('a', 'blocked'), task('b', 'done')]);
        renderChecklist();

        expect(screen.getByRole('button', { name: 'Blocked — click to reset it to planned' })).toBeInTheDocument();
        // Blocked counts as neither implemented nor started.
        expect(screen.getByText(/1 of 2 marked implemented/)).toBeInTheDocument();
        expect(screen.queryByText(/started/)).not.toBeInTheDocument();
    });

    it('renders a status this build does not recognize as planned', () => {
        seed([task('a', 'archived'), task('b', 'todo')]);
        renderChecklist();

        expect(screen.getAllByRole('button', { name: /^Planned —/ })).toHaveLength(2);
        expect(screen.getByText(/0 of 2 marked implemented/)).toBeInTheDocument();
        expect(screen.getByText('Task a')).toBeInTheDocument();
    });
});
