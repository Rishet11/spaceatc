import React, { useState, useEffect } from 'react';
import { useSpaceStore } from '../../store/useSpaceStore';
import { Settings } from 'lucide-react';

export const MathPanel: React.FC = () => {
  const { activeMathTrace } = useSpaceStore();
  const [visibleItems, setVisibleItems] = useState<number>(0);

  useEffect(() => {
    if (activeMathTrace && activeMathTrace.length > 0) {
      setVisibleItems(0);
      const timer = setInterval(() => {
        setVisibleItems(prev => {
          if (prev >= activeMathTrace.length) {
            clearInterval(timer);
            return prev;
          }
          return prev + 1;
        });
      }, 120);

      return () => clearInterval(timer);
    } else {
      setVisibleItems(0);
    }
  }, [activeMathTrace]);

  if (!activeMathTrace) return null;

  const isComplete = visibleItems >= activeMathTrace.length;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[28vh] bg-black/60 backdrop-blur-sm transition-opacity duration-300">
      <div className="bg-black border border-green-500/50 rounded shadow-[0_0_30px_rgba(34,197,94,0.15)] text-green-500 font-mono p-6 w-[92%] md:w-auto md:min-w-[500px] max-w-2xl max-h-[66vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center space-x-3 text-green-400 mb-2 border-b border-green-500/30 pb-3">
          <Settings className={`w-5 h-5 ${!isComplete ? 'animate-spin' : ''}`} style={{ animationDuration: '3s' }} />
          <span className="font-bold tracking-widest text-sm">ORBITAL MECHANICS ENGINE</span>
        </div>

        {/* Trace lines */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 py-2 text-xs leading-relaxed space-y-1">
          {activeMathTrace.slice(0, visibleItems).map((item, idx) => {
            const isLastVisible = idx === visibleItems - 1;
            const showCursor = isLastVisible && !isComplete;
            
            // For converged, use a separator above it
            const isConverged = item.text === 'CONVERGED';

            return (
              <React.Fragment key={item.t}>
                {isConverged && (
                  <div className="text-green-700/50 my-2">─────────────────────────────────────────────</div>
                )}
                <div className="flex justify-between animate-fade-in opacity-0" style={{ animationFillMode: 'forwards' }}>
                  <span className="text-green-400/80">{item.text}</span>
                  <div className="flex">
                    <span className="font-bold">{item.value}</span>
                    <span className={`ml-1 w-1.5 h-4 bg-green-500 ${showCursor ? 'animate-pulse' : 'opacity-0'}`}></span>
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};
