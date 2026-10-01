import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function inlineMd(text: string) {
    return (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <>{children}</> }}>
            {text}
        </ReactMarkdown>
    );
}
