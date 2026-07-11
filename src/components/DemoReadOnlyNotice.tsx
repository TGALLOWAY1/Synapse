export function DemoReadOnlyNotice() {
    return (
        <div
            role="status"
            className="shrink-0 bg-indigo-500/10 border-b border-indigo-500/30 text-indigo-200 text-sm px-4 py-2 flex items-center justify-center gap-2 z-10"
        >
            <span>
                This is a read-only example project. Explore its PRD, screens, mockups, data model,
                and implementation plan without changing the saved project.
            </span>
        </div>
    );
}
