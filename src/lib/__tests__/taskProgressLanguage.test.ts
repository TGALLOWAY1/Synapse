import { describe, expect, it } from 'vitest';
import type { TaskStatus } from '../../types';
import {
    isSelfReportedImplemented,
    isSelfReportedStarted,
    taskProgressCopy,
    TASK_PROGRESS_SELF_REPORTED_NOTE,
} from '../taskProgressLanguage';

// Plan §W8: the task-progress states are relabelled
// planned → started → implemented (self-reported). This is a PRESENTATION
// change — the persisted `TaskStatus` values are untouched, so every stored
// value (including the import-only legacy `blocked`) must still map to words.

describe('taskProgressCopy — stored value → honest label', () => {
    const cases: Array<[TaskStatus, string, string]> = [
        ['todo', 'Planned', 'Planned'],
        ['in_progress', 'Started', 'Started'],
        ['done', 'Implemented', 'Implemented (self-reported)'],
        ['blocked', 'Blocked', 'Blocked'],
    ];

    it.each(cases)('maps %s to %s', (status, label, longLabel) => {
        expect(taskProgressCopy(status).label).toBe(label);
        expect(taskProgressCopy(status).longLabel).toBe(longLabel);
    });

    it('names the terminal state as self-reported, never as done/complete/verified', () => {
        const { label, longLabel } = taskProgressCopy('done');

        expect(longLabel).toMatch(/self-reported/i);
        for (const text of [label, longLabel]) {
            expect(text).not.toMatch(/\b(done|complete|completed|verified|passing)\b/i);
        }
    });

    it('states the next toggle step for every stored value', () => {
        for (const status of ['todo', 'in_progress', 'done', 'blocked'] as TaskStatus[]) {
            expect(taskProgressCopy(status).nextAction.trim().length).toBeGreaterThan(0);
        }
    });
});

describe('taskProgressCopy — legacy and unrecognized stored values', () => {
    // Persisted localStorage records are not type-checked on read (cross-cutting
    // rule 3's spirit). A value this build does not know must still render, and
    // must never be presented as implemented.
    const unknowns = ['', 'DONE', 'in-progress', 'complete', 'archived', 'null'];

    it.each(unknowns)('renders %s as Planned rather than blank', (value) => {
        expect(taskProgressCopy(value).label).toBe('Planned');
        expect(taskProgressCopy(value).longLabel).toBe('Planned');
    });

    it.each([undefined, null])('renders %s as Planned', (value) => {
        expect(taskProgressCopy(value).label).toBe('Planned');
    });

    it('never reads an unrecognized value as implemented or started', () => {
        for (const value of [...unknowns, undefined, null]) {
            expect(isSelfReportedImplemented(value)).toBe(false);
            expect(isSelfReportedStarted(value)).toBe(false);
        }
    });

    it('recognizes only the exact stored values as implemented / started', () => {
        expect(isSelfReportedImplemented('done')).toBe(true);
        expect(isSelfReportedStarted('in_progress')).toBe(true);
        expect(isSelfReportedImplemented('in_progress')).toBe(false);
        expect(isSelfReportedStarted('done')).toBe(false);
        expect(isSelfReportedImplemented('blocked')).toBe(false);
    });
});

describe('TASK_PROGRESS_SELF_REPORTED_NOTE', () => {
    it('says plainly that Synapse does not verify execution', () => {
        expect(TASK_PROGRESS_SELF_REPORTED_NOTE).toMatch(/self-reported/i);
        expect(TASK_PROGRESS_SELF_REPORTED_NOTE).toMatch(/never runs or verifies/i);
    });

    it('is one short line — not a paragraph that nags', () => {
        expect(TASK_PROGRESS_SELF_REPORTED_NOTE.split('. ').length).toBeLessThanOrEqual(2);
        expect(TASK_PROGRESS_SELF_REPORTED_NOTE.length).toBeLessThan(160);
    });
});
