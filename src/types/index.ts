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
