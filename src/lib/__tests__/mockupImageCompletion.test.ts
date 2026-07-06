import { describe, it, expect } from 'vitest';
import { computeMockupImageCompletion, type ScreenImageState } from '../mockupImageCompletion';

const state = (screenId: string, over: Partial<ScreenImageState> = {}): ScreenImageState => ({
    screenId,
    generated: false,
    failed: false,
    generating: false,
    ...over,
});

describe('computeMockupImageCompletion', () => {
    it('reports complete only when every screen has a render', () => {
        const c = computeMockupImageCompletion([
            state('a', { generated: true }),
            state('b', { generated: true }),
        ]);
        expect(c.status).toBe('complete');
        expect(c.visuallyComplete).toBe(true);
        expect(c.failed).toBe(0);
    });

    it('exposes partial visual completion when one screen image fails', () => {
        const c = computeMockupImageCompletion([
            state('a', { generated: true }),
            state('b', { failed: true }),
        ]);
        expect(c.status).toBe('partial');
        expect(c.visuallyComplete).toBe(false);
        expect(c.failed).toBe(1);
        expect(c.failedScreenIds).toEqual(['b']);
        expect(c.generated).toBe(1);
    });

    it('reports generating while any screen is in flight', () => {
        const c = computeMockupImageCompletion([
            state('a', { generated: true }),
            state('b', { generating: true }),
        ]);
        expect(c.status).toBe('generating');
        expect(c.visuallyComplete).toBe(false);
    });

    it('reports none when nothing has started', () => {
        const c = computeMockupImageCompletion([state('a'), state('b')]);
        expect(c.status).toBe('none');
        expect(c.awaiting).toBe(2);
    });

    it('treats zero screens as none', () => {
        expect(computeMockupImageCompletion([]).status).toBe('none');
    });
});
