// Builds a single "build handoff" document tailored for a coding agent
// (Claude Code, Cursor, etc.): an instruction preamble followed by the PRD
// and the build-relevant artifacts. Distinct from the plain full bundle —
// the preamble tells the agent how to use the material.

export interface HandoffArtifact {
    subtype: string;
    title: string;
    content: string;
}

export interface HandoffInput {
    projectName: string;
    prdMarkdown?: string;
    /** Core artifacts in display order; mockups are intentionally excluded. */
    artifacts: HandoffArtifact[];
    /**
     * Pre-rendered export-manifest markdown (see exportManifest.ts). Emitted
     * right after the preamble so the agent sees which versions it holds and
     * whether anything was stale at export time.
     */
    manifestMarkdown?: string;
    /** True when the current working plan has not been committed. */
    exploratory?: boolean;
}

const PREAMBLE = (projectName: string) =>
    `# ${projectName} — Build Handoff

You are an expert software engineer. Build the product specified below.

How to use this document:
- Treat the **Product Requirements** as the source of truth for scope and behavior.
- Follow the **Implementation Plan** for milestone order; ship in small, reviewable commits.
- Use the **Prompt Pack** as ready-made prompts for individual build steps.
- Honor the **Data Model** and **Design System** where present.
- Ask before any destructive or irreversible action. Confirm assumptions that aren't pinned down here rather than guessing silently.
`;

/**
 * Compose the handoff markdown. Sections are emitted only when their content
 * is non-empty, so a partial project still produces a coherent document.
 */
export function buildAgentHandoff(input: HandoffInput): string {
    const { projectName, prdMarkdown, artifacts, manifestMarkdown, exploratory } = input;
    const parts: string[] = [PREAMBLE(projectName || 'This product')];

    if (exploratory) {
        parts.push('> **Exploratory handoff:** This working plan has not been committed as implementation-ready. Validate unresolved assumptions and decisions before building.\n\n---\n');
    }

    if (manifestMarkdown && manifestMarkdown.trim()) {
        parts.push(manifestMarkdown.trim(), '\n---\n');
    }

    if (prdMarkdown && prdMarkdown.trim()) {
        parts.push('## Product Requirements\n', prdMarkdown.trim(), '\n---\n');
    }

    for (const artifact of artifacts) {
        if (!artifact.content || !artifact.content.trim()) continue;
        parts.push(`## ${artifact.title}\n`, artifact.content.trim(), '\n---\n');
    }

    return parts.join('\n');
}
