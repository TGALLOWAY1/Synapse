import { useState } from 'react';

/** Hook to accumulate streaming text chunks */
export function useStreamingText() {
    const [streamingContent, setStreamingContent] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);

    const startStream = () => {
        setStreamingContent('');
        setIsStreaming(true);
    };

    const appendChunk = (chunk: string) => {
        setStreamingContent(prev => prev + chunk);
    };

    const endStream = () => {
        setIsStreaming(false);
    };

    const resetStream = () => {
        setStreamingContent('');
        setIsStreaming(false);
    };

    return {
        streamingContent,
        isStreaming,
        startStream,
        appendChunk,
        endStream,
        resetStream,
    };
}
