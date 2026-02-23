export type Project = {
    id: string;
    name: string;
    createdAt: number;
};

export type SpineVersion = {
    id: string; // e.g. "v1", "v2"
    projectId: string;
    promptText: string;
    responseText: string;
    createdAt: number;
    isLatest: boolean;
    isFinal: boolean;
};

export type HistoryEvent = {
    id: string;
    projectId: string;
    spineVersionId: string;
    type: "Init" | "Regenerated" | "Consolidated";
    description: string;
    diff?: {
        matchMode?: "exact" | "word";
        matchCount?: number;
        matches: { before: string, after: string }[];
        sampleText?: string;
    };
    createdAt: number;
};
