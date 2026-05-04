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
    const firstId = DEFAULT_PRD_SECTIONS[0].id;
    jobs[firstId].isUserEdited = true;
    jobs[firstId].content = 'custom';
    const updated = applyAiUpdate(jobs[firstId], 'new AI content');
    expect(updated.content).toBe('custom');
    expect(updated.version).toBe(1);
  });

  it('continues session when one section fails', async () => {
    const events: string[] = [];
    const provider = {
      async generateText(input: { prompt: string; model: string; schema: object }) {
        if (input.prompt.includes('product_thesis slice')) throw new Error('boom');
        return '{}';
      },
    };

    // product_basics (no deps) and grounding (dep: product_basics) should succeed;
    // product_thesis (dep: product_basics) should fail.
    const sections = [
      DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_basics')!,
      DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_thesis')!,
      DEFAULT_PRD_SECTIONS.find(s => s.id === 'grounding')!,
    ];

    const { jobs } = await generateProgressivePrd({
      prompt: 'Build a project management app',
      provider,
      sections,
      config: {
        fastModel: 'fast',
        strongModel: 'strong',
        maxFastConcurrency: 2,
        maxStrongConcurrency: 1,
        enableRefinementPass: false,
      },
      onEvent: e => events.push(e.type),
    });

    expect(jobs.product_thesis.status).toBe('error');
    expect(jobs.product_basics.status).toBe('complete');
    expect(jobs.grounding.status).toBe('complete');
    expect(events).toContain('session_completed');
  });

  it('escalates low-confidence fast outputs to strong refinement', async () => {
    const calls: string[] = [];
    const provider = {
      async generateText(input: { prompt: string; model: string; schema: object }) {
        calls.push(input.model);
        if (input.model === 'fast') return '{"v":1}'; // parseable but < 120 chars → confidence 0.6
        return '{"vision":"refined","coreProblem":"solved","targetUsers":["user1"],"productName":"App"}';
      },
    };

    // product_basics is 'low' risk → fast tier → will trigger refinement when response is short
    const { jobs } = await generateProgressivePrd({
      prompt: 'Build note app',
      provider,
      sections: [DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_basics')!],
      config: {
        fastModel: 'fast',
        strongModel: 'strong',
        maxFastConcurrency: 1,
        maxStrongConcurrency: 1,
        enableRefinementPass: true,
      },
    });

    expect(calls).toEqual(['fast', 'strong']);
    expect(jobs.product_basics.status).toBe('complete');
    expect((jobs.product_basics.confidence ?? 0) >= 0.75).toBe(true);
  });

  it('runs dependent sections only after their deps complete', async () => {
    const completionOrder: string[] = [];
    const provider = {
      async generateText() {
        return '{}';
      },
    };

    const { jobs } = await generateProgressivePrd({
      prompt: 'Test app',
      provider,
      sections: [
        DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_basics')!,
        DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_thesis')!,
      ],
      config: {
        fastModel: 'fast',
        strongModel: 'strong',
        maxFastConcurrency: 2,
        maxStrongConcurrency: 2,
        enableRefinementPass: false,
      },
      onEvent: e => {
        if (e.type === 'section_completed') completionOrder.push(e.sectionId);
      },
    });

    // product_thesis depends on product_basics, so basics must complete first.
    const basicsIdx = completionOrder.indexOf('product_basics');
    const thesisIdx = completionOrder.indexOf('product_thesis');
    expect(basicsIdx).toBeGreaterThanOrEqual(0);
    expect(thesisIdx).toBeGreaterThan(basicsIdx);
    expect(jobs.product_basics.status).toBe('complete');
    expect(jobs.product_thesis.status).toBe('complete');
  });

  it('marks section as error when response is unparseable JSON (not silently complete)', async () => {
    const provider = {
      async generateText() {
        return 'not json at all';
      },
    };

    const { jobs } = await generateProgressivePrd({
      prompt: 'Test app',
      provider,
      sections: [DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_basics')!],
      config: {
        fastModel: 'fast',
        strongModel: 'strong',
        maxFastConcurrency: 1,
        maxStrongConcurrency: 1,
        enableRefinementPass: false,
      },
    });

    expect(jobs.product_basics.status).toBe('error');
  });

  it('runs dependents even when an upstream section fails', async () => {
    const provider = {
      async generateText(input: { prompt: string; model: string; schema: object }) {
        if (input.prompt.includes('product_thesis slice')) throw new Error('thesis failed');
        return '{}';
      },
    };

    // features depends on BOTH product_basics and product_thesis.
    // When product_thesis fails, features should still run (with null thesis upstream).
    const sections = [
      DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_basics')!,
      DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_thesis')!,
      DEFAULT_PRD_SECTIONS.find(s => s.id === 'features')!,
    ];

    const { jobs } = await generateProgressivePrd({
      prompt: 'Test app',
      provider,
      sections,
      config: {
        fastModel: 'fast',
        strongModel: 'strong',
        maxFastConcurrency: 2,
        maxStrongConcurrency: 2,
        enableRefinementPass: false,
      },
    });

    expect(jobs.product_thesis.status).toBe('error');
    expect(jobs.features.status).toBe('complete');
  });
});
