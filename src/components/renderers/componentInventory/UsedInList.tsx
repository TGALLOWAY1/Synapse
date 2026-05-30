// Static "used in" screen pills. No app routes exist for screens yet, so
// these are non-interactive; the component is structured so they can become
// links later without touching call sites.

export function UsedInList({ screens }: { screens: string[] }) {
    if (screens.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1.5">
            {screens.map((screen, i) => (
                <span
                    key={i}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-600 border border-neutral-200"
                >
                    {screen}
                </span>
            ))}
        </div>
    );
}
