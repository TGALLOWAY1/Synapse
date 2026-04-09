interface FlowArrowProps {
  direction?: 'right' | 'down';
  className?: string;
}

export function FlowArrow({ direction = 'right', className = '' }: FlowArrowProps) {
  if (direction === 'down') {
    return (
      <svg
        className={`h-6 w-6 text-[#4a5a8a] ${className}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5v14" />
        <path d="M19 12l-7 7-7-7" />
      </svg>
    );
  }

  return (
    <svg
      className={`h-6 w-6 text-[#4a5a8a] ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="M12 5l7 7-7 7" />
    </svg>
  );
}
