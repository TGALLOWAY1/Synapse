// Barrel re-exports — all consumers continue importing from this path
export { callGeminiStream, type StreamCallbacks, type ProviderOptions } from './geminiClient';
export { consolidateBranch, replyInBranch, type ConsolidationResult, type ConsolidationScope } from './services/branchService';
export { generateStructuredPRD, structuredPRDToMarkdown, enhancePrompt } from './services/prdService';
export { generateMockup, type ParseResult as MockupParseResult } from './services/mockupService';
export { generateCoreArtifact, refineCoreArtifact } from './services/coreArtifactService';
export { generateMarkupImage } from './services/markupImageService';
