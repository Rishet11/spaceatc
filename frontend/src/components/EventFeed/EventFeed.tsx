import React, { useEffect, useRef } from 'react';
import { useSpaceStore } from '../../store/useSpaceStore';

const getColor = (type: string) => {
  switch (type) {
    case 'conjunction_detected': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'negotiation_update': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'maneuver_executed': return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'hitl_request': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'system':
    case 'system_status':
    default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
};

const getBadge = (type: string) => {
  switch (type) {
    case 'conjunction_detected': return 'DETECTOR';
    case 'negotiation_update': return 'NEGOTIATOR';
    case 'maneuver_executed': return 'EXECUTOR';
    case 'hitl_request': return 'HITL';
    case 'system':
    case 'system_status': return 'SYSTEM';
    default: return 'AGENT';
  }
};

export const EventFeed: React.FC = () => {
  const { eventFeed } = useSpaceStore();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [eventFeed]);

  const displayFeed = [...eventFeed].reverse();

  return (
    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar flex flex-col space-y-3">
      {displayFeed.length === 0 ? (
        <div className="text-sm text-gray-500 italic text-center mt-4">No events recorded.</div>
      ) : (
        displayFeed.map((ev, i) => {
          const timeStr = new Date(ev.timestamp).toLocaleTimeString('en-US', { hour12: false });
          const colorClass = getColor(ev.type);
          const badgeStr = getBadge(ev.type);
          const msg = ev.payload?.message || ev.type;

          return (
            <div key={i} className="flex flex-col space-y-1 text-sm animate-fade-in">
              <div className="flex items-center space-x-2 text-xs">
                <span className="text-gray-500 font-mono">{timeStr}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider border ${colorClass}`}>
                  {badgeStr}
                </span>
              </div>
              <div className="text-gray-200 bg-white/5 p-2.5 rounded border border-white/10 leading-snug">
                {msg}
              </div>
            </div>
          );
        })
      )}
      <div ref={endRef} />
    </div>
  );
};
