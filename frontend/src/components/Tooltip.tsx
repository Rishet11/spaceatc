import React, { useState, useRef } from 'react';

interface TooltipProps {
  text: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom';
}

export function Tooltip({ text, children, position = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<any>(null);
  
  return (
    <span 
      className="relative inline-block cursor-help"
      onMouseEnter={() => {
        timerRef.current = setTimeout(() => setVisible(true), 300);
      }}
      onMouseLeave={() => {
        clearTimeout(timerRef.current);
        setVisible(false);
      }}
    >
      {children}
      {visible && (
        <div className={`
          absolute z-50 w-64 p-2 text-xs text-white rounded-lg shadow-lg
          bg-gray-900 border border-gray-600 font-sans tracking-normal leading-relaxed
          ${position === 'top' ? 'bottom-full mb-2 left-1/2 -translate-x-1/2' 
                               : 'top-full mt-2 left-1/2 -translate-x-1/2'}
        `}>
          {text}
          <div className={`
            absolute left-1/2 -translate-x-1/2 w-2 h-2 
            bg-gray-900 border-gray-600 rotate-45
            ${position === 'top' ? 'top-full border-r border-b -translate-y-1' 
                                 : 'bottom-full border-l border-t translate-y-1'}
          `} />
        </div>
      )}
    </span>
  );
}
