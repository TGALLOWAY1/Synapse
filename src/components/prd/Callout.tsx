import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Children, isValidElement } from 'react';

type CalloutKind = 'ASSUMPTION' | 'RISK' | 'DECISION' | 'NOTE';

const KIND_STYLES: Record<CalloutKind, { container: string; label: string; labelText: string }> = {
    ASSUMPTION: {
        container: 'border-amber-200 bg-amber-50 text-amber-900',
        label: 'bg-amber-200 text-amber-900',
        labelText: 'Assumption',
    },
    RISK: {
        container: 'border-red-200 bg-red-50 text-red-900',
        label: 'bg-red-200 text-red-900',
        labelText: 'Risk',
    },
    DECISION: {
        container: 'border-indigo-200 bg-indigo-50 text-indigo-900',
        label: 'bg-indigo-200 text-indigo-900',
        labelText: 'Decision',
    },
    NOTE: {
        container: 'border-blue-200 bg-blue-50 text-blue-900',
        label: 'bg-blue-200 text-blue-900',
        labelText: 'Note',
    },
};

const CALLOUT_RE = /^\s*\[!(ASSUMPTION|RISK|DECISION|NOTE)\]\s*/;

// Walk the first text node of the children tree and strip the [!KIND] prefix.
// Returns the matched kind plus a deep-cloned children array with the prefix
// removed from the leading text node. Returns null if no callout marker is
// found, in which case the caller should render a plain blockquote.
const detectCallout = (children: ReactNode): { kind: CalloutKind; cleaned: ReactNode } | null => {
    let kind: CalloutKind | null = null;
    let consumed = false;

    const visit = (node: ReactNode): ReactNode => {
        if (consumed) return node;
        if (typeof node === 'string') {
            const match = node.match(CALLOUT_RE);
            if (match) {
                kind = match[1] as CalloutKind;
                consumed = true;
                return node.replace(CALLOUT_RE, '');
            }
            // Mark consumed even if no match so we don't keep scanning past
            // the first non-empty text.
            if (node.trim().length > 0) consumed = true;
            return node;
        }
        if (Array.isArray(node)) {
            return node.map(visit);
        }
        if (isValidElement(node)) {
            const element = node as React.ReactElement<{ children?: ReactNode }>;
            const inner = element.props.children;
            const nextInner = visit(inner);
            if (nextInner === inner) return element;
            return { ...element, props: { ...element.props, children: nextInner } };
        }
        return node;
    };

    const cleaned = visit(children);
    if (!kind) return null;
    return { kind, cleaned };
};

/**
 * Custom react-markdown blockquote component. Detects a leading `[!KIND]`
 * marker and renders a styled callout. Falls back to a plain blockquote
 * otherwise. The text content is preserved verbatim so mark.js anchor
 * highlighting continues to find branch anchors that span callouts.
 */
export function Callout(props: ComponentPropsWithoutRef<'blockquote'>) {
    const { children, ...rest } = props;
    const detected = detectCallout(children);
    if (!detected) {
        return (
            <blockquote
                {...rest}
                className="border-l-4 border-neutral-300 bg-neutral-50 px-4 py-2 my-4 italic text-neutral-700"
            >
                {children}
            </blockquote>
        );
    }
    const styles = KIND_STYLES[detected.kind];
    return (
        <div
            className={`my-4 rounded-lg border ${styles.container} px-4 py-3 not-italic`}
        >
            <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${styles.label}`}>
                    {styles.labelText}
                </span>
            </div>
            <div className="text-sm leading-relaxed">
                {Children.map(detected.cleaned, child => child)}
            </div>
        </div>
    );
}
