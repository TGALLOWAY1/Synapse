import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressTimeline } from '../ProgressTimeline';
import { buildGenerationSteps, type SectionStatusMap } from '../buildGenerationSteps';

const MODELS = { fastModel: 'gemini-3-flash-preview', strongModel: 'gemini-3-pro-preview' };

function mockMatchMedia(matches: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

// A run with a completed, an in-progress, and a failed section.
const status: SectionStatusMap = {
    product_basics: { tier: 'fast', status: 'complete', ms: 5800 },
    grounding: { tier: 'fast', status: 'complete', ms: 3100 },
    product_thesis: { tier: 'strong', status: 'generating', startedAt: Date.now() - 6000 },
    metrics_scope: { tier: 'fast', status: 'error', ms: 9200, error: 'Model timeout exceeded' },
};

const steps = () => buildGenerationSteps(status, MODELS);

afterEach(() => {
    // @ts-expect-error allow removing the stub between tests
    delete window.matchMedia;
    vi.restoreAllMocks();
});

describe('ProgressTimeline — desktop', () => {
    it('shows labeled times, model chips, and no ambiguous tier suffixes', () => {
        mockMatchMedia(false);
        render(<ProgressTimeline steps={steps()} onRetryStep={vi.fn()} />);

        // explicit time labels
        expect(screen.getAllByText(/Actual:/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Est\./).length).toBeGreaterThan(0);
        expect(screen.getByText('Failed')).toBeInTheDocument();
        // the header status pill; step time blocks carry only timing text
        expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);

        // model chips always visible
        expect(screen.getAllByText(/Gemini/).length).toBeGreaterThan(0);

        // no "(Pro)" / "(Flash)" in any title
        expect(document.body.textContent).not.toMatch(/\(Pro\)/);
        expect(document.body.textContent).not.toMatch(/\(Flash\)/);
    });

    it('does not render a green "Completed" pill for completed steps', () => {
        mockMatchMedia(false);
        render(<ProgressTimeline steps={steps()} onRetryStep={vi.fn()} />);
        // Header status is "In progress" here, and completed rows use "Actual:"
        expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    });

    it('shows a Run again button for the failed step', () => {
        mockMatchMedia(false);
        const onRetryStep = vi.fn();
        render(<ProgressTimeline steps={steps()} onRetryStep={onRetryStep} />);
        const btn = screen.getByText('Run again');
        expect(btn).toBeInTheDocument();
        btn.click();
        expect(onRetryStep).toHaveBeenCalledWith('metrics_scope');
    });
});

describe('ProgressTimeline — mobile', () => {
    it('exposes the full-history link and keeps the failed retry visible', () => {
        mockMatchMedia(true);
        const onViewHistory = vi.fn();
        render(<ProgressTimeline steps={steps()} onRetryStep={vi.fn()} onViewHistory={onViewHistory} />);

        const link = screen.getByText('View full history');
        link.click();
        expect(onViewHistory).toHaveBeenCalled();

        // failed steps stay expanded on mobile too
        expect(screen.getByText('Run again')).toBeInTheDocument();
    });
});
