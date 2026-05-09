/**
 * Trigger a browser download for a string of in-memory content.
 *
 * Lifted out of `ExportModal.tsx` so it can be reused by
 * `taskExport/markdownExporter.ts` (and any other client-side exporter
 * that wants to drop a file on the user's disk).
 */
export function downloadFile(
    content: string,
    filename: string,
    mimeType: string = 'text/markdown',
): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
