interface SkeletonLoaderProps {
    lines?: number;
    className?: string;
}

// Deterministic widths to avoid impure Math.random() calls during render
const PRIMARY_WIDTHS = [82, 95, 73, 88, 78, 91, 85, 76, 93, 80];
const SECONDARY_WIDTHS = [64, 78, 55, 71, 60, 83, 68, 57, 75, 62];

export function SkeletonLoader({ lines = 5, className }: SkeletonLoaderProps) {
    return (
        <div className={`animate-pulse space-y-3 ${className || ''}`}>
            {Array.from({ length: lines }, (_, i) => (
                <div key={i} className="space-y-2">
                    {i === 0 && <div className="h-5 bg-neutral-200 rounded w-1/3" />}
                    <div className="h-3 bg-neutral-200 rounded" style={{ width: `${PRIMARY_WIDTHS[i % PRIMARY_WIDTHS.length]}%` }} />
                    {i < lines - 1 && <div className="h-3 bg-neutral-200 rounded" style={{ width: `${SECONDARY_WIDTHS[i % SECONDARY_WIDTHS.length]}%` }} />}
                </div>
            ))}
        </div>
    );
}
