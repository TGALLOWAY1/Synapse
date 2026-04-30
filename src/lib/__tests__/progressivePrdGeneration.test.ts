import { describe, expect, it } from 'vitest';
import {
  applyAiUpdate,
  DEFAULT_PRD_SECTIONS,
  generateProgressivePrd,
  makeSkeletonJobs,
  selectModelTier,
} from '../services/progressivePrdGeneration';

describe('progressive PRD generation', () => {
  it('routes low risk tasks to fast tier', () => {
    expect(selectModelTier('low')).toBe('fast');
  });

  it('routes high risk tasks to strong tier', () => {
    expect(selectModelTier('high')).toBe('strong');
  });

  it('does not overwrite user-edited sections', () => {
    const jobs = makeSkeletonJobs(DEFAULT_PRD_SECTIONS.slice(0, 1));
    jobs.product_summary.isUserEdited = true;
    jobs.product_summary.content = 'custom';
    const updated = applyAiUpdate(jobs.product_summary, 'new AI content');
    expect(updated.content).toBe('custom');
    expect(updated.version).toBe(1);
  });

  it('continues session when one section fails', async () => {
    const events: string[] = [];
    const provider = {
      async generateText(input: { prompt: string; model: string }) {
        if (input.prompt.includes('Vision')) throw new Error('boom');
        return 'Generated section content with enough details to meet confidence threshold.';
      },
    };

    const jobs = await generateProgressivePrd({
      prompt: 'Build a project management app',
      provider,
      sections: DEFAULT_PRD_SECTIONS.slice(0, 3),
      config: {
        fastModel: 'fast',
        strongModel: 'strong',
        maxFastConcurrency: 2,
        maxStrongConcurrency: 1,
        enableRefinementPass: true,
      },
      onEvent: e => events.push(e.type),
    });

    expect(jobs.vision.status).toBe('error');
    expect(jobs.product_summary.status).toBe('complete');
    expect(events).toContain('session_completed');
  });

  it('escalates low-confidence fast outputs to strong refinement', async () => {
    const calls: string[] = [];
    const provider = {
      async generateText(input: { prompt: string; model: string }) {
        calls.push(input.model);
        if (input.model === 'fast') return 'tiny';
        return 'Refined and detailed output that improves quality and confidence substantially.';
      },
    };

    const jobs = await generateProgressivePrd({
      prompt: 'Build note app',
      provider,
      sections: [DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_summary')!],
      config: {
        fastModel: 'fast',
        strongModel: 'strong',
        maxFastConcurrency: 1,
        maxStrongConcurrency: 1,
        enableRefinementPass: true,
      },
    });

    expect(calls).toEqual(['fast', 'strong']);
    expect(jobs.product_summary.status).toBe('complete');
    expect((jobs.product_summary.confidence ?? 0) >= 0.75).toBe(true);
  });
});
