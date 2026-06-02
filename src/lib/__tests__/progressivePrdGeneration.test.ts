import { describe, expect, it } from 'vitest';
import {
  applyAiUpdate,
  DEFAULT_PRD_SECTIONS,
  generateProgressivePrd,
  makeSkeletonJobs,
  selectModelTier,
  validateGraph,
  type PrdSectionTemplate,
} from '../services/progressivePrdGeneration';

const baseConfig = {
  fastModel: 'fast',
  strongModel: 'strong',
  maxFastConcurrency: 4,
  maxStrongConcurrency: 3,
  enableRefinementPass: false,
};

/**
 * Provider that tracks peak simultaneous in-flight calls and lets each call's
 * resolution be deferred, so concurrency can be asserted deterministically.
 */
const makeConcurrencyProvider = (delayMs = 5) => {
  let inFlight = 0;
  let peak = 0;
  const order: string[] = [];
  return {
    get peak() { return peak; },
    order,
    provider: {
      async generateText(input: { prompt: string; model: string; schema: object }) {
        inFlight++;
        peak = Math.max(peak, inFlight);
        // Record which section by matching the unique "<id> slice" marker in the prompt.
        const marker = DEFAULT_PRD_SECTIONS.find(s => input.prompt.includes(`${s.id} slice`));
        if (marker) order.push(marker.id);
        await new Promise(r => setTimeout(r, delayMs));
        inFlight--;
        return '{}';
      },
    },
  };
};

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

  it('forwards the AbortSignal down to the provider', async () => {
    const controller = new AbortController();
    const seenSignals: (AbortSignal | undefined)[] = [];
    const provider = {
      async generateText(input: { prompt: string; model: string; schema: object; signal?: AbortSignal }) {
        seenSignals.push(input.signal);
        return '{}';
      },
    };

    await generateProgressivePrd({
      prompt: 'Build a note app',
      provider,
      sections: [DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_basics')!],
      config: baseConfig,
      signal: controller.signal,
    });

    expect(seenSignals.length).toBe(1);
    expect(seenSignals[0]).toBe(controller.signal);
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

  // ─── DAG executor hardening ────────────────────────────────────────────────

  it('runs independent sections concurrently (peak concurrency > 1)', async () => {
    const tracker = makeConcurrencyProvider(10);
    // product_thesis and grounding are both independent (depend only on
    // product_basics) so after basics they should overlap.
    const sections = [
      DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_basics')!,
      DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_thesis')!,
      DEFAULT_PRD_SECTIONS.find(s => s.id === 'grounding')!,
    ];
    await generateProgressivePrd({
      prompt: 'concurrent test',
      provider: tracker.provider,
      sections,
      config: baseConfig,
    });
    expect(tracker.peak).toBeGreaterThan(1);
  });

  it('respects the per-tier max concurrency limit', async () => {
    const tracker = makeConcurrencyProvider(10);
    // 4 independent fast sections, but a fast cap of 2 → peak must be ≤ 2.
    const sections: PrdSectionTemplate[] = ['a', 'b', 'c', 'd'].map((id, i) => ({
      id: id as PrdSectionTemplate['id'],
      title: id,
      order: i + 1,
      risk: 'low',
      estimatedSeconds: 1,
    }));
    await generateProgressivePrd({
      prompt: 'cap test',
      provider: tracker.provider,
      sections,
      config: { ...baseConfig, maxFastConcurrency: 2 },
    });
    expect(tracker.peak).toBeLessThanOrEqual(2);
  });

  it('detects circular dependencies and throws', () => {
    const cyclic: PrdSectionTemplate[] = [
      { id: 'a' as PrdSectionTemplate['id'], title: 'a', order: 1, risk: 'low', estimatedSeconds: 1, dependencies: ['b' as PrdSectionTemplate['id']] },
      { id: 'b' as PrdSectionTemplate['id'], title: 'b', order: 2, risk: 'low', estimatedSeconds: 1, dependencies: ['a' as PrdSectionTemplate['id']] },
    ];
    expect(() => validateGraph(cyclic)).toThrow(/circular dependency/i);
  });

  it('rejects a dependency referencing an unknown section', () => {
    const broken: PrdSectionTemplate[] = [
      { id: 'a' as PrdSectionTemplate['id'], title: 'a', order: 1, risk: 'low', estimatedSeconds: 1, dependencies: ['ghost' as PrdSectionTemplate['id']] },
    ];
    expect(() => validateGraph(broken)).toThrow(/unknown section/i);
  });

  it('a failed section does not block an unrelated independent branch', async () => {
    const provider = {
      async generateText(input: { prompt: string; model: string; schema: object }) {
        if (input.prompt.includes('product_thesis slice')) throw new Error('boom');
        return '{}';
      },
    };
    // product_thesis and grounding are independent siblings (both depend only on
    // product_basics). product_thesis failing must not stop grounding.
    const sections = [
      DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_basics')!,
      DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_thesis')!,
      DEFAULT_PRD_SECTIONS.find(s => s.id === 'grounding')!,
    ];
    const { jobs } = await generateProgressivePrd({
      prompt: 'isolation test',
      provider,
      sections,
      config: baseConfig,
    });
    expect(jobs.product_thesis.status).toBe('error');
    expect(jobs.grounding.status).toBe('complete');
  });

  it('captures per-section start and completion timestamps', async () => {
    const provider = { async generateText() { return '{}'; } };
    const { jobs } = await generateProgressivePrd({
      prompt: 'timing test',
      provider,
      sections: [DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_basics')!],
      config: baseConfig,
    });
    expect(jobs.product_basics.startedAt).toBeTruthy();
    expect(jobs.product_basics.completedAt).toBeTruthy();
  });

  it('emits section_ready before section_started for each section', async () => {
    const provider = { async generateText() { return '{}'; } };
    const events: Array<{ type: string; sectionId?: string }> = [];
    await generateProgressivePrd({
      prompt: 'transition test',
      provider,
      sections: [
        DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_basics')!,
        DEFAULT_PRD_SECTIONS.find(s => s.id === 'product_thesis')!,
      ],
      config: baseConfig,
      onEvent: (e) => {
        if (e.type === 'section_ready' || e.type === 'section_started' || e.type === 'section_completed') {
          events.push({ type: e.type, sectionId: (e as { sectionId?: string }).sectionId });
        }
      },
    });
    for (const id of ['product_basics', 'product_thesis']) {
      const readyIdx = events.findIndex(e => e.type === 'section_ready' && e.sectionId === id);
      const startedIdx = events.findIndex(e => e.type === 'section_started' && e.sectionId === id);
      const completedIdx = events.findIndex(e => e.type === 'section_completed' && e.sectionId === id);
      expect(readyIdx).toBeGreaterThanOrEqual(0);
      expect(startedIdx).toBeGreaterThan(readyIdx);
      expect(completedIdx).toBeGreaterThan(startedIdx);
    }
  });
});
