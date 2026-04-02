import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface StreamingTextProps {
    /** The text content that updates as chunks arrive */
    content: string;
    /** Whether streaming is still in progress */
    isStreaming: boolean;
    /** Optional className for the container */
    className?: string;
}

export function StreamingText({ content, isStreaming, className }: StreamingTextProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom during streaming
    useEffect(() => {
        if (isStreaming && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [content, isStreaming]);

    return (
        <div ref={containerRef} className={className}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            {isStreaming && (
                <span className="inline-block w-2 h-4 bg-indigo-500 animate-pulse ml-0.5 align-text-bottom" />
            )}
        </div>
    );
}

