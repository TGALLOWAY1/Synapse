/**
 * Pure parser for legacy `prompt_pack` artifact markdown.
 *
 * Extracted from `PromptPackRenderer` (which still renders legacy artifacts
 * with it) so the implementation-plan adapter can turn old Developer Prompts
 * into consolidated prompt packs without duplicating the parsing rules.
 *
 * The conventional shape (from `coreArtifactService.ts`):
 *
 *   ### N. Prompt Title
 *   **Category:** UI Implementation | Testing | ...
 *   **Prompt:**
 *   ```
 *   <the copyable prompt body>
 *   ```
 *   **Expected Output:** one-line summary
 */

export type PromptCard = {
    index: number;
    title: string;
    category?: string;
    promptBody: string;
    expected?: string;
};

const PROMPT_HEADING = /^###\s+(\d+)\.?\s+(.+?)\s*$/;

export function parsePromptPack(markdown: string): { preamble: string; cards: PromptCard[] } {
    const lines = markdown.split('\n');
    const preambleLines: string[] = [];
    const cards: PromptCard[] = [];
    let active: { rawLines: string[]; index: number; title: string } | null = null;
    let inMilestones = false;

    for (const line of lines) {
        const heading = line.match(PROMPT_HEADING);
        if (heading) {
            if (active) cards.push(buildCard(active));
            active = { rawLines: [], index: Number(heading[1]), title: heading[2] };
            inMilestones = true;
            continue;
        }
        if (active) {
            active.rawLines.push(line);
        } else if (!inMilestones) {
            preambleLines.push(line);
        }
    }
    if (active) cards.push(buildCard(active));
    return { preamble: preambleLines.join('\n').trim(), cards };
}

function buildCard(active: { rawLines: string[]; index: number; title: string }): PromptCard {
    const card: PromptCard = {
        index: active.index,
        title: active.title,
        promptBody: '',
    };
    let inFence = false;
    const promptLines: string[] = [];
    let collectExpected = false;
    const expectedLines: string[] = [];

    for (const line of active.rawLines) {
        if (/^```/.test(line.trim())) {
            inFence = !inFence;
            continue;
        }
        if (inFence) {
            promptLines.push(line);
            continue;
        }
        const cat = line.match(/^\*\*Category:\*\*\s*(.+)$/i);
        if (cat) {
            card.category = cat[1].trim();
            continue;
        }
        const exp = line.match(/^\*\*Expected Output:\*\*\s*(.*)$/i);
        if (exp) {
            collectExpected = true;
            if (exp[1].trim()) expectedLines.push(exp[1].trim());
            continue;
        }
        if (collectExpected) {
            expectedLines.push(line);
        }
    }
    card.promptBody = promptLines.join('\n').trim();
    if (expectedLines.length > 0) {
        card.expected = expectedLines.join('\n').trim();
    }
    return card;
}
