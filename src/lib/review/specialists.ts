import type { ReviewContextManifest, RecommendedSpecialist, ReviewSpecialistId, SpecialistDefinition } from './types';

export const SPECIALIST_REGISTRY: Record<ReviewSpecialistId, SpecialistDefinition> = {
    product_scope: {
        id: 'product_scope',
        label: 'Product & Scope',
        responsibility: 'Test product decisions, scope boundaries, assumptions, success measures, and sequencing.',
        goals: ['Find unresolved product decisions', 'Challenge unsupported assumptions', 'Identify avoidable or premature scope'],
        boundaries: ['Do not prescribe implementation detail unless it changes product feasibility', 'Do not invent market evidence'],
        relevantArtifacts: ['implementation_plan', 'user_flows', 'screen_inventory'],
    },
    ux_behavior: {
        id: 'ux_behavior',
        label: 'UX & Behavior',
        responsibility: 'Review user intent, flows, screen behavior, state coverage, and behavioral assumptions.',
        goals: ['Find ambiguous user behavior', 'Check flow and screen agreement', 'Surface missing recovery and edge states'],
        boundaries: ['Do not critique visual taste', 'Do not turn optional polish into blockers'],
        relevantArtifacts: ['screen_inventory', 'user_flows', 'design_system'],
    },
    architecture: {
        id: 'architecture',
        label: 'Technical Architecture',
        responsibility: 'Test architectural coherence, feasibility, boundaries, dependencies, and irreversible choices.',
        goals: ['Detect infeasible or contradictory architecture', 'Find under-specified integration boundaries', 'Challenge unnecessary complexity'],
        boundaries: ['Do not replace explicit product decisions with preferred technologies', 'Do not assume scale not present in evidence'],
        relevantArtifacts: ['data_model', 'implementation_plan', 'user_flows'],
    },
    data_backend: {
        id: 'data_backend',
        label: 'Backend & Data',
        responsibility: 'Review entities, lifecycle, APIs, consistency, permissions, and data ownership.',
        goals: ['Find missing data rules', 'Check API and flow agreement', 'Surface lifecycle and integrity risks'],
        boundaries: ['Do not invent entities or retention requirements', 'Separate missing information from contradictions'],
        relevantArtifacts: ['data_model', 'user_flows', 'implementation_plan'],
    },
    security_privacy: {
        id: 'security_privacy',
        label: 'Security & Privacy',
        responsibility: 'Review trust boundaries, authorization, sensitive data, privacy promises, abuse, and recovery.',
        goals: ['Identify unhandled sensitive-data risks', 'Find authorization ambiguity', 'Challenge unsupported privacy claims'],
        boundaries: ['Do not claim a legal requirement without project evidence', 'Do not manufacture threats unrelated to the product'],
        relevantArtifacts: ['data_model', 'user_flows', 'implementation_plan', 'screen_inventory'],
    },
    accessibility: {
        id: 'accessibility',
        label: 'Accessibility',
        responsibility: 'Review interaction, content, state, input, and responsive plans for inclusive access.',
        goals: ['Find missing keyboard/screen-reader behavior', 'Check non-visual state communication', 'Identify inaccessible interaction assumptions'],
        boundaries: ['Do not reduce accessibility to a generic checklist', 'Ground findings in actual planned interactions'],
        relevantArtifacts: ['screen_inventory', 'user_flows', 'design_system'],
    },
    reliability_qa: {
        id: 'reliability_qa',
        label: 'Reliability & QA',
        responsibility: 'Review failure recovery, concurrency, degraded states, observability, and testability.',
        goals: ['Find unhandled failures and race conditions', 'Test edge-case coverage', 'Identify requirements engineers could implement differently'],
        boundaries: ['Do not demand production-scale controls for unsupported scale', 'Do not repeat UX issues without a reliability consequence'],
        relevantArtifacts: ['user_flows', 'data_model', 'implementation_plan', 'screen_inventory'],
    },
    ai_model_risk: {
        id: 'ai_model_risk',
        label: 'AI & Model Risk',
        responsibility: 'Review model behavior, grounding, evaluation, fallbacks, human control, and cost/latency assumptions.',
        goals: ['Find undefined AI behavior', 'Challenge model-quality assumptions', 'Identify missing evaluation and fallback decisions'],
        boundaries: ['Do not assume an AI feature where none exists', 'Separate model uncertainty from ordinary software defects'],
        relevantArtifacts: ['implementation_plan', 'user_flows', 'data_model', 'prompt_pack'],
    },
    delivery_operations: {
        id: 'delivery_operations',
        label: 'Delivery & Operations',
        responsibility: 'Review sequencing, dependencies, operational ownership, rollout, cost, and delivery feasibility.',
        goals: ['Find dependency and sequencing gaps', 'Challenge unrealistic delivery scope', 'Identify missing operational decisions'],
        boundaries: ['Do not invent team or budget constraints', 'Do not treat every future concern as an MVP blocker'],
        relevantArtifacts: ['implementation_plan', 'data_model'],
    },
};

const has = (text: string, pattern: RegExp): boolean => pattern.test(text);

export function recommendSpecialistPanel(
    manifest: ReviewContextManifest,
    options: { focus?: string; min?: number; max?: number } = {},
): RecommendedSpecialist[] {
    const focus = options.focus?.trim() ?? '';
    const corpus = `${manifest.projectName}\n${manifest.productCategory ?? ''}\n${focus}\n${manifest.sources.map(source => source.content).join('\n')}`.toLowerCase();
    const available = new Set(manifest.availableArtifacts);
    const scored = new Map<ReviewSpecialistId, RecommendedSpecialist>();
    const add = (id: ReviewSpecialistId, score: number, reason: string) => {
        const current = scored.get(id) ?? { specialistId: id, score: 0, reasons: [] };
        current.score += score;
        if (!current.reasons.includes(reason)) current.reasons.push(reason);
        scored.set(id, current);
    };

    add('product_scope', 100, 'Every review tests scope, assumptions, and unresolved product decisions.');
    add('architecture', 70, 'The PRD defines technical architecture that should be feasibility-checked.');
    if (available.has('screen_inventory') || available.has('user_flows') || manifest.platform) {
        add('ux_behavior', 85, 'User-facing flows or screens are available for behavioral review.');
    }
    if (available.has('data_model') || has(corpus, /\b(api|database|entity|record|sync|storage|backend)\b/)) {
        add('data_backend', 80, 'The plan includes a data or backend contract.');
    }
    if (has(corpus, /\b(auth|account|permission|role|payment|health|financial|location|personal|private|upload|camera|biometric|child|children)\b/)) {
        add('security_privacy', 105, 'The plan handles identity, permissions, or potentially sensitive data.');
    }
    if (available.has('screen_inventory') && (available.has('design_system') || manifest.platform)) {
        add('accessibility', 68, 'Concrete UI interactions are available for accessibility review.');
    }
    if (available.has('implementation_plan') || has(corpus, /\b(offline|retry|timeout|failure|queue|concurrent|recovery|webhook|notification)\b/)) {
        add('reliability_qa', 76, 'The plan includes failure-prone or implementation-critical behavior.');
    }
    if (has(corpus, /\b(ai|llm|model|prompt|inference|embedding|classifier|generation|gemini|openai)\b/)) {
        add('ai_model_risk', 115, 'The product depends on AI or model-generated behavior.');
    }
    if (available.has('implementation_plan') || has(corpus, /\b(deploy|rollout|migration|milestone|timeline|cost|billing|operations|monitoring)\b/)) {
        add('delivery_operations', 72, 'Delivery sequencing or operational feasibility is specified.');
    }

    if (focus) {
        for (const specialist of Object.values(SPECIALIST_REGISTRY)) {
            const specialistText = `${specialist.label} ${specialist.responsibility} ${specialist.goals.join(' ')}`.toLowerCase();
            const focusTokens = focus.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
            if (focusTokens.some(token => specialistText.includes(token))) {
                add(specialist.id, 45, `The requested focus (“${focus}”) matches this specialist's responsibility.`);
            }
        }
    }

    const min = Math.max(1, options.min ?? 3);
    const max = Math.max(min, Math.min(5, options.max ?? 5));
    const ranked = [...scored.values()].sort((a, b) => b.score - a.score || a.specialistId.localeCompare(b.specialistId));
    if (ranked.length < min) {
        for (const id of ['ux_behavior', 'reliability_qa', 'data_backend'] as ReviewSpecialistId[]) {
            if (ranked.some(item => item.specialistId === id)) continue;
            ranked.push({ specialistId: id, score: 1, reasons: ['Selected to provide baseline cross-artifact coverage.'] });
            if (ranked.length === min) break;
        }
    }
    return ranked.slice(0, max);
}
