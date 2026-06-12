import React, { useState, useEffect } from 'react';
import { useSpaceStore } from '../../store/useSpaceStore';
import { ShieldAlert } from 'lucide-react';

export const HITLPanel: React.FC = () => {
  const { currentHitlRequest, setHitlRequest, activeConjunctions } = useSpaceStore();
  const [timeLeft, setTimeLeft] = useState(30);

  useEffect(() => {
    if (currentHitlRequest) {
      setTimeLeft(30);
      const timer = setInterval(() => {
        setTimeLeft(t => {
          if (t <= 1) {
            clearInterval(timer);
            return 0;
          }
          return t - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [currentHitlRequest]);

  if (!currentHitlRequest) return null;

  const { payload } = currentHitlRequest;
  const { event_id, proposal } = payload;
  
  const conj = activeConjunctions.find(c => c.event_id === event_id);
  const pc_before = conj ? conj.pc.toExponential(2) : "Unknown";
  const pc_after = proposal.post_maneuver_pc.toExponential(2);

  const handleAction = async (decision: 'approve' | 'veto') => {
    try {
      await fetch(`http://localhost:8000/api/hitl/${event_id}/${decision}`, { method: 'POST' });
    } catch (e) {
      console.error(`Failed to ${decision}`, e);
    }
    setHitlRequest(null);
  };

  return (
    <div className="h-[40%] border-t border-red-500/30 bg-red-950/20 p-4 flex flex-col relative shrink-0">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2 text-red-400 font-bold">
          <ShieldAlert className="w-4 h-4 animate-pulse" />
          <span>HITL AUTHORIZATION REQUIRED</span>
        </div>
        <div className={`font-mono font-bold ${timeLeft < 10 ? 'text-red-500 animate-pulse' : 'text-orange-400'}`}>
          00:{timeLeft.toString().padStart(2, '0')}
        </div>
      </div>

      <div className="flex-1 bg-black/40 rounded border border-white/10 p-3 text-sm flex flex-col space-y-2 font-mono overflow-y-auto custom-scrollbar">
        <div className="text-gray-300">
          SATELLITE: <span className="text-white font-bold">{proposal.satellite_name}</span> | OPERATOR: <span className="text-white font-bold">{proposal.operator}</span>
        </div>
        <div className="text-gray-300">
          ΔV: <span className="text-white font-bold">{proposal.delta_v_ms.toFixed(3)} m/s</span> {proposal.burn_direction.toUpperCase()}
        </div>
        <div className="text-red-400">
          BEFORE: Pc {pc_before}
        </div>
        <div className="text-green-400">
          AFTER:  Pc {pc_after}
        </div>
      </div>

      <div className="flex space-x-3 mt-4">
        <button 
          onClick={() => handleAction('approve')}
          className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded transition-colors"
        >
          APPROVE
        </button>
        <button 
          onClick={() => handleAction('veto')}
          className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 rounded transition-colors"
        >
          VETO
        </button>
      </div>
    </div>
  );
};
