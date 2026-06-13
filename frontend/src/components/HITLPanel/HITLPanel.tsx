import React, { useState, useEffect } from 'react';
import { useSpaceStore } from '../../store/useSpaceStore';
import { ShieldAlert, Check, X, Clock } from 'lucide-react';
import { Tooltip } from '../Tooltip';

export const HITLPanel: React.FC = () => {
  const { currentHitlRequest, setHitlRequest, activeConjunctions, setActiveMathTrace } = useSpaceStore();
  const [timeLeft, setTimeLeft] = useState(30);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (currentHitlRequest) {
      // Trigger slide-up animation shortly after mount
      requestAnimationFrame(() => setMounted(true));
      
      setTimeLeft(30);
      const timer = setInterval(() => {
        setTimeLeft(t => {
          if (t <= 1) {
            clearInterval(timer);
            handleAction('veto'); // Auto-veto
            return 0;
          }
          return t - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    } else {
      setMounted(false);
    }
  }, [currentHitlRequest]);

  if (!currentHitlRequest) return null;

  const { payload } = currentHitlRequest;
  const { event_id, proposal } = payload;
  
  const conj = activeConjunctions.find(c => c.event_id === event_id);
  const pc_before = conj ? conj.pc : 0.01;
  const pc_after = proposal.post_maneuver_pc;

  const handleAction = async (decision: 'approve' | 'veto') => {
    setMounted(false); // trigger slide down
    if (decision === 'approve') {
      setActiveMathTrace(proposal.computation_trace || []);
    }
    setTimeout(async () => {
      try {
        await fetch(`/api/hitl/${event_id}/${decision}`, { method: 'POST' });
      } catch (e) {
        console.error(`Failed to ${decision}`, e);
      }
      setHitlRequest(null);
    }, 300); // wait for animation to complete
  };

  const formatPcFraction = (pc: number) => {
    if (pc <= 0) return "SAFE";
    return "1 in " + Math.round(1 / pc).toLocaleString();
  };

  const getRiskColor = (pc: number) => {
    if (pc > 1e-4) return "bg-red-500";
    if (pc > 1e-5) return "bg-yellow-500";
    return "bg-green-500";
  };

  const getTimerColor = () => {
    if (timeLeft < 5) return 'bg-red-500';
    if (timeLeft < 15) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const timerWidth = (timeLeft / 30) * 100;
  
  const riskBeforeWidth = Math.min(pc_before / 0.01, 1) * 100;
  const riskAfterWidth = Math.min(pc_after / 0.01, 1) * 100;

  return (
    <div 
      className={`fixed bottom-0 left-0 right-0 h-[280px] bg-[#0f172a] border-t-4 border-red-500 z-50 text-white shadow-[0_-10px_40px_rgba(0,0,0,0.5)] flex flex-col font-mono transition-transform duration-300 ease-out ${mounted ? 'translate-y-0' : 'translate-y-full'}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-black/20">
        <div className="flex items-center space-x-3 text-red-500 font-bold text-lg tracking-wider">
          <ShieldAlert className="w-6 h-6 animate-pulse" />
          <Tooltip text="Human-In-The-Loop: every maneuver requires explicit human approval before execution. No AI acts without oversight." position="bottom">
            <span>MANEUVER AUTHORIZATION REQUIRED</span>
          </Tooltip>
        </div>
        <div className={`flex items-center space-x-2 text-xl font-bold ${timeLeft < 10 ? 'text-red-500 animate-pulse' : 'text-gray-300'}`}>
          <Clock className="w-5 h-5" />
          <span>{timeLeft}s</span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 p-6">
        {/* Left Column: Maneuver Details */}
        <div className="w-1/3 flex flex-col justify-center space-y-4 text-sm border-r border-white/10 pr-6">
          <div className="flex justify-between">
            <span className="text-gray-400">SATELLITE:</span>
            <span className="font-bold text-lg">{proposal.satellite_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">OPERATOR:</span>
            <span className="font-bold">{proposal.operator}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">
              <Tooltip text="Delta-V: the velocity change produced by a thruster burn. Computed using Clohessy-Wiltshire relative motion equations." position="bottom">
                <span className="border-b border-dashed border-gray-600">ΔV</span>
              </Tooltip>
              :
            </span>
            <span className="font-bold text-blue-400">
              {proposal.delta_v_ms.toFixed(3)} m/s{' '}
              <Tooltip text="Along the direction of orbital travel. Most fuel-efficient for changing arrival time at the conjunction point." position="bottom">
                <span className="border-b border-dashed border-blue-800">{proposal.burn_direction}</span>
              </Tooltip>
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">TIMING:</span>
            <span className="font-bold text-yellow-400">60 min before TCA</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">IMPACT:</span>
            <span className="font-bold text-green-400">LOW</span>
          </div>
        </div>

        {/* Right Column: Risk Comparison */}
        <div className="w-2/3 flex px-6 space-x-8 items-center justify-center">
          {/* Before */}
          <div className="flex-1 bg-black/30 rounded-xl p-4 border border-white/10 flex flex-col items-center">
            <div className="text-gray-400 mb-2 font-bold tracking-widest text-xs">BEFORE MANEUVER</div>
            <div className="text-red-400 text-sm mb-1">
              <Tooltip text="Probability of Collision — how likely a physical impact is at closest approach. Industry alert threshold: 1 in 10,000 (1×10⁻⁴). We target below 1 in 1,000,000." position="top">
                <span className="border-b border-dashed border-red-800">Pc</span>
              </Tooltip>
              : {pc_before.toExponential(2)}
            </div>
            <div className="text-3xl font-bold text-red-500 mb-4">{formatPcFraction(pc_before)}</div>
            <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-red-500" style={{ width: `${riskBeforeWidth}%` }}></div>
            </div>
            <div className="flex items-center space-x-2 text-red-500 text-sm font-bold">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-red-400"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </span>
              <span>RISK</span>
            </div>
          </div>

          {/* After */}
          <div className="flex-1 bg-black/30 rounded-xl p-4 border border-white/10 flex flex-col items-center">
            <div className="text-gray-400 mb-2 font-bold tracking-widest text-xs">AFTER</div>
            <div className="text-green-400 text-sm mb-1">
              <Tooltip text="Probability of Collision — how likely a physical impact is at closest approach. Industry alert threshold: 1 in 10,000 (1×10⁻⁴). We target below 1 in 1,000,000." position="top">
                <span className="border-b border-dashed border-green-800">Pc</span>
              </Tooltip>
              : {pc_after.toExponential(2)}
            </div>
            <div className="text-3xl font-bold text-green-500 mb-4">{formatPcFraction(pc_after)}</div>
            <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-green-500" style={{ width: `${riskAfterWidth}%` }}></div>
            </div>
            <div className="flex items-center space-x-2 text-green-500 text-sm font-bold">
              <span className="relative flex h-3 w-3">
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
              <span>SAFE</span>
            </div>
          </div>
        </div>
      </div>

      {/* Countdown Bar & Actions */}
      <div className="relative px-6 pb-6 flex items-center justify-between">
        {/* Countdown Bar (Background) */}
        <div className="absolute top-0 left-6 right-6 h-1 bg-gray-800 rounded-full overflow-hidden -mt-2">
          <div 
            className={`h-full transition-all duration-1000 ease-linear ${getTimerColor()}`} 
            style={{ width: `${timerWidth}%`, float: 'right' }}
          ></div>
        </div>

        <div className="flex-1 flex justify-center space-x-6 mt-2">
          <button 
            onClick={() => handleAction('approve')}
            className="flex items-center space-x-3 px-12 py-4 bg-[#22c55e] hover:bg-[#16a34a] text-white font-bold rounded shadow-[0_0_20px_rgba(34,197,94,0.5)] transition-all duration-200 animate-pulse"
          >
            <Check className="w-6 h-6" />
            <span className="text-xl tracking-wider">APPROVE MANEUVER</span>
          </button>

          <button 
            onClick={() => handleAction('veto')}
            className="flex items-center space-x-2 px-8 py-4 bg-red-600 hover:bg-red-500 text-white font-bold rounded transition-colors"
          >
            <X className="w-5 h-5" />
            <span className="text-lg tracking-wider">VETO</span>
          </button>
        </div>
      </div>
    </div>
  );
};
