import React from 'react';
import { useSpaceStore } from '../../store/useSpaceStore';
import { ShieldAlert, CheckCircle2, Rocket, Zap } from 'lucide-react';

export const MetricsBar: React.FC = () => {
  const { metrics } = useSpaceStore();

  return (
    <div className="w-full h-12 bg-[#0a0f1e] border-b border-white/10 flex items-center justify-between px-6 shrink-0 z-50">
      <div className="flex items-center space-x-3">
        <h1 className="text-xl font-bold tracking-wider text-white">SpaceATC</h1>
      </div>

      <div className="flex items-center space-x-6 text-sm font-medium">
        <div className="flex items-center space-x-2 text-blue-400">
          <Rocket className="w-4 h-4" />
          <span>Active Satellites: <strong className="text-white">{metrics.active_satellites}</strong></span>
        </div>
        <div className="text-gray-600">|</div>
        <div className="flex items-center space-x-2 text-red-400">
          <ShieldAlert className="w-4 h-4" />
          <span>Conjunctions: <strong className="text-white">{metrics.conjunctions_detected}</strong></span>
        </div>
        <div className="text-gray-600">|</div>
        <div className="flex items-center space-x-2 text-green-400">
          <CheckCircle2 className="w-4 h-4" />
          <span>Resolved: <strong className="text-white">{metrics.resolved}</strong></span>
        </div>
        <div className="text-gray-600">|</div>
        <div className="flex items-center space-x-2 text-purple-400">
          <Zap className="w-4 h-4" />
          <span>Maneuvers: <strong className="text-white">{metrics.maneuvers_executed}</strong></span>
        </div>
        <div className="text-gray-600">|</div>
        <div className="flex items-center space-x-2 text-amber-400">
          <span>Total ΔV: <strong className="text-white">{metrics.total_delta_v.toFixed(3)} m/s</strong></span>
        </div>
        <div className="text-gray-600">|</div>
        <div className="flex items-center space-x-2">
          <span className="relative flex h-3 w-3">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${metrics.system_status === 'ACTIVE' ? 'bg-green-400' : 'bg-red-400'}`}></span>
            <span className={`relative inline-flex rounded-full h-3 w-3 ${metrics.system_status === 'ACTIVE' ? 'bg-green-500' : 'bg-red-500'}`}></span>
          </span>
          <span className="text-sm tracking-widest text-gray-300">{metrics.system_status}</span>
        </div>
      </div>
    </div>
  );
};
