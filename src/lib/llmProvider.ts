// Simple mock provider for S2 testing
// In later slices this can be swapped for an actual Ollama / OpenAI fetch call

export interface ProviderOptions {
    onStatus?: (status: string) => void;
}

export const generatePRD = async (promptText: string, options?: ProviderOptions): Promise<string> => {
    options?.onStatus?.("Analyzing prompt...");
    await new Promise(r => setTimeout(r, 800));

    options?.onStatus?.("Structuring PRD...");
    await new Promise(r => setTimeout(r, 1000));

    options?.onStatus?.("Drafting content...");
    await new Promise(r => setTimeout(r, 1200));

    return `# Product Requirements Document
  
## 1. Overview
This PRD outlines the requirements for a system guided by the following user prompt:
> ${promptText}

## 2. Goals
- Build a minimal viable product (MVP) based on the input text.
- Establish core user flows and data models.
- Provide a responsive, accessible user interface.

## 3. Scope
The application will include basic CRUD operations, user authentication (if implied), and necessary business logic to fulfill primary use cases. Advanced features like predictive analytics or deep integrations are deferred to V2.

## 4. Technical Approach
- frontend: React, TailwindCSS, Vite
- backend: Node.js (assumed unless specified)
- database: Postgres (assumed unless specified)

## 5. Next Steps
- Review this PRD.
- Highlight specific words to request clarification or alternatives.
- Approve final architecture before implementation begins.
`;
};

export interface ConsolidationResult {
    localPatch: string; // Just a mock replacement string for S4
    docWidePatch: string; // The fully rewritten document mock
}

export const consolidateBranch = async (
    spineText: string,
    branch: { anchorText: string }
): Promise<ConsolidationResult> => {
    // Mock consolidation logic for S4 testing
    await new Promise(r => setTimeout(r, 1500));

    return {
        localPatch: `[Consolidated Local]: ${branch.anchorText} -> Based on thread intent`,
        docWidePatch: spineText.replace(
            branch.anchorText,
            `[Consolidated Local]: ${branch.anchorText} -> Based on thread intent\n[Consolidated Doc-Wide]: Structural changes applied based on thread context.`
        )
    };
};

export const replyInBranch = async (
    context: { anchorText: string, intent: string, threadHistory: unknown[] }
): Promise<string> => {
    // Mock reply for future slices
    await new Promise(r => setTimeout(r, 1000));
    return `This is a mock response addressing your intent to **${context.intent}** regarding the text "${context.anchorText}".`;
};
