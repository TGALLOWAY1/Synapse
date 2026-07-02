/**
 * Convert an Implementation Plan into a flat list of `ImplementationTask`s.
 *
 * Two on-disk formats are supported (the parser auto-detects):
 *  - Structured JSON fence (current): one task per `milestones[].tasks[]` entry.
 *  - Legacy markdown: one task per `- [ ]` `Key Deliverable` checkbox.
 *
 * Acceptance criteria are derived deterministically (no LLM call):
 *  1. The task/deliverable text itself, rephrased as an observable criterion.
 *  2. Each line of the milestone's `Definition of Done` (legacy) or the
 *     plan-wide `definitionOfDone` array (structured).
 *  3. Title-derived fallbacks when neither yields anything.
 */

import type {
    ImplementationPlanMilestone,
    ImplementationPlanTask,
    StructuredImplementationPlan,
} from '../../types';
import type {
    ImplementationTask,
    TaskComplexity,
    TaskPriority,
    TaskType,
} from '../../types/tasks';
import {
    extractStructuredPlan,
    findSection,
    parseImplementationPlan,
    parseMilestoneBody,
    type ParsedPlan,
} from './implementationPlanParser';

interface ExtractContext {
    sourceArtifactId: string;
}

const TYPE_KEYWORDS: Array<{ type: TaskType; pattern: RegExp }> = [
    { type: 'design', pattern: /\b(design|figma|wireframe|mockup|ux|ui kit|brand|visual|prototype)\b/i },
    { type: 'frontend', pattern: /\b(frontend|front-end|component|ui|page|screen|view|button|modal|tailwind|react|css|client|browser)\b/i },
    { type: 'backend', pattern: /\b(backend|back-end|api|endpoint|server|service|controller|handler|graphql|rest|webhook)\b/i },
    { type: 'data', pattern: /\b(database|schema|migration|table|model|sql|orm|index|query|seed|etl|warehouse)\b/i },
    { type: 'infra', pattern: /\b(infra|infrastructure|deploy|deployment|ci\/cd|pipeline|terraform|cloud|aws|gcp|kubernetes|docker|monitoring|observability|logging)\b/i },
    { type: 'qa', pattern: /\b(test|testing|qa|coverage|e2e|integration test|unit test|playwright|vitest|jest)\b/i },
    { type: 'docs', pattern: /\b(docs|documentation|readme|guide|tutorial|changelog)\b/i },
];

function inferTaskType(text: string): TaskType | undefined {
    for (const { type, pattern } of TYPE_KEYWORDS) {
        if (pattern.test(text)) return type;
    }
    return undefined;
}

function inferPriority(milestoneIndex: number, totalMilestones: number): TaskPriority {
    if (milestoneIndex === 0) return 'high';
    if (milestoneIndex >= totalMilestones - 1) return 'medium';
    return milestoneIndex < totalMilestones / 2 ? 'high' : 'medium';
}

function inferComplexity(text: string): TaskComplexity {
    const wordCount = text.trim().split(/\s+/).length;
    if (wordCount <= 6) return 'small';
    if (wordCount <= 14) return 'medium';
    return 'large';
}

function splitIntoLines(text: string | undefined): string[] {
    if (!text) return [];
    return text
        .split(/\n+/)
        .map(line => line.replace(/^\s*[-*]\s*/, '').replace(/^\s*\[\s*[ xX]\s*\]\s*/, '').trim())
        .filter(Boolean);
}

function inferDependencies(text: string | undefined): string[] {
    const lines = splitIntoLines(text);
    return lines
        .flatMap(line =>
            line
                .split(/[,;]|\band\b/i)
                .map(s => s.trim())
                .filter(Boolean),
        )
        .map(s => s.replace(/^Milestone\s+/i, 'M'))
        .filter(Boolean);
}

function fallbackCriteria(title: string): string[] {
    const trimmedTitle = title.replace(/\.$/, '');
    return [
        `${trimmedTitle} is implemented and merged to the main branch.`,
        `Code paths exercised by ${trimmedTitle} are covered by automated tests.`,
        `Behavior is verifiable by running the app locally and exercising the relevant flow.`,
    ];
}

function buildAcceptanceCriteria(
    deliverableText: string,
    definitionOfDone: string | undefined,
    keyDeliverables: string[],
): string[] {
    const criteria: string[] = [];
    const seen = new Set<string>();
    const push = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        criteria.push(trimmed);
    };

    push(asObservableCriterion(deliverableText));

    for (const line of splitIntoLines(definitionOfDone)) {
        push(line);
    }

    // If there are any siblings on the same milestone that look directly
    // relevant (share keywords with this deliverable), include them as
    // implicit context-criteria. Skip identical ones.
    for (const sibling of keyDeliverables) {
        if (sibling.trim().toLowerCase() === deliverableText.trim().toLowerCase()) continue;
        if (sharesKeyword(sibling, deliverableText)) {
            push(asObservableCriterion(sibling));
        }
    }

    if (criteria.length < 2) {
        for (const fallback of fallbackCriteria(deliverableText)) {
            push(fallback);
        }
    }

    return criteria;
}

const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'is', 'are', 'be', 'with', 'for', 'of',
    'to', 'in', 'on', 'at', 'by', 'from', 'as', 'this', 'that', 'these',
    'those', 'it', 'its', 'into', 'across',
]);

function sharesKeyword(a: string, b: string): boolean {
    const ta = tokenize(a);
    const tb = new Set(tokenize(b));
    return ta.some(token => tb.has(token));
}

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(token => token.length > 3 && !STOPWORDS.has(token));
}

function asObservableCriterion(deliverable: string): string {
    const trimmed = deliverable.trim().replace(/[.;]+$/, '');
    if (!trimmed) return '';
    if (/\b(displays?|shows?|renders?|returns?|logs?|emits?|persists?|stores?|sends?|exposes?|prevents?|allows?|enables?|disables?|opens?|closes?|navigates?)\b/i.test(trimmed)) {
        return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
    }
    return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)} is delivered and verifiable in the running app.`;
}

function buildSummary(
    deliverableText: string,
    milestoneTitle: string,
    goal: string | undefined,
    technicalApproach: string | undefined,
): string {
    const parts: string[] = [];
    parts.push(`From milestone "${milestoneTitle}".`);
    if (goal) parts.push(`Milestone goal: ${oneLine(goal)}`);
    parts.push(`Deliverable: ${deliverableText}`);
    if (technicalApproach) parts.push(`Approach: ${oneLine(technicalApproach)}`);
    return parts.join(' ');
}

function oneLine(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function buildLabels(taskType: TaskType | undefined, milestoneId: number): string[] {
    const labels: string[] = [`milestone-${milestoneId}`, 'synapse'];
    if (taskType) labels.push(taskType);
    return labels;
}

function makeTaskId(milestoneId: number, deliverableIndex: number): string {
    return `m${milestoneId}-d${deliverableIndex + 1}`;
}

export interface ExtractTasksOptions {
    /** Override task ID generation (useful for tests / deterministic output). */
    idGenerator?: (milestoneId: number, deliverableIndex: number) => string;
}

export function extractTasks(
    plan: ParsedPlan,
    context: ExtractContext,
    options: ExtractTasksOptions = {},
): ImplementationTask[] {
    const tasks: ImplementationTask[] = [];
    const idGen = options.idGenerator ?? makeTaskId;
    const totalMilestones = plan.milestones.length;

    plan.milestones.forEach((milestone, milestoneIndex) => {
        const details = parseMilestoneBody(milestone.body);
        const goal = findSection(details, 'Goal');
        const technicalApproach = findSection(details, 'Technical Approach');
        const definitionOfDone = findSection(details, 'Definition of Done');
        const dependenciesText = findSection(details, 'Dependencies');
        const dependencies = inferDependencies(dependenciesText);
        const risks = findSection(details, 'Risks');

        const deliverableTexts = details.deliverables.map(d => d.text);

        details.deliverables.forEach((deliverable, deliverableIndex) => {
            const titleSeed = deliverable.text;
            const haystack = `${titleSeed} ${goal ?? ''} ${technicalApproach ?? ''}`;
            const taskType = inferTaskType(haystack);
            const priority = inferPriority(milestoneIndex, totalMilestones);
            const complexity = inferComplexity(titleSeed);
            const acceptanceCriteria = buildAcceptanceCriteria(
                deliverable.text,
                definitionOfDone,
                deliverableTexts,
            );
            const implementationNotes: string[] = [];
            if (technicalApproach) implementationNotes.push(`Technical approach: ${oneLine(technicalApproach)}`);
            if (risks) implementationNotes.push(`Risks: ${oneLine(risks)}`);

            tasks.push({
                id: idGen(milestone.id, deliverableIndex),
                title: humanizeTitle(deliverable.text),
                summary: buildSummary(deliverable.text, milestone.title, goal, technicalApproach),
                sourceArtifactId: context.sourceArtifactId,
                sourceSectionId: `milestone-${milestone.id}`,
                priority,
                taskType,
                estimatedComplexity: complexity,
                dependencies: dependencies.length ? dependencies : undefined,
                acceptanceCriteria,
                implementationNotes: implementationNotes.length ? implementationNotes : undefined,
                suggestedLabels: buildLabels(taskType, milestone.id),
            });
        });
    });

    return tasks;
}

function humanizeTitle(text: string): string {
    const cleaned = text.replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '');
    if (!cleaned) return 'Untitled task';
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

// --- Structured-plan extraction (preferred when artifact has JSON fence) ---

function buildLinkedNotes(task: ImplementationPlanTask): string[] {
    const notes: string[] = [];
    const links = task.linkedArtifacts;
    if (!links) return notes;
    if (links.prd?.length) notes.push(`Linked PRD features: ${links.prd.join(', ')}`);
    if (links.dataModel?.length) notes.push(`Linked data entities: ${links.dataModel.join(', ')}`);
    if (links.mockups?.length) notes.push(`Linked mockup screens: ${links.mockups.join(', ')}`);
    return notes;
}

export function extractTasksFromStructuredPlan(
    plan: StructuredImplementationPlan,
    context: ExtractContext,
): ImplementationTask[] {
    const titleById = new Map<string, string>();
    for (const m of plan.milestones) {
        for (const t of m.tasks) titleById.set(t.id, t.title);
    }
    const totalMilestones = plan.milestones.length;
    const planDoD = plan.definitionOfDone ?? [];
    const out: ImplementationTask[] = [];

    plan.milestones.forEach((milestone: ImplementationPlanMilestone, milestoneIndex) => {
        const milestoneNumericId = milestoneIndex + 1;
        // Consolidated plans carry a per-milestone Definition of Done — the
        // tighter criteria source; fall back to the plan-wide list.
        const dodSource = milestone.definitionOfDone?.length ? milestone.definitionOfDone : planDoD;
        milestone.tasks.forEach(task => {
            const haystack = `${task.title} ${task.description ?? ''} ${milestone.goal ?? ''}`;
            const taskType = inferTaskType(haystack);
            const priority = inferPriority(milestoneIndex, totalMilestones);
            const complexity = inferComplexity(task.title);

            const acceptanceCriteria = buildAcceptanceCriteria(
                task.title,
                dodSource.length ? dodSource.join('\n') : undefined,
                milestone.tasks.map(t => t.title),
            );

            const implementationNotes: string[] = [];
            if (task.description) implementationNotes.push(oneLine(task.description));
            implementationNotes.push(...buildLinkedNotes(task));

            const dependencies = (task.dependencies ?? [])
                .map(id => titleById.get(id) ?? id)
                .filter(Boolean);

            out.push({
                id: task.id,
                title: humanizeTitle(task.title),
                summary: buildSummary(task.title, milestone.name, milestone.goal, task.description),
                sourceArtifactId: context.sourceArtifactId,
                sourceSectionId: `milestone-${milestoneNumericId}`,
                priority,
                taskType,
                estimatedComplexity: complexity,
                dependencies: dependencies.length ? dependencies : undefined,
                acceptanceCriteria,
                implementationNotes: implementationNotes.length ? implementationNotes : undefined,
                suggestedLabels: buildLabels(taskType, milestoneNumericId),
            });
        });
    });

    return out;
}

/**
 * Single entry-point that auto-detects the artifact's storage format and
 * returns a flat `ImplementationTask[]`. Prefer this in callers that hold
 * the raw artifact `content` string — it removes the need to know which
 * shape the artifact is in.
 */
export function extractTasksFromMarkdown(
    markdown: string,
    context: ExtractContext,
    options: ExtractTasksOptions = {},
): ImplementationTask[] {
    const structured = extractStructuredPlan(markdown);
    if (structured) {
        return extractTasksFromStructuredPlan(structured, context);
    }
    return extractTasks(parseImplementationPlan(markdown), context, options);
}
