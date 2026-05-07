export type FlowCategory =
    | 'Onboarding'
    | 'Auth & Identity'
    | 'Sharing & Collaboration'
    | 'Core Experience'
    | 'Other';

export type ParsedStep = {
    index: number;
    rawText: string;
    title?: string;
    userAction?: string;
    systemBehavior?: string;
    uiFeedback?: string;
    decisions: string[];
    apiRefs: string[];
    errorRefs: string[];
};

export type ParsedErrorPath = {
    text: string;
    linkedStepIndex?: number;
};

export type ParsedFlow = {
    title: string;
    category: FlowCategory;
    goal?: string;
    preconditions?: string;
    successOutcome?: string;
    edgeCases?: string;
    rest?: string;
    steps: ParsedStep[];
    errorPaths: ParsedErrorPath[];
    inferredEntryPoints: string[];
    inferredSystems: string[];
};

export type ViewMode = 'summary' | 'detailed' | 'debug';
