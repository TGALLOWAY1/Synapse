interface SkeletonLoaderProps {
    lines?: number;
    className?: string;
}

export function SkeletonLoader({ lines = 5, className }: SkeletonLoaderProps) {
    return (
        <div className={`animate-pulse space-y-3 ${className || ''}`}>
            {Array.from({ length: lines }, (_, i) => (
                <div key={i} className="space-y-2">
                    {i === 0 && <div className="h-5 bg-neutral-200 rounded w-1/3" />}
                    <div className="h-3 bg-neutral-200 rounded" style={{ width: `${70 + Math.random() * 30}%` }} />
                    {i < lines - 1 && <div className="h-3 bg-neutral-200 rounded" style={{ width: `${50 + Math.random() * 40}%` }} />}
                </div>
            ))}
        </div>
    );
}
