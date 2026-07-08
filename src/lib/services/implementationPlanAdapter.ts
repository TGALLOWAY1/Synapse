/**
 * Backwards-compatible adapter that builds the consolidated
 * `ConsolidatedImplementationPlan` view model the Implementation Plan
 * renderer consumes. Pure — no store, LLM, or React access.
 *
 * Sources, in preference order:
 *
 * 1. A native structured plan (```json synapse-plan fence) that already
 *    carries milestone prompt packs / quality gates — passed through.
 * 2. A legacy structured plan (fence without the consolidated fields) plus,
 *    when present, a legacy `prompt_pack` artifact whose prompts are adapted
 *    into prompt packs and attached to milestones by best-effort
 *    title/category matching (unmatched ones land in a clearly labeled
 *    "Unassigned" group).
 * 3. A legacy markdown-only plan (### Milestone N: headings).
 * 4. Only a legacy `prompt_pack` artifact (no plan) — prompts render as
 *    unassigned packs with a readiness warning.
 *
 * Everything here is derived at render time; legacy artifacts are never
 * rewritten or migrated. Data is preserved: legacy Definition of Done items
 * become quality gates, Architecture feeds the summary, and Risks (milestone
 * or appendix) surface through `plan.risks` (their own overview card).
 */

import type {
    ConsolidatedImplementationPlan,
    ImplementationPlanMilestone,
    ImplementationPlanSummary,
    ImplementationPromptPack,
    ImplementationQualityGate,
    ImplementationReadiness,
    ImplementationTraceabilityItem,
    QualityGateCategory,
    RiskItem,
    StructuredImplementationPlan,
} from '../../types';
import {
    extractStructuredPlan,
    findSection,
    parseImplementationPlan,
    parseMilestoneBody,
} from './implementationPlanParser';
import { parsePromptPack, type PromptCard } from './promptPackParser';

export interface ConsolidatedPlanInput {
    /** Preferred implementation_plan artifact content (markdown), if any. */
    planContent?: string | null;
    /** Preferred legacy prompt_pack artifact content (markdown), if any. */
    promptPackContent?: string | null;
    /** Display title for the consolidated view. */
    title?: string;
}

// --- Quality-gate derivation -------------------------------------------------

// Stem tokens (accessib, integrat, regress, …) deliberately have no trailing
// \b so they match their inflections ("Accessibility", "integrated").
const GATE_CATEGORY_KEYWORDS: Array<{ category: QualityGateCategory; pattern: RegExp }> = [
    { category: 'testing', pattern: /\b(test|tests|tested|testing|coverage|e2e|unit|vitest|jest|playwright)\b/i },
    { category: 'accessibility', pattern: /accessib|a11y|\baria\b|screen reader|keyboard|contrast|wcag/i },
    { category: 'performance', pattern: /performan|\bperf\b|latency|load time|lighthouse|\bfps\b|bundle size/i },
    { category: 'data_integrity', pattern: /data integrity|schema|migration|database|persist|constraint/i },
    { category: 'integration', pattern: /integrat|\bapi\b|endpoint|webhook|third-party|oauth|\bsync\b/i },
    { category: 'design_fidelity', pattern: /design|visual|style|pixel|mockup|token|brand|responsive|layout/i },
    { category: 'regression', pattern: /regress|doesn't break|does not break|backwards/i },
];

function categorizeGate(text: string): QualityGateCategory {
    for (const { category, pattern } of GATE_CATEGORY_KEYWORDS) {
        if (pattern.test(text)) return category;
    }
    return 'functional';
}

/** Turn a Definition-of-Done line into a derived quality gate. */
function gateFromDoD(text: string, id: string): ImplementationQualityGate {
    return {
        id,
        title: text,
        category: categorizeGate(text),
        required: true,
    };
}

// --- Legacy prompt_pack → prompt packs ---------------------------------------

function splitBullets(section: string | undefined): string[] {
    if (!section) return [];
    return section
        .split('\n')
        .map(line => line.replace(/^\s*[-*]\s*/, '').trim())
        .filter(Boolean);
}

/** Extract the lines of a `## Heading` section from a prompt body. */
function extractPromptSection(body: string, heading: RegExp): string | undefined {
    const lines = body.split('\n');
    const collected: string[] = [];
    let inSection = false;
    for (const line of lines) {
        const h = line.match(/^##\s+(.+?)\s*$/);
        if (h) {
            inSection = heading.test(h[1]);
            continue;
        }
        if (inSection) collected.push(line);
    }
    const joined = collected.join('\n').trim();
    return joined || undefined;
}

export function promptPackFromLegacyCard(card: PromptCard): ImplementationPromptPack {
    const requirements = splitBullets(extractPromptSection(card.promptBody, /^requirements$/i));
    const expected = splitBullets(extractPromptSection(card.promptBody, /^expected output$/i));
    const inScope = splitBullets(extractPromptSection(card.promptBody, /^features? in scope$/i))
        // Keep only the top-level feature lines ("<id> — <name>"), not the
        // indented purpose/behavior/constraint sub-bullets.
        .filter(line => /—|--|-\s/.test(line) || /^\S+\s+—/.test(line))
        .map(line => line.replace(/^`?([^`]+)`?\s*—\s*/, '$1 — '));

    return {
        id: `legacy-prompt-${card.index}`,
        title: card.title,
        purpose: card.expected ?? `Ready-to-run prompt: ${card.title}`,
        prompt: card.promptBody,
        scope: inScope.length ? { include: inScope, exclude: [] } : undefined,
        acceptanceCriteria: requirements.length ? requirements : expected,
        category: card.category,
    };
}

// --- Best-effort prompt ↔ milestone matching ---------------------------------

const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'is', 'are', 'be', 'with', 'for', 'of',
    'to', 'in', 'on', 'at', 'by', 'from', 'as', 'this', 'that', 'implement',
    'implementation', 'build', 'create', 'setup', 'set', 'core', 'basic',
]);

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(token => token.length > 3 && !STOPWORDS.has(token));
}

/**
 * Score how well a legacy prompt matches a milestone: shared meaningful
 * tokens between the prompt's title/category and the milestone's
 * name/goal/task titles. Conservative — an ambiguous prompt is better
 * surfaced as "Unassigned" than attached to the wrong milestone.
 */
function matchScore(pack: ImplementationPromptPack, milestone: ImplementationPlanMilestone): number {
    const packTokens = new Set(tokenize(`${pack.title} ${pack.category ?? ''}`));
    const milestoneText = [
        milestone.name,
        milestone.goal ?? '',
        milestone.objective ?? '',
        ...milestone.tasks.map(t => t.title),
    ].join(' ');
    let score = 0;
    for (const token of tokenize(milestoneText)) {
        if (packTokens.has(token)) score++;
    }
    return score;
}

function attachLegacyPacks(
    milestones: ImplementationPlanMilestone[],
    packs: ImplementationPromptPack[],
): { attached: Map<string, ImplementationPromptPack[]>; unassigned: ImplementationPromptPack[] } {
    const attached = new Map<string, ImplementationPromptPack[]>();
    const unassigned: ImplementationPromptPack[] = [];
    for (const pack of packs) {
        let best: ImplementationPlanMilestone | null = null;
        let bestScore = 0;
        for (const milestone of milestones) {
            const score = matchScore(pack, milestone);
            if (score > bestScore) {
                bestScore = score;
                best = milestone;
            }
        }
        // Require at least two shared meaningful tokens to claim a match.
        if (best && bestScore >= 2) {
            const list = attached.get(best.id) ?? [];
            list.push(pack);
            attached.set(best.id, list);
        } else {
            unassigned.push(pack);
        }
    }
    return { attached, unassigned };
}

// --- Legacy markdown plan → milestones ---------------------------------------

interface LegacyAppendix {
    architecture: string[];
    risks: RiskItem[];
    definitionOfDone: string[];
    criticalPath?: string;
    teamSize?: string;
    /** Appendix prose that didn't match a known section — kept, never dropped. */
    notes?: string;
}

/**
 * Parse the post-`---` appendix of a legacy markdown plan. The serializer
 * (and hand-written legacy plans) put Architecture / Risks / Definition of
 * Done sections and Critical Path / Team Size labels there; anything
 * unrecognized is preserved as free-form notes so no content is lost when
 * the plan renders through the consolidated view.
 */
function parseLegacyAppendix(appendix: string): LegacyAppendix {
    const out: LegacyAppendix = { architecture: [], risks: [], definitionOfDone: [] };
    if (!appendix.trim()) return out;

    type Section = 'architecture' | 'risks' | 'dod' | 'other';
    let section: Section = 'other';
    const notes: string[] = [];

    for (const raw of appendix.split('\n')) {
        const line = raw.trim();
        const heading = line.match(/^#{2,3}\s+(.+?)\s*$/);
        if (heading) {
            const name = heading[1].toLowerCase();
            section = name.includes('architecture') ? 'architecture'
                : name.includes('risk') ? 'risks'
                    : name.includes('definition of done') ? 'dod'
                        : 'other';
            if (section === 'other') notes.push(raw);
            continue;
        }
        const cp = line.match(/^\*\*Critical Path:\*\*\s*(.+)$/i);
        if (cp) { out.criticalPath = cp[1].trim(); continue; }
        const ts = line.match(/^\*\*Team Size:\*\*\s*(.+)$/i);
        if (ts) { out.teamSize = ts[1].trim(); continue; }

        const bullet = line.match(/^[-*]\s*(?:\[\s*[ xX]\s*\]\s*)?(.+)$/);
        if (bullet && section !== 'other') {
            const text = bullet[1].trim();
            if (section === 'architecture') out.architecture.push(text);
            else if (section === 'dod') out.definitionOfDone.push(text);
            else {
                // Risks serialize as "- **desc** — Mitigation: …".
                const m = text.match(/^\*\*(.+?)\*\*\s*(?:—|-)?\s*(?:Mitigation:\s*(.+))?$/);
                out.risks.push(m ? { description: m[1].trim(), mitigation: m[2]?.trim() } : { description: text });
            }
            continue;
        }
        if (line) notes.push(raw);
    }

    const joined = notes.join('\n').trim();
    if (joined) out.notes = joined;
    return out;
}

function milestonesFromLegacyMarkdown(planContent: string): {
    milestones: ImplementationPlanMilestone[];
    riskTexts: string[];
    appendix: LegacyAppendix;
    /** Pre-milestone prose — used as the build-strategy fallback. */
    preamble: string;
} {
    const parsed = parseImplementationPlan(planContent);
    const riskTexts: string[] = [];

    const milestones = parsed.milestones.map(m => {
        const details = parseMilestoneBody(m.body);
        const goal = findSection(details, 'Goal');
        const dod = splitBullets(findSection(details, 'Definition of Done'));
        const deps = splitBullets(findSection(details, 'Dependencies'));
        const risks = splitBullets(findSection(details, 'Risks'));
        riskTexts.push(...risks);
        const milestone: ImplementationPlanMilestone = {
            id: `m${m.id}`,
            name: m.title,
            timeframe: m.timeframe,
            goal,
            tasks: details.deliverables.map((d, i) => ({
                id: `m${m.id}-d${i + 1}`,
                title: d.text,
                status: d.checked ? 'done' : 'todo',
            })),
            dependencies: deps.length ? deps : undefined,
            definitionOfDone: dod.length ? dod : undefined,
            linkedArtifacts: risks.length ? { risks } : undefined,
        };
        return milestone;
    });

    return {
        milestones,
        riskTexts,
        appendix: parseLegacyAppendix(parsed.appendix),
        preamble: parsed.preamble.replace(/^#{1,3}\s+.+$/gm, '').trim(),
    };
}

// --- Summary / readiness derivation ------------------------------------------

function deriveSummary(plan: StructuredImplementationPlan | null): ImplementationPlanSummary {
    if (!plan) return {};
    const summary: ImplementationPlanSummary = { ...(plan.summary ?? {}) };
    if (!summary.buildStrategy && plan.overview?.summary) {
        summary.buildStrategy = plan.overview.summary;
    }
    if ((!summary.criticalPath || summary.criticalPath.length === 0) && plan.overview?.criticalPath) {
        summary.criticalPath = [plan.overview.criticalPath];
    }
    if (!summary.teamAssumption && plan.overview?.teamSize) {
        summary.teamAssumption = plan.overview.teamSize;
    }
    if ((!summary.stackSummary || summary.stackSummary.length === 0) && plan.architecture?.length) {
        // Legacy plans hold stack decisions in `architecture`; surface the
        // first few as the stack summary rather than losing them.
        summary.stackSummary = plan.architecture.slice(0, 6);
    }
    return summary;
}

function deriveReadiness(args: {
    planSource: ConsolidatedImplementationPlan['sources']['plan'];
    packSource: ConsolidatedImplementationPlan['sources']['promptPacks'];
    milestones: ImplementationPlanMilestone[];
    unassignedCount: number;
}): ImplementationReadiness {
    const { planSource, packSource, milestones, unassignedCount } = args;
    const warnings: string[] = [];
    const missingInputs: string[] = [];

    if (planSource === 'none') {
        missingInputs.push('Build plan (milestones)');
        warnings.push('No build plan was found — showing prompt packs only. Generate the Implementation Plan to get a milestone roadmap.');
    }
    if (packSource === 'none') {
        missingInputs.push('Prompt packs');
        warnings.push('No prompt packs yet — regenerate the Implementation Plan to get copy-ready coding-agent prompts per milestone.');
    }
    if (packSource === 'legacy_prompt_pack') {
        warnings.push('Prompt packs were adapted from a previously generated Developer Prompts artifact; matches to milestones are best-effort.');
    }
    if (unassignedCount > 0) {
        warnings.push(`${unassignedCount} prompt pack${unassignedCount === 1 ? '' : 's'} could not be confidently matched to a milestone — see Unassigned Prompt Packs.`);
    }
    const withoutValidation = milestones.filter(m => !m.validationCommands?.length).length;
    if (milestones.length > 0 && withoutValidation === milestones.length && planSource !== 'none') {
        warnings.push('Milestones have no validation commands — regenerate the Implementation Plan to get per-milestone validation guidance.');
    }
    // Risks deliberately do NOT feed readiness warnings — they render in their
    // own Risks & Constraints card so the readiness signal stays trustworthy.

    const status: ImplementationReadiness['status'] =
        planSource === 'none' ? 'blocked'
            : missingInputs.length > 0 || packSource === 'legacy_prompt_pack' ? 'needs_review'
                : 'ready';

    const first = milestones[0];
    const recommendedNextStep = first
        ? `Start with "${first.name}"${(first.promptPacks?.length ?? 0) > 0 ? ' — copy its first prompt pack into your coding agent.' : '.'}`
        : 'Generate the Implementation Plan to get a milestone roadmap.';

    return { status, warnings, missingInputs, recommendedNextStep };
}

// --- Traceability derivation --------------------------------------------------

function deriveTraceability(milestones: ImplementationPlanMilestone[]): ImplementationTraceabilityItem[] {
    return milestones.map(m => {
        const links = m.linkedArtifacts ?? {};
        // Task-level links (legacy structured plans) roll up into the
        // milestone row so old plans still get a traceability view.
        const taskScreens = m.tasks.flatMap(t => t.linkedArtifacts?.mockups ?? []);
        const taskData = m.tasks.flatMap(t => t.linkedArtifacts?.dataModel ?? []);
        return {
            milestoneId: m.id,
            milestoneTitle: m.name,
            screens: dedupe([...(links.screens ?? []), ...taskScreens]),
            dataModels: dedupe([...(links.dataModels ?? []), ...taskData]),
            components: dedupe(links.components ?? []),
            promptPackIds: (m.promptPacks ?? []).map(p => p.id),
            qualityGateIds: (m.qualityGates ?? []).map(g => g.id),
        };
    });
}

function dedupe(items: string[]): string[] {
    return Array.from(new Set(items.map(i => i.trim()).filter(Boolean)));
}

// --- Main entry ----------------------------------------------------------------

/**
 * Fill schema-optional nested fields with safe defaults. The Gemini response
 * schema doesn't require `scope.include`/`scope.exclude` (or reject a missing
 * `acceptanceCriteria` on hand-edited data), so partial model output like
 * `scope: { include: [...] }` must not crash the renderer.
 */
function normalizePromptPack(pack: ImplementationPromptPack): ImplementationPromptPack {
    return {
        ...pack,
        acceptanceCriteria: pack.acceptanceCriteria ?? [],
        scope: pack.scope
            ? { include: pack.scope.include ?? [], exclude: pack.scope.exclude ?? [] }
            : undefined,
    };
}

export function buildConsolidatedPlan(input: ConsolidatedPlanInput): ConsolidatedImplementationPlan | null {
    const planContent = input.planContent?.trim() || '';
    const promptPackContent = input.promptPackContent?.trim() || '';
    if (!planContent && !promptPackContent) return null;

    // 1. Resolve the plan source.
    let structured: StructuredImplementationPlan | null = null;
    let planSource: ConsolidatedImplementationPlan['sources']['plan'] = 'none';
    let milestones: ImplementationPlanMilestone[] = [];
    const riskTexts: string[] = [];
    let legacyAppendix: LegacyAppendix | null = null;
    let legacyPreamble = '';

    if (planContent) {
        structured = extractStructuredPlan(planContent);
        if (structured) {
            planSource = 'structured';
            milestones = structured.milestones.map(m => ({
                ...m,
                promptPacks: m.promptPacks?.map(normalizePromptPack),
            }));
            riskTexts.push(...(structured.risks ?? []).map(r => r.description));
        } else {
            const legacy = milestonesFromLegacyMarkdown(planContent);
            if (legacy.milestones.length > 0) {
                planSource = 'legacy_markdown';
                milestones = legacy.milestones;
                legacyAppendix = legacy.appendix;
                legacyPreamble = legacy.preamble;
                riskTexts.push(...legacy.riskTexts);
                riskTexts.push(...legacy.appendix.risks.map(r => r.description));
            }
        }
    }

    // 2. Resolve prompt packs.
    const nativePackCount = milestones.reduce((n, m) => n + (m.promptPacks?.length ?? 0), 0);
    let packSource: ConsolidatedImplementationPlan['sources']['promptPacks'] = 'none';
    let unassignedPromptPacks: ImplementationPromptPack[] = [];

    if (nativePackCount > 0) {
        packSource = 'native';
    } else if (promptPackContent) {
        const { cards } = parsePromptPack(promptPackContent);
        if (cards.length > 0) {
            packSource = 'legacy_prompt_pack';
            const packs = cards.map(promptPackFromLegacyCard);
            const { attached, unassigned } = attachLegacyPacks(milestones, packs);
            milestones = milestones.map(m => {
                const extra = attached.get(m.id);
                return extra ? { ...m, promptPacks: [...(m.promptPacks ?? []), ...extra] } : m;
            });
            unassignedPromptPacks = unassigned;
        }
    }

    if (planSource === 'none' && packSource === 'none') return null;

    // 3. Quality gates: native global gates, plus gates derived from the
    //    plan-wide Definition of Done (fenced or legacy-markdown appendix) so
    //    legacy plans keep that content.
    const globalQualityGates: ImplementationQualityGate[] = [
        ...(structured?.globalQualityGates ?? []),
    ];
    const dodSource = structured?.definitionOfDone?.length
        ? structured.definitionOfDone
        : legacyAppendix?.definitionOfDone ?? [];
    if (globalQualityGates.length === 0 && dodSource.length) {
        dodSource.forEach((d, i) => {
            globalQualityGates.push(gateFromDoD(d, `gate-dod-${i + 1}`));
        });
    }

    const summary = deriveSummary(structured);
    // Legacy markdown-only plans carry their summary/architecture content in
    // the preamble + appendix — surface it instead of dropping it.
    if (legacyAppendix) {
        if (!summary.buildStrategy && legacyPreamble) summary.buildStrategy = legacyPreamble;
        if ((!summary.criticalPath || summary.criticalPath.length === 0) && legacyAppendix.criticalPath) {
            summary.criticalPath = [legacyAppendix.criticalPath];
        }
        if (!summary.teamAssumption && legacyAppendix.teamSize) summary.teamAssumption = legacyAppendix.teamSize;
        if ((!summary.stackSummary || summary.stackSummary.length === 0) && legacyAppendix.architecture.length) {
            summary.stackSummary = legacyAppendix.architecture.slice(0, 6);
        }
    }

    const readiness = deriveReadiness({
        planSource,
        packSource,
        milestones,
        unassignedCount: unassignedPromptPacks.length,
    });

    const risks: RiskItem[] = structured?.risks
        ?? (legacyAppendix?.risks.length
            ? legacyAppendix.risks
            : riskTexts.map(description => ({ description })));

    return {
        title: input.title ?? 'Implementation Plan',
        summary,
        readiness,
        milestones,
        unassignedPromptPacks,
        globalQualityGates,
        traceability: deriveTraceability(milestones),
        risks,
        architecture: structured?.architecture ?? legacyAppendix?.architecture ?? [],
        appendixNotes: legacyAppendix?.notes,
        sources: { plan: planSource, promptPacks: packSource },
    };
}

// --- Copy / export helpers -----------------------------------------------------

/** Compose the clipboard text for one prompt pack (prompt + context). */
export function promptPackToClipboardText(pack: ImplementationPromptPack): string {
    const parts: string[] = [pack.prompt.trim()];
    const extras: string[] = [];
    if (pack.acceptanceCriteria.length && !/acceptance criteria/i.test(pack.prompt)) {
        extras.push(`## Acceptance Criteria\n${pack.acceptanceCriteria.map(c => `- ${c}`).join('\n')}`);
    }
    if (pack.recommendedCommitMessage && !/commit/i.test(pack.prompt)) {
        extras.push(`## Commit Guidance\nSuggested commit message: ${pack.recommendedCommitMessage}`);
    }
    if (extras.length) parts.push('', ...extras);
    return parts.join('\n');
}

/** Render the consolidated plan back to a shareable markdown document. */
export function consolidatedPlanToMarkdown(plan: ConsolidatedImplementationPlan): string {
    const lines: string[] = [`# ${plan.title}`, ''];

    if (plan.summary.buildStrategy) lines.push(plan.summary.buildStrategy, '');
    if (plan.summary.stackSummary?.length) {
        lines.push('**Stack:**');
        plan.summary.stackSummary.forEach(s => lines.push(`- ${s}`));
        lines.push('');
    }
    if (plan.summary.criticalPath?.length) {
        lines.push(`**Critical Path:** ${plan.summary.criticalPath.join(' → ')}`, '');
    }
    if (plan.summary.estimatedEffort) lines.push(`**Estimated Effort:** ${plan.summary.estimatedEffort}`, '');
    if (plan.summary.teamAssumption) lines.push(`**Team Assumption:** ${plan.summary.teamAssumption}`, '');

    plan.milestones.forEach((m, i) => {
        lines.push(`## Milestone ${i + 1}: ${m.name}`);
        const meta: string[] = [];
        if (m.priority) meta.push(`Priority: ${m.priority}`);
        if (m.estimatedEffort ?? m.timeframe) meta.push(`Effort: ${m.estimatedEffort ?? m.timeframe}`);
        if (m.dependencies?.length) meta.push(`Depends on: ${m.dependencies.join(', ')}`);
        if (meta.length) lines.push(`_${meta.join(' · ')}_`);
        const objective = m.objective ?? m.goal;
        if (objective) lines.push('', `**Objective:** ${objective}`);
        if (m.tasks.length) {
            lines.push('', '**Tasks:**');
            m.tasks.forEach(t => lines.push(`- [${t.status === 'done' ? 'x' : ' '}] ${t.title}`));
        }
        for (const pack of m.promptPacks ?? []) {
            lines.push('', `### Prompt Pack: ${pack.title}`, '', '```', pack.prompt.trim(), '```');
        }
        if (m.qualityGates?.length) {
            lines.push('', '**Quality Gates:**');
            m.qualityGates.forEach(g => lines.push(`- [${g.required ? 'required' : 'optional'} · ${g.category}] ${g.title}`));
        }
        if (m.validationCommands?.length) {
            lines.push('', '**Validation Commands:**');
            m.validationCommands.forEach(c => lines.push(`- \`${c}\``));
        }
        if (m.definitionOfDone?.length) {
            lines.push('', '**Definition of Done:**');
            m.definitionOfDone.forEach(d => lines.push(`- [ ] ${d}`));
        }
        lines.push('');
    });

    if (plan.unassignedPromptPacks.length) {
        lines.push('## Unassigned Prompt Packs', '');
        for (const pack of plan.unassignedPromptPacks) {
            lines.push(`### ${pack.title}`, '', '```', pack.prompt.trim(), '```', '');
        }
    }
    if (plan.globalQualityGates.length) {
        lines.push('## Global Quality Gates', '');
        plan.globalQualityGates.forEach(g => lines.push(`- [${g.required ? 'required' : 'optional'} · ${g.category}] ${g.title}`));
        lines.push('');
    }
    if (plan.risks.length) {
        lines.push('## Risks', '');
        plan.risks.forEach(r => lines.push(`- ${r.description}${r.mitigation ? ` — Mitigation: ${r.mitigation}` : ''}`));
        lines.push('');
    }
    if (plan.appendixNotes) {
        lines.push('## Notes', '', plan.appendixNotes, '');
    }

    return lines.join('\n').trim() + '\n';
}

/** All prompt packs in build order (milestone order, then unassigned). */
export function collectAllPromptPacks(plan: ConsolidatedImplementationPlan): ImplementationPromptPack[] {
    return [
        ...plan.milestones.flatMap(m => m.promptPacks ?? []),
        ...plan.unassignedPromptPacks,
    ];
}
