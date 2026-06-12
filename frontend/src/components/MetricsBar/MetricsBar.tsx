import React from 'react';
import { useSpaceStore } from '../../store';
import { Activity, ShieldAlert, CheckCircle2, Rocket, Zap, Play } from 'lucide-react';

export const MetricsBar: React.FC = () => {
  const {
    systemStatus,
    activeSatellitesCount,
    conjunctionsDetected,
    conjunctionsResolved,
    maneuversExecuted,
    totalDeltaV,
  } = useSpaceStore();

  const handleDemoInject = async () => {
    try {
      await fetch('http://127.0.0.1:8000/api/demo/inject', { method: 'POST' });
    } catch (e) {
      console.error("Failed to inject demo", e);
    }
  };

  return (
    <div className="absolute top-0 left-0 w-full h-14 bg-black/60 backdrop-blur-md border-b border-white/10 flex items-center justify-between px-6 z-50">
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
          <Activity className="w-5 h-5 text-white" />
        </div>
        <h1 className="text-xl font-bold tracking-wider text-white">SpaceATC</h1>
      </div>

      <div className="flex items-center space-x-8 text-sm font-medium">
        <div className="flex items-center space-x-2 text-blue-400">
          <Rocket className="w-4 h-4" />
          <span>Active: <strong className="text-white">{activeSatellitesCount}</strong></span>
        </div>
        <div className="flex items-center space-x-2 text-red-400">
          <ShieldAlert className="w-4 h-4" />
          <span>Conjunctions: <strong className="text-white">{conjunctionsDetected}</strong></span>
        </div>
        <div className="flex items-center space-x-2 text-green-400">
          <CheckCircle2 className="w-4 h-4" />
          <span>Resolved: <strong className="text-white">{conjunctionsResolved}</strong></span>
        </div>
        <div className="flex items-center space-x-2 text-purple-400">
          <Zap className="w-4 h-4" />
          <span>Maneuvers: <strong className="text-white">{maneuversExecuted}</strong></span>
        </div>
        <div className="flex items-center space-x-2 text-amber-400">
          <span>ΔV Saved: <strong className="text-white">{totalDeltaV.toFixed(2)} m/s</strong></span>
        </div>
      </div>

      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2">
          <span className="relative flex h-3 w-3">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${systemStatus === 'ACTIVE' ? 'bg-green-400' : 'bg-red-400'}`}></span>
            <span className={`relative inline-flex rounded-full h-3 w-3 ${systemStatus === 'ACTIVE' ? 'bg-green-500' : 'bg-red-500'}`}></span>
          </span>
          <span className="text-sm tracking-widest text-gray-300">{systemStatus}</span>
        </div>
        
        <button 
          onClick={handleDemoInject}
          className="flex items-center space-x-2 bg-white/10 hover:bg-white/20 transition-colors border border-white/20 rounded-full px-4 py-1.5 text-sm font-semibold"
        >
          <Play className="w-4 h-4 text-green-400" />
          <span>Demo Inject</span>
        </button>
      </div>
    </div>
  );
};
