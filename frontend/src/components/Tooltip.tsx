import React, { useState, useRef } from 'react';

interface TooltipProps {
  text: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom';
}

// Matches the w-64 tooltip box below.
const TOOLTIP_WIDTH = 256;
const VIEWPORT_PADDING = 8;

export function Tooltip({ text, children, position = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; arrowOffset: number } | null>(null);
  const timerRef = useRef<any>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const show = () => {
    timerRef.current = setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Anchored with position: fixed (viewport-relative) instead of the
      // parent's stacking context, so scroll containers like the mission
      // control log can't clip it — then clamped so it never runs off-screen.
      const desiredCenter = rect.left + rect.width / 2;
      const clampedCenter = Math.min(
        Math.max(desiredCenter, TOOLTIP_WIDTH / 2 + VIEWPORT_PADDING),
        window.innerWidth - TOOLTIP_WIDTH / 2 - VIEWPORT_PADDING
      );
      setCoords({
        left: clampedCenter,
        top: position === 'top' ? rect.top - 8 : rect.bottom + 8,
        arrowOffset: desiredCenter - clampedCenter,
      });
      setVisible(true);
    }, 300);
  };

  const hide = () => {
    clearTimeout(timerRef.current);
    setVisible(false);
  };

  return (
    <span
      ref={triggerRef}
      className="relative inline-block cursor-help"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible && coords && (
        <div
          className="fixed z-50 w-64 p-2 text-xs text-white rounded-lg shadow-lg
            bg-gray-900 border border-gray-600 font-sans tracking-normal leading-relaxed"
          style={{
            left: coords.left,
            top: coords.top,
            transform: `translate(-50%, ${position === 'top' ? '-100%' : '0'})`,
          }}
        >
          {text}
          <div
            className="absolute w-2 h-2 bg-gray-900 border-gray-600"
            style={{
              left: `calc(50% + ${coords.arrowOffset}px)`,
              transform: 'translateX(-50%) rotate(45deg)',
              ...(position === 'top'
                ? { top: '100%', marginTop: '-4px', borderRight: '1px solid #4b5563', borderBottom: '1px solid #4b5563' }
                : { bottom: '100%', marginBottom: '-4px', borderLeft: '1px solid #4b5563', borderTop: '1px solid #4b5563' }),
            }}
          />
        </div>
      )}
    </span>
  );
}
