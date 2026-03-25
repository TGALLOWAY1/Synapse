import React from 'react';
import type { MarkupImageSpec, AnnotationLayer } from '../types';

interface MarkupImageRendererProps {
    spec: MarkupImageSpec;
    className?: string;
}

export const MarkupImageRenderer = React.memo(function MarkupImageRenderer({ spec, className }: MarkupImageRendererProps) {
    const { canvas, layers } = spec;

    return (
        <div className={className} style={{ overflow: 'auto' }}>
            <svg
                viewBox={`0 0 ${canvas.width} ${canvas.height}`}
                width="100%"
                style={{ maxWidth: canvas.width, backgroundColor: canvas.backgroundColor }}
                xmlns="http://www.w3.org/2000/svg"
            >
                <defs>
                    <marker id="arrowhead-filled" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
                    </marker>
                    <marker id="arrowhead-open" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                        <polyline points="0 0, 10 3.5, 0 7" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    </marker>
                </defs>

                {/* Source image */}
                {spec.source && spec.source.type === 'url' && (
                    <image
                        href={spec.source.value}
                        x="0" y="0"
                        width={canvas.width}
                        height={canvas.height}
                        preserveAspectRatio={
                            spec.source.fit === 'contain' ? 'xMidYMid meet'
                            : spec.source.fit === 'cover' ? 'xMidYMid slice'
                            : 'none'
                        }
                    />
                )}

                {layers.map(layer => (
                    <RenderLayer key={layer.id} layer={layer} />
                ))}
            </svg>
        </div>
    );
});

function RenderLayer({ layer }: { layer: AnnotationLayer }) {
    switch (layer.type) {
        case 'highlight':
            return <HighlightLayer layer={layer} />;
        case 'box':
            return <BoxLayer layer={layer} />;
        case 'callout':
            return <CalloutLayer layer={layer} />;
        case 'label':
            return <LabelLayer layer={layer} />;
        case 'arrow':
            return <ArrowLayer layer={layer} />;
        case 'number_marker':
            return <NumberMarkerLayer layer={layer} />;
        case 'text_block':
            return <TextBlockLayer layer={layer} />;
        case 'divider':
            return <DividerLayer layer={layer} />;
        default:
            return null;
    }
}

function HighlightLayer({ layer }: { layer: AnnotationLayer }) {
    const { position, size, style } = layer;
    return (
        <rect
            x={position.x}
            y={position.y}
            width={size?.width || 100}
            height={size?.height || 40}
            fill={style.color}
            stroke={style.borderColor || 'transparent'}
            strokeWidth={style.borderWidth || 0}
            rx={style.borderRadius || 0}
            opacity={style.opacity ?? 1}
        />
    );
}

function BoxLayer({ layer }: { layer: AnnotationLayer }) {
    const { position, size, style } = layer;
    return (
        <g>
            <rect
                x={position.x}
                y={position.y}
                width={size?.width || 100}
                height={size?.height || 60}
                fill="none"
                stroke={style.borderColor || style.color}
                strokeWidth={style.borderWidth || 2}
                rx={style.borderRadius || 4}
                strokeDasharray={style.opacity && style.opacity < 1 ? '4 2' : undefined}
            />
            {layer.content && (
                <text
                    x={position.x + (size?.width || 100) / 2}
                    y={position.y + (size?.height || 60) / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={style.color}
                    fontSize={style.fontSize || 13}
                    fontWeight={style.fontWeight || 'normal'}
                >
                    {layer.content}
                </text>
            )}
        </g>
    );
}

function CalloutLayer({ layer }: { layer: AnnotationLayer }) {
    const { position, size, style, content } = layer;
    const w = size?.width || 200;
    const h = size?.height || 60;

    return (
        <g>
            <rect
                x={position.x}
                y={position.y}
                width={w}
                height={h}
                fill={style.color || '#ffffff'}
                stroke={style.borderColor || '#333'}
                strokeWidth={style.borderWidth || 1}
                rx={style.borderRadius || 6}
                filter="url(#shadow)"
            />
            {content && (
                <foreignObject x={position.x + 8} y={position.y + 6} width={w - 16} height={h - 12}>
                    <div
                        style={{
                            fontSize: style.fontSize || 12,
                            fontWeight: style.fontWeight || 'normal',
                            color: style.borderColor || '#333',
                            lineHeight: 1.4,
                            overflow: 'hidden',
                        }}
                    >
                        {content}
                    </div>
                </foreignObject>
            )}
        </g>
    );
}

function LabelLayer({ layer }: { layer: AnnotationLayer }) {
    const { position, style, content } = layer;
    return (
        <text
            x={position.x}
            y={position.y}
            fill={style.color}
            fontSize={style.fontSize || 14}
            fontWeight={style.fontWeight || 'bold'}
            fontFamily="system-ui, sans-serif"
        >
            {content || ''}
        </text>
    );
}

function ArrowLayer({ layer }: { layer: AnnotationLayer }) {
    const { style, arrow } = layer;
    if (!arrow) return null;

    const markerId = arrow.headStyle === 'open' ? 'arrowhead-open'
        : arrow.headStyle === 'none' ? undefined
        : 'arrowhead-filled';

    return (
        <line
            x1={arrow.from.x}
            y1={arrow.from.y}
            x2={arrow.to.x}
            y2={arrow.to.y}
            stroke={style.color}
            strokeWidth={style.borderWidth || 2}
            markerEnd={markerId ? `url(#${markerId})` : undefined}
            style={{ color: style.color }}
        />
    );
}

function NumberMarkerLayer({ layer }: { layer: AnnotationLayer }) {
    const { position, style, numberMarker } = layer;
    if (!numberMarker) return null;

    const r = 12;
    return (
        <g>
            <circle
                cx={position.x + r}
                cy={position.y + r}
                r={r}
                fill={style.color}
            />
            <text
                x={position.x + r}
                y={position.y + r}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#ffffff"
                fontSize={style.fontSize || 12}
                fontWeight="bold"
                fontFamily="system-ui, sans-serif"
            >
                {numberMarker.number}
            </text>
        </g>
    );
}

function TextBlockLayer({ layer }: { layer: AnnotationLayer }) {
    const { position, size, style, content } = layer;
    const w = size?.width || 300;
    const h = size?.height || 40;

    return (
        <foreignObject x={position.x} y={position.y} width={w} height={h}>
            <div
                style={{
                    fontSize: style.fontSize || 12,
                    fontWeight: style.fontWeight || 'normal',
                    color: style.color,
                    lineHeight: 1.5,
                }}
            >
                {content || ''}
            </div>
        </foreignObject>
    );
}

function DividerLayer({ layer }: { layer: AnnotationLayer }) {
    const { position, size, style } = layer;
    const w = size?.width || 400;
    return (
        <line
            x1={position.x}
            y1={position.y}
            x2={position.x + w}
            y2={position.y}
            stroke={style.color || '#e5e5e5'}
            strokeWidth={style.borderWidth || 1}
        />
    );
}
