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

/**
 * API endpoint contract spec for the data_model prompt. Every generated
 * endpoint must be an implementable contract, not a route listing — each
 * field below mirrors `ApiEndpointContract` (src/types) and the
 * `dataModelSchema.apiEndpoints` response schema. Kept as a shared fragment
 * (not inlined in coreArtifactService) so the requirement text has one
 * source; `src/lib/apiContractCompleteness.ts` scores the same field set on
 * read.
 */
export const API_ENDPOINT_CONTRACT_SPEC = `Top-level apiEndpoints: REQUIRED. Each endpoint is a full, implementable API contract — not a bare route listing. Per endpoint:

- method, path, description, entity: existing fields. entity MUST name one of the entities defined above.
- auth: { authentication, authorization }. authentication states how the caller is identified (e.g. "Bearer JWT required", "none (public)"); authorization states WHO may call it and the ownership/role rule enforced (e.g. "Playlist owner only", "Any authenticated user").
- requestSchema: compact single-line shape of the request body/query using the entity's exact field names (e.g. "{ joy_score: Float, energy_level: Float }"); use "none" when the endpoint takes no input beyond the path.
- responseSchema: compact single-line shape of the success response body using entity field names; use "none" for empty (204) responses.
- errors: the realistic failure cases as "STATUS — when it occurs" strings (e.g. "404 — snapshot does not exist", "422 — scores outside 0-1"). Include auth and not-found/validation cases where applicable.
- pagination: the pagination contract for list endpoints (e.g. "cursor-based, limit max 100"); "none" for single-resource endpoints.
- idempotency: whether/how repeat calls are safe (e.g. "safe (GET)", "idempotent (PUT by id)", "not idempotent — creates a new record per call").
- rateLimit: an appropriate limit for the endpoint's sensitivity (e.g. "60/min per user").
- requirementIds: the canonical PRD feature ids (e.g. "f1", "f3") this endpoint serves, drawn from the Canonical Feature Glossary in the user prompt — the same id vocabulary as entity featureRefs. Use ONLY ids that appear in the glossary; never invent one. Every endpoint must serve at least one feature.
- tests: 2-4 concrete acceptance checks a developer can turn into integration tests (happy path plus the most important error case).`;
