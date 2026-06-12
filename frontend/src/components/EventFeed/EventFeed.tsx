import React from 'react';
import { useSpaceStore } from '../../store';

export const EventFeed: React.FC = () => {
  const { eventFeed } = useSpaceStore();

  return (
    <div className="absolute right-0 top-14 w-80 h-[calc(100vh-3.5rem)] bg-black/60 backdrop-blur-md border-l border-white/10 z-40 flex flex-col">
      <div className="p-4 border-b border-white/10">
        <h2 className="text-sm font-semibold tracking-wider text-gray-400 uppercase">System Events</h2>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {eventFeed.length === 0 ? (
          <div className="text-sm text-gray-500 italic">No events recorded.</div>
        ) : (
          eventFeed.map((ev, i) => (
            <div key={i} className="text-sm">
              <div className="text-xs text-gray-500 mb-1">{new Date(ev.timestamp).toLocaleTimeString()}</div>
              <div className="text-gray-300 bg-white/5 p-3 rounded-lg border border-white/5">
                {ev.payload?.message || JSON.stringify(ev.payload)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
