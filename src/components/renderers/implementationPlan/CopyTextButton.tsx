import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyToClipboard } from '../../../lib/utils/copyToClipboard';

interface Props {
    text: string;
    label: string;
    /** Compact indigo pill (primary) or bordered neutral (secondary). */
    variant?: 'primary' | 'secondary';
    /** Fired after a successful copy (e.g. to record copy progress). */
    onCopied?: () => void;
}

/** Small copy-to-clipboard button with a transient "Copied" state. */
export function CopyTextButton({ text, label, variant = 'primary', onCopied }: Props) {
    const [copied, setCopied] = useState(false);
    const cls = variant === 'primary'
        ? 'bg-indigo-600 text-white hover:bg-indigo-700'
        : 'border border-neutral-200 text-neutral-700 hover:bg-neutral-50';
    return (
        <button
            type="button"
            onClick={async () => {
                const ok = await copyToClipboard(text);
                if (ok) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                    onCopied?.();
                }
            }}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition min-h-[32px] ${cls}`}
        >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : label}
        </button>
    );
}
