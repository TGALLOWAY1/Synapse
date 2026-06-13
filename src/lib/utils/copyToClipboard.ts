/**
 * Copy text to the clipboard, returning whether it succeeded. Uses the async
 * Clipboard API when available (requires a secure context + user gesture) and
 * falls back to a hidden `<textarea>` + `execCommand('copy')` for older or
 * non-secure contexts. Never throws — callers branch on the boolean.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // Fall through to the legacy path (e.g. permission denied, insecure context).
    }

    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
    } catch {
        return false;
    }
}
