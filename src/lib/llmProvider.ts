// Barrel re-exports — all consumers continue importing from this path
export { callGeminiStream, type StreamCallbacks, type ProviderOptions } from './geminiClient';
export { consolidateBranch, replyInBranch, type ConsolidationResult, type ConsolidationScope } from './services/branchService';
export { generateStructuredPRD, structuredPRDToMarkdown, enhancePrompt } from './services/prdService';
export {
    generatePreflightQuestions,
    generatePreflightSummary,
    type PreflightQuestionsResult,
    type PreflightSummaryResult,
} from './services/preflightService';
export type { PreflightContext } from './prompts/preflightPrompts';
export { toPreflightContext } from './prompts/preflightPrompts';
export { generateMockup, type ParseResult as MockupParseResult } from './services/mockupService';
export { generateCoreArtifact } from './services/coreArtifactService';
