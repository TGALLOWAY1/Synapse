import type { ParsedStep } from './types';

interface Props {
    flowIndex: number;
    steps: ParsedStep[];
}

const NODE_W = 140;
const NODE_H = 56;
const GAP_X = 36;
const GAP_Y = 40;

function truncate(text: string, max = 22): string {
    const t = text.trim();
    if (t.length <= max) return t;
    return t.slice(0, max - 1) + '…';
}

function nodeLabel(step: ParsedStep): string {
    return step.title ?? step.userAction ?? step.rawText;
}

export function FlowDiagram({ flowIndex, steps }: Props) {
    if (steps.length === 0) return null;
    const vertical = steps.length > 8;

    const handleClick = (stepIndex: number) => {
        const el = document.getElementById(`flow-${flowIndex}-step-${stepIndex}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    if (vertical) {
        const width = NODE_W + 80;
        const height = steps.length * (NODE_H + GAP_Y) - GAP_Y;
        return (
            <div className="bg-white rounded-xl border border-neutral-200 p-4 mb-4 overflow-x-auto">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                    Flow overview
                </p>
                <svg
                    role="img"
                    aria-label="Flow diagram"
                    viewBox={`0 0 ${width} ${height}`}
                    width={width}
                    height={height}
                    className="max-w-full"
                >
                    {steps.map((step, i) => {
                        const x = 8;
                        const y = i * (NODE_H + GAP_Y);
                        const hasErrors = step.errorRefs.length > 0;
                        return (
                            <g key={i} className="cursor-pointer" onClick={() => handleClick(i)}>
                                {i < steps.length - 1 && (
                                    <line
                                        x1={x + NODE_W / 2}
                                        y1={y + NODE_H}
                                        x2={x + NODE_W / 2}
                                        y2={y + NODE_H + GAP_Y}
                                        stroke="#a3a3a3"
                                        strokeWidth={1.5}
                                    />
                                )}
                                {hasErrors && (
                                    <>
                                        <line
                                            x1={x + NODE_W}
                                            y1={y + NODE_H / 2}
                                            x2={x + NODE_W + 28}
                                            y2={y + NODE_H / 2}
                                            stroke="#dc2626"
                                            strokeWidth={1.5}
                                            strokeDasharray="4 3"
                                        />
                                        <circle
                                            cx={x + NODE_W + 36}
                                            cy={y + NODE_H / 2}
                                            r={8}
                                            fill="#fee2e2"
                                            stroke="#dc2626"
                                            strokeWidth={1.5}
                                        />
                                        <text
                                            x={x + NODE_W + 36}
                                            y={y + NODE_H / 2 + 3}
                                            textAnchor="middle"
                                            fontSize="10"
                                            fontWeight="700"
                                            fill="#dc2626"
                                        >
                                            !
                                        </text>
                                    </>
                                )}
                                <rect
                                    x={x}
                                    y={y}
                                    width={NODE_W}
                                    height={NODE_H}
                                    rx={8}
                                    fill="#eef2ff"
                                    stroke="#6366f1"
                                    strokeWidth={1.25}
                                />
                                <text x={x + 10} y={y + 18} fontSize="10" fontWeight="700" fill="#4338ca">
                                    {i + 1}
                                </text>
                                <text x={x + 10} y={y + 36} fontSize="11" fill="#1f2937">
                                    {truncate(nodeLabel(step), 18)}
                                </text>
                            </g>
                        );
                    })}
                </svg>
            </div>
        );
    }

    const width = steps.length * (NODE_W + GAP_X) - GAP_X + 16;
    const height = NODE_H + 40; // room for error markers below
    return (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 mb-4 overflow-x-auto">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                Flow overview
            </p>
            <svg
                role="img"
                aria-label="Flow diagram"
                viewBox={`0 0 ${width} ${height}`}
                width={width}
                height={height}
                className="max-w-full"
            >
                {steps.map((step, i) => {
                    const x = i * (NODE_W + GAP_X) + 8;
                    const y = 4;
                    const hasErrors = step.errorRefs.length > 0;
                    return (
                        <g key={i} className="cursor-pointer" onClick={() => handleClick(i)}>
                            {i < steps.length - 1 && (
                                <line
                                    x1={x + NODE_W}
                                    y1={y + NODE_H / 2}
                                    x2={x + NODE_W + GAP_X}
                                    y2={y + NODE_H / 2}
                                    stroke="#a3a3a3"
                                    strokeWidth={1.5}
                                />
                            )}
                            {hasErrors && (
                                <>
                                    <line
                                        x1={x + NODE_W / 2}
                                        y1={y + NODE_H}
                                        x2={x + NODE_W / 2}
                                        y2={y + NODE_H + 24}
                                        stroke="#dc2626"
                                        strokeWidth={1.5}
                                        strokeDasharray="4 3"
                                    />
                                    <circle
                                        cx={x + NODE_W / 2}
                                        cy={y + NODE_H + 32}
                                        r={8}
                                        fill="#fee2e2"
                                        stroke="#dc2626"
                                        strokeWidth={1.5}
                                    />
                                    <text
                                        x={x + NODE_W / 2}
                                        y={y + NODE_H + 35}
                                        textAnchor="middle"
                                        fontSize="10"
                                        fontWeight="700"
                                        fill="#dc2626"
                                    >
                                        !
                                    </text>
                                </>
                            )}
                            <rect
                                x={x}
                                y={y}
                                width={NODE_W}
                                height={NODE_H}
                                rx={8}
                                fill="#eef2ff"
                                stroke="#6366f1"
                                strokeWidth={1.25}
                            />
                            <text x={x + 10} y={y + 18} fontSize="10" fontWeight="700" fill="#4338ca">
                                {i + 1}
                            </text>
                            <text x={x + 10} y={y + 38} fontSize="11" fill="#1f2937">
                                {truncate(nodeLabel(step), 18)}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}
