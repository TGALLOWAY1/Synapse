import { callGemini } from '../geminiClient';

export type PrdSectionStatus =
  | 'pending'
  | 'queued'
  | 'generating'
  | 'streaming'
  | 'draft_complete'
  | 'refining'
  | 'complete'
  | 'error'
  | 'user_edited';

export type ModelTier = 'fast' | 'strong' | 'premium';

export type PrdSectionJob = {
  id: string;
  title: string;
  order: number;
  status: PrdSectionStatus;
  modelTier: ModelTier;
  assignedModel?: string;
  content: string;
  confidence?: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  isUserEdited: boolean;
  version: number;
};

export type GenerationTaskRisk = 'low' | 'high';

export type PrdSectionTemplate = {
  id: string;
  title: string;
  order: number;
  risk: GenerationTaskRisk;
  dependencies?: string[];
};

export type SectionGenerationResult = {
  content: string;
  confidence: number;
  concerns: string[];
};

export type ProgressiveGenerationConfig = {
  fastModel: string;
  strongModel: string;
  premiumModel?: string;
  maxFastConcurrency: number;
  maxStrongConcurrency: number;
  enableRefinementPass: boolean;
};

export type ProgressiveEvent =
  | { type: 'session_started'; sections: PrdSectionJob[] }
  | { type: 'section_queued'; sectionId: string }
  | { type: 'section_started'; sectionId: string; modelTier: ModelTier; model: string }
  | { type: 'section_completed'; sectionId: string; content: string; confidence?: number }
  | { type: 'section_refining'; sectionId: string }
  | { type: 'section_refined'; sectionId: string; content: string; confidence?: number }
  | { type: 'section_error'; sectionId: string; error: string }
  | { type: 'session_completed' };

export type ModelProvider = {
  generateText: (input: { prompt: string; model: string }) => Promise<string>;
};

const nowIso = () => new Date().toISOString();

export const DEFAULT_PRD_SECTIONS: PrdSectionTemplate[] = [
  ['product_summary', 'Product Summary', 1, 'low'],
  ['vision', 'Vision', 2, 'high'],
  ['target_users', 'Target Users', 3, 'low'],
  ['core_problem', 'Core Problem', 4, 'high'],
  ['goals_non_goals', 'Goals and Non-Goals', 5, 'high'],
  ['key_features', 'Key Features', 6, 'high', ['vision', 'target_users', 'core_problem']],
  ['user_stories', 'User Stories', 7, 'high', ['target_users', 'key_features']],
  ['user_flows', 'User Flows', 8, 'high', ['user_stories']],
  ['functional_requirements', 'Functional Requirements', 9, 'high', ['key_features']],
  ['data_model', 'Data Model', 10, 'high', ['user_stories', 'key_features']],
  ['technical_architecture', 'Technical Architecture', 11, 'high', ['data_model']],
  ['ux_notes', 'UX Notes', 12, 'low'],
  ['edge_cases', 'Edge Cases', 13, 'high'],
  ['risks_assumptions', 'Risks and Assumptions', 14, 'high'],
  ['success_metrics', 'Success Metrics', 15, 'low'],
  ['implementation_plan', 'Implementation Plan', 16, 'high', ['key_features', 'data_model', 'technical_architecture']],
].map(([id, title, order, risk, dependencies]) => ({ id, title, order, risk, dependencies })) as PrdSectionTemplate[];

export const makeSkeletonJobs = (sections = DEFAULT_PRD_SECTIONS): Record<string, PrdSectionJob> =>
  Object.fromEntries(
    sections.map(s => [s.id, {
      id: s.id,
      title: s.title,
      order: s.order,
      status: 'pending' as const,
      modelTier: s.risk === 'low' ? 'fast' : 'strong',
      content: '',
      isUserEdited: false,
      version: 1,
    }]),
  );

export const selectModelTier = (risk: GenerationTaskRisk): ModelTier => (risk === 'low' ? 'fast' : 'strong');

export const selectModelForTier = (tier: ModelTier, cfg: ProgressiveGenerationConfig): string => {
  if (tier === 'premium' && cfg.premiumModel) return cfg.premiumModel;
  return tier === 'fast' ? cfg.fastModel : cfg.strongModel;
};

export const applyAiUpdate = (section: PrdSectionJob, content: string): PrdSectionJob => {
  if (section.isUserEdited) return section;
  return {
    ...section,
    content,
    status: 'complete',
    completedAt: nowIso(),
    version: section.version + 1,
  };
};

export const defaultProvider: ModelProvider = {
  async generateText(input) {
    return callGemini('Generate concise PRD section markdown.', input.prompt, { model: input.model });
  },
};

async function runWithLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const queue = [...items];
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (queue.length) {
      const next = queue.shift();
      if (!next) return;
      await worker(next);
    }
  });
  await Promise.all(runners);
}

export async function generateProgressivePrd(params: {
  prompt: string;
  config: ProgressiveGenerationConfig;
  provider?: ModelProvider;
  onEvent?: (event: ProgressiveEvent) => void;
  sections?: PrdSectionTemplate[];
}) {
  const sections = params.sections ?? DEFAULT_PRD_SECTIONS;
  const provider = params.provider ?? defaultProvider;
  const jobs = makeSkeletonJobs(sections);

  params.onEvent?.({ type: 'session_started', sections: Object.values(jobs) });

  const process = async (section: PrdSectionTemplate) => {
    const job = jobs[section.id];
    job.status = 'queued';
    params.onEvent?.({ type: 'section_queued', sectionId: section.id });
    const tier = selectModelTier(section.risk);
    const model = selectModelForTier(tier, params.config);
    job.status = 'generating';
    job.assignedModel = model;
    job.startedAt = nowIso();
    params.onEvent?.({ type: 'section_started', sectionId: section.id, modelTier: tier, model });

    try {
      const raw = await provider.generateText({
        model,
        prompt: `Section: ${section.title}\nIdea: ${params.prompt}\nReturn section markdown only.`,
      });
      const result: SectionGenerationResult = { content: raw, confidence: raw.length > 120 ? 0.8 : 0.6, concerns: [] };
      let updated = applyAiUpdate(job, result.content);
      updated.confidence = result.confidence;
      jobs[section.id] = updated;
      params.onEvent?.({ type: 'section_completed', sectionId: section.id, content: updated.content, confidence: updated.confidence });

      if (params.config.enableRefinementPass && result.confidence < 0.72 && tier === 'fast') {
        jobs[section.id] = { ...jobs[section.id], status: 'refining' };
        params.onEvent?.({ type: 'section_refining', sectionId: section.id });
        const refined = await provider.generateText({
          model: params.config.strongModel,
          prompt: `Refine this PRD section for specificity:\n${result.content}`,
        });
        const post = applyAiUpdate(jobs[section.id], refined);
        jobs[section.id] = { ...post, confidence: Math.max(0.75, result.confidence) };
        params.onEvent?.({ type: 'section_refined', sectionId: section.id, content: jobs[section.id].content, confidence: jobs[section.id].confidence });
      }
    } catch (e) {
      jobs[section.id] = { ...jobs[section.id], status: 'error', error: e instanceof Error ? e.message : 'Unknown error' };
      params.onEvent?.({ type: 'section_error', sectionId: section.id, error: jobs[section.id].error || 'Unknown error' });
    }
  };

  const fast = sections.filter(s => s.risk === 'low');
  const strong = sections.filter(s => s.risk === 'high');

  await Promise.all([
    runWithLimit(fast, params.config.maxFastConcurrency, process),
    runWithLimit(strong, params.config.maxStrongConcurrency, process),
  ]);

  params.onEvent?.({ type: 'session_completed' });
  return jobs;
}
