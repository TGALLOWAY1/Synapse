// Shared instruction fragments for the core-artifact system prompts
// (CORE_ARTIFACT_PROMPTS in coreArtifactService.ts). Task prompts must
// reference these instead of restating them inline.

/** Standard artifact-generation role preamble: "You are a {role} …". */
export const artifactRole = (role: string): string =>
    `You are a ${role} producing production-grade artifacts for engineering teams.`;

/**
 * Generated developer prompts must not name or assume a specific coding
 * agent (see the CLAUDE.md rule for prompt packs / implementation plans).
 */
export const AGENT_AGNOSTIC_RULE =
    'The prompts MUST be agent-agnostic — never name, recommend, or assume a specific tool (e.g. Cursor, Claude Code, ChatGPT, Copilot).';

/** Suppress conversational lead-ins on markdown (non-JSON-mode) artifacts. */
export const ANTI_PREAMBLE_RULE =
    'Begin your response directly with the first section heading. Do NOT include any preamble, introduction, or conversational text (e.g. "Of course", "Here are", "As a UX expert").';
