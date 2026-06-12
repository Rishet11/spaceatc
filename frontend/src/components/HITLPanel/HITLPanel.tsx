import React, { useState, useEffect } from 'react';
import { useSpaceStore } from '../../store';
import { ShieldAlert, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

export const HITLPanel: React.FC = () => {
  const { currentHitlRequest, setHitlRequest } = useSpaceStore();
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    if (!currentHitlRequest) {
      setCountdown(30);
      return;
    }
    const timer = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [currentHitlRequest]);

  if (!currentHitlRequest) return null;

  const { event_id, payload } = currentHitlRequest;
  const proposal = payload.proposal;

  const handleApprove = async () => {
    try {
      await fetch(`http://127.0.0.1:8000/api/hitl/${event_id}/approve`, { method: 'POST' });
      setHitlRequest(null);
    } catch (e) {
      console.error(e);
    }
  };

  const handleVeto = async () => {
    try {
      await fetch(`http://127.0.0.1:8000/api/hitl/${event_id}/veto`, { method: 'POST' });
      setHitlRequest(null);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden w-full max-w-lg animate-in fade-in zoom-in duration-300">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-red-900/50 to-orange-900/50 p-6 border-b border-white/10 flex items-start justify-between">
          <div>
            <div className="flex items-center space-x-2 text-red-400 mb-1">
              <AlertTriangle className="w-5 h-5 animate-pulse" />
              <h2 className="font-bold tracking-wider uppercase text-sm">Action Required</h2>
            </div>
            <h3 className="text-xl font-bold text-white">Maneuver Proposal</h3>
          </div>
          <div className="text-right">
            <div className="text-3xl font-mono font-bold text-white">{countdown}s</div>
            <div className="text-xs text-gray-400 uppercase tracking-widest">Timeout</div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-black/30 rounded-xl p-4 border border-white/5">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Target</div>
              <div className="font-bold text-lg text-white">{proposal.satellite_name}</div>
              <div className="text-sm text-blue-400">{proposal.operator}</div>
            </div>
            <div className="bg-black/30 rounded-xl p-4 border border-white/5">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Delta-V</div>
              <div className="font-bold text-2xl text-amber-400">{proposal.delta_v_ms.toFixed(3)} m/s</div>
              <div className="text-sm text-gray-400">{proposal.burn_direction} burn</div>
            </div>
          </div>

          <div className="bg-black/30 rounded-xl p-4 border border-white/5 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Current Collision Prob. (Pc)</span>
              <span className="text-red-400 font-mono font-bold">1.2e-3</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Post-Maneuver Pc</span>
              <span className="text-green-400 font-mono font-bold">{proposal.post_maneuver_pc.toExponential(2)}</span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-6 bg-slate-900/50 border-t border-white/10 flex space-x-4">
          <button
            onClick={handleVeto}
            className="flex-1 flex items-center justify-center space-x-2 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-semibold transition-colors border border-white/10"
          >
            <XCircle className="w-5 h-5 text-red-400" />
            <span>VETO</span>
          </button>
          <button
            onClick={handleApprove}
            className="flex-[2] flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-500 text-white py-3 rounded-xl font-bold transition-colors shadow-[0_0_20px_rgba(22,163,74,0.4)]"
          >
            <CheckCircle className="w-5 h-5" />
            <span>APPROVE MANEUVER</span>
          </button>
        </div>
      </div>
    </div>
  );
};
