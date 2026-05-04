/**
 * Best-effort repair of a truncated JSON document.
 *
 * Gemini JSON-mode responses occasionally exceed maxOutputTokens and the
 * stream ends mid-string, leaving an unparseable payload (e.g. an open
 * string with no closing quote, then no closing brackets for the surrounding
 * arrays/objects). Rather than throw the whole partial PRD away, we try to
 * close it: terminate the open string, drop any dangling key/colon/comma,
 * and emit the missing closing brackets in proper LIFO order.
 *
 * This is a salvage path — the resulting JSON is still missing the content
 * the model didn't get to write. Callers should treat repaired output as
 * "use what you have, but warn the user" rather than as success.
 */

interface RepairResult {
    text: string;
    repaired: boolean;
}

const isWhitespace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

/** Walk back over trailing whitespace, returning the index of the last
 *  non-whitespace character, or -1 if none. */
const lastNonWhitespaceIndex = (s: string): number => {
    for (let i = s.length - 1; i >= 0; i--) {
        if (!isWhitespace(s[i])) return i;
    }
    return -1;
};

/**
 * Attempt to repair a truncated JSON string so it parses. Returns the
 * possibly-modified text plus a flag indicating whether any repair was
 * needed. If `JSON.parse(text)` already succeeds, the input is returned
 * unchanged with `repaired: false`.
 */
export const repairTruncatedJson = (input: string): RepairResult => {
    if (!input) return { text: input, repaired: false };

    try {
        JSON.parse(input);
        return { text: input, repaired: false };
    } catch {
        // fall through to repair
    }

    // First pass: walk the input tracking string state and bracket depth.
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
        } else if (ch === '{') {
            stack.push('}');
        } else if (ch === '[') {
            stack.push(']');
        } else if (ch === '}' || ch === ']') {
            stack.pop();
        }
    }

    let text = input;

    // 1. Close an unterminated string. If the last char was a backslash
    //    inside a string, drop it so we don't escape the closing quote.
    if (inString) {
        if (escaped) text = text.slice(0, -1);
        text += '"';
    }

    // 2. Strip a dangling key/colon/comma sequence. After step 1 the text
    //    might end with patterns like `"key":` or `"key": ` (truncated
    //    before a value) — closing brackets onto that produces invalid
    //    JSON. Walk back to the previous `,` or `{` and drop everything
    //    after.
    text = stripDanglingKey(text);

    // 3. Drop a trailing comma before closing.
    text = text.replace(/,\s*$/, '');

    // 4. Close all open structures.
    while (stack.length) {
        text += stack.pop();
    }

    // Verify; if still broken, return original (caller will fall back to
    // throwing the original parse error).
    try {
        JSON.parse(text);
        return { text, repaired: true };
    } catch {
        return { text: input, repaired: false };
    }
};

/**
 * If `text` ends with a key+colon but no value (e.g. `... ,"name":` or
 * `{ "name": `), strip the dangling key all the way back to the previous
 * `,` or `{` so closing the surrounding object yields valid JSON. Strings
 * are skipped during the walk so a `:` inside a string value doesn't
 * confuse us.
 */
const stripDanglingKey = (text: string): string => {
    const lastIdx = lastNonWhitespaceIndex(text);
    if (lastIdx < 0 || text[lastIdx] !== ':') return text;

    // Walk back from lastIdx-1 to find the opening boundary of this key.
    // Toggle `inString` only on unescaped quotes (an even count of
    // preceding backslashes); skip everything inside strings.
    let i = lastIdx - 1;
    let inString = false;
    let depth = 0;

    while (i >= 0) {
        const ch = text[i];
        if (ch === '"') {
            let bs = 0;
            let j = i - 1;
            while (j >= 0 && text[j] === '\\') { bs++; j--; }
            if (bs % 2 === 0) inString = !inString;
            i--;
            continue;
        }
        if (inString) {
            i--;
            continue;
        }
        if (ch === '}' || ch === ']') {
            depth++;
        } else if (ch === '{' || ch === '[') {
            if (depth === 0) {
                // Opening bracket of the enclosing container — keep it
                // and drop everything after.
                return text.slice(0, i + 1);
            }
            depth--;
        } else if (ch === ',' && depth === 0) {
            // Drop from this comma onward (exclusive).
            return text.slice(0, i);
        }
        i--;
    }

    // Couldn't find a clean boundary — leave the text alone and let the
    // outer parse fail honestly.
    return text;
};
