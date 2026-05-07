import type { ParsedErrorPath, ParsedFlow, ParsedStep } from './types';
import { categorize } from './categorize';

type RawSection = {
    goal?: string;
    preconditions?: string;
    stepsBlock?: string;
    successOutcome?: string;
    errorPaths?: string;
    edgeCases?: string;
    rest?: string;
};

const SECTION_LABELS: Array<[keyof RawSection, RegExp]> = [
    ['goal', /^\*\*Goal:\*\*\s*/i],
    ['preconditions', /^\*\*Preconditions:\*\*\s*/i],
    ['stepsBlock', /^\*\*Steps:\*\*\s*/i],
    ['successOutcome', /^\*\*Success Outcome:\*\*\s*/i],
    ['errorPaths', /^\*\*Error Paths:\*\*\s*/i],
    ['edgeCases', /^\*\*Edge Cases:\*\*\s*/i],
];

type RawFlow = RawSection & { title: string };

function splitFlows(markdown: string): RawFlow[] {
    const flows: RawFlow[] = [];
    let current: RawFlow | null = null;
    let bufferKey: keyof RawSection | null = null;
    let bufferLines: string[] = [];

    const flush = () => {
        if (!current || bufferKey === null) {
            bufferKey = null;
            bufferLines = [];
            return;
        }
        const text = bufferLines.join('\n').trim();
        (current as Record<string, string>)[bufferKey as string] = text;
        bufferKey = null;
        bufferLines = [];
    };

    for (const line of markdown.split('\n')) {
        const headingMatch = line.match(/^#{1,4}\s+Flow:\s*(.+?)\s*$/i);
        if (headingMatch) {
            if (current) {
                flush();
                flows.push(current);
            }
            current = { title: headingMatch[1] };
            bufferKey = null;
            bufferLines = [];
            continue;
        }
        if (!current) continue;
        let matched: keyof RawSection | null = null;
        for (const [key, re] of SECTION_LABELS) {
            if (re.test(line)) {
                matched = key;
                flush();
                bufferKey = key;
                bufferLines = [line.replace(re, '')];
                break;
            }
        }
        if (matched) continue;
        bufferLines.push(line);
    }
    if (current) {
        flush();
        flows.push(current);
    }
    return flows;
}

const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'is', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'if', 'then', 'else', 'when', 'while',
    'this', 'that', 'these', 'those', 'it', 'its', 'be', 'been', 'are', 'was',
    'user', 'users', 'system', 'app', 'application', 'screen', 'page', 'view',
    'step', 'steps', 'go', 'goes', 'click', 'clicks', 'tap', 'taps',
]);

function tokenize(text: string): Set<string> {
    const out = new Set<string>();
    for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
        if (raw.length < 3) continue;
        if (STOPWORDS.has(raw)) continue;
        out.add(raw);
    }
    return out;
}

function intersectSize(a: Set<string>, b: Set<string>): number {
    let n = 0;
    for (const t of a) if (b.has(t)) n++;
    return n;
}

function parseStepsBlock(block: string): ParsedStep[] {
    type Raw = { rawLine: string; subs: string[] };
    const groups: Raw[] = [];
    let active: Raw | null = null;

    for (const line of block.split('\n')) {
        const top = line.match(/^\s*(\d+)\.\s+(.*)$/);
        if (top) {
            if (active) groups.push(active);
            active = { rawLine: top[2], subs: [] };
            continue;
        }
        const sub = line.match(/^\s+[-*]\s+(.*)$/);
        if (sub && active) {
            active.subs.push(sub[1]);
            continue;
        }
        if (active && line.trim().length > 0) {
            active.rawLine += ' ' + line.trim();
        }
    }
    if (active) groups.push(active);

    return groups.map((g, i) => parseStep(i, g.rawLine, g.subs));
}

function parseStep(index: number, rawLine: string, subs: string[]): ParsedStep {
    const decisions: string[] = [];
    const errorRefs: string[] = [];
    const apiRefs: string[] = [];
    let uiFeedback: string | undefined;

    for (const subRaw of subs) {
        const sub = subRaw.trim();
        const decisionMatch = sub.match(/^\*\*Decision:\*\*\s*(.+)$/i)
            ?? sub.match(/^Decision:\s*(.+)$/i);
        if (decisionMatch) {
            decisions.push(decisionMatch[1]);
            continue;
        }
        if (/^\s*If\s+/i.test(sub) && /(then|→|->|else|otherwise)/i.test(sub)) {
            decisions.push(sub);
            continue;
        }
        if (/\b(error|fail(ed|ure|s)?|fallback|retry|timeout|denied|blocked)\b/i.test(sub)) {
            errorRefs.push(sub);
            continue;
        }
        if (/^(UI:|Feedback:|Displays?:)/i.test(sub) || /\b(displays?|shows?|spinner|toast|loading|progress)\b/i.test(sub)) {
            uiFeedback = uiFeedback ? `${uiFeedback}; ${sub}` : sub;
            continue;
        }
        // unclassified sub-bullet — attach to decisions if it looks like a flow branch,
        // otherwise drop into errorRefs only if explicit, otherwise leave alone.
    }

    // backtick-wrapped tokens are likely API/service refs
    const backtickRe = /`([^`]+)`/g;
    const seen = new Set<string>();
    const collect = (s: string) => {
        let m: RegExpExecArray | null;
        while ((m = backtickRe.exec(s)) !== null) {
            const v = m[1].trim();
            if (v.length > 0 && !seen.has(v)) {
                seen.add(v);
                apiRefs.push(v);
            }
        }
    };
    collect(rawLine);
    for (const sub of subs) collect(sub);

    // "[Screen Name] — User action → System response"  per generation prompt
    let title: string | undefined;
    let userAction: string | undefined;
    let systemBehavior: string | undefined;

    const bracket = rawLine.match(/^\s*\[(.+?)\]\s*[—-]\s*(.+)$/);
    let actionAndSystem: string | undefined;
    if (bracket) {
        title = bracket[1].trim();
        actionAndSystem = bracket[2];
    } else {
        // fall back: title = text up to the first em-dash, action = the rest
        const dashSplit = rawLine.split(/\s+[—–-]\s+/);
        if (dashSplit.length >= 2) {
            title = dashSplit[0].trim();
            actionAndSystem = dashSplit.slice(1).join(' — ');
        } else {
            actionAndSystem = rawLine;
        }
    }

    if (actionAndSystem) {
        const arrowSplit = actionAndSystem.split(/\s*(?:→|->|⇒)\s*/);
        if (arrowSplit.length >= 2) {
            userAction = arrowSplit[0].trim();
            systemBehavior = arrowSplit.slice(1).join(' → ').trim();
        } else {
            userAction = actionAndSystem.trim();
        }
    }

    if (!title || title.length === 0) title = undefined;
    if (userAction && userAction.length === 0) userAction = undefined;
    if (systemBehavior && systemBehavior.length === 0) systemBehavior = undefined;

    return {
        index,
        rawText: rawLine,
        title,
        userAction,
        systemBehavior,
        uiFeedback,
        decisions,
        apiRefs,
        errorRefs,
    };
}

function parseErrorPaths(block: string, steps: ParsedStep[]): ParsedErrorPath[] {
    const lines = block
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
    const items: string[] = [];
    let buffer = '';
    for (const line of lines) {
        if (/^[-*]\s+/.test(line)) {
            if (buffer) items.push(buffer);
            buffer = line.replace(/^[-*]\s+/, '');
        } else if (buffer) {
            buffer += ' ' + line;
        } else {
            items.push(line);
        }
    }
    if (buffer) items.push(buffer);

    return items.map(text => ({
        text,
        linkedStepIndex: linkErrorToStep(text, steps),
    }));
}

function linkErrorToStep(text: string, steps: ParsedStep[]): number | undefined {
    const stepNumber = text.match(/\bstep\s+(\d+)\b/i);
    if (stepNumber) {
        const n = Number(stepNumber[1]) - 1;
        if (n >= 0 && n < steps.length) return n;
    }
    const errTokens = tokenize(text);
    if (errTokens.size === 0) return undefined;
    let bestIdx: number | undefined;
    let bestScore = 1; // need >= 2 to count
    for (const step of steps) {
        const stepText = `${step.title ?? ''} ${step.userAction ?? ''} ${step.systemBehavior ?? ''}`;
        const stepTokens = tokenize(stepText);
        const score = intersectSize(errTokens, stepTokens);
        if (score > bestScore) {
            bestScore = score;
            bestIdx = step.index;
        }
    }
    return bestIdx;
}

function parseEntryPoints(preconditions?: string): string[] {
    if (!preconditions) return [];
    const out: string[] = [];
    for (const line of preconditions.split('\n')) {
        const trimmed = line.trim().replace(/^[-*]\s+/, '');
        if (trimmed.length === 0) continue;
        out.push(trimmed);
    }
    return out;
}

function parseInferredSystems(steps: ParsedStep[]): string[] {
    const seen = new Set<string>();
    for (const step of steps) {
        for (const ref of step.apiRefs) {
            if (!seen.has(ref)) seen.add(ref);
        }
    }
    return Array.from(seen);
}

export function parseFlows(markdown: string): ParsedFlow[] {
    const raw = splitFlows(markdown);
    return raw.map(r => {
        const steps = r.stepsBlock ? parseStepsBlock(r.stepsBlock) : [];
        const errorPaths = r.errorPaths ? parseErrorPaths(r.errorPaths, steps) : [];
        const inferredEntryPoints = parseEntryPoints(r.preconditions);
        const inferredSystems = parseInferredSystems(steps);
        return {
            title: r.title,
            category: categorize(r.title, r.goal),
            goal: r.goal,
            preconditions: r.preconditions,
            successOutcome: r.successOutcome,
            edgeCases: r.edgeCases,
            rest: r.rest,
            steps,
            errorPaths,
            inferredEntryPoints,
            inferredSystems,
        };
    });
}
