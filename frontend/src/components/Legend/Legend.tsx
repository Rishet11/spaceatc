import React from 'react';

const ITEMS = [
  { color: '#ff4d4d', label: 'Collision course' },
  { color: '#22c55e', label: 'Maneuvered / safe' },
  { color: '#ffffff', label: 'Demo satellite' },
  { color: '#4fc3f7', label: 'Starlink' },
  { color: '#ff9800', label: 'Other operator' },
];

/** Static color/marker key for the globe. Honest note keeps it credible. */
export const Legend: React.FC = () => (
  <div className="pointer-events-none absolute bottom-3 left-3 z-30 font-mono bg-black/45 backdrop-blur-sm border border-white/10 rounded-md px-3 py-2">
    <div className="text-[9px] tracking-widest text-gray-500 mb-1.5">LEGEND</div>
    <div className="space-y-1">
      {ITEMS.map((it) => (
        <div key={it.label} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: it.color }} />
          <span className="text-[10px] text-gray-300">{it.label}</span>
        </div>
      ))}
    </div>
    <div className="text-[9px] text-gray-600 mt-1.5 italic">paths exaggerated for clarity</div>
  </div>
);
