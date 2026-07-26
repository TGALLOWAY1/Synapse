export function isAbortError(reason: unknown): boolean {
    return reason instanceof DOMException && reason.name === 'AbortError';
}
