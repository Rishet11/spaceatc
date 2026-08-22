import React, { useState, useEffect, useRef } from 'react';
import { useSpaceStore } from '../../store/useSpaceStore';
import { ShieldAlert, CheckCircle2, Rocket, Zap, Clock } from 'lucide-react';
import { Tooltip } from '../Tooltip';

const SPEED_OPTIONS = [1, 10, 60, 300, 600];

function formatSimTime(isoStr: string): string {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
    );
  } catch {
    return '-';
  }
}

export const MetricsBar: React.FC = () => {
  const { metrics, simSpeed, simTime, activeTab, setActiveTab } = useSpaceStore();
  const [pendingSpeed, setPendingSpeed] = useState<number | null>(null);
  const [displayTime, setDisplayTime] = useState<string>('');

  // Locally advance the sim clock each second between WS updates
  const simTimeRef = useRef(simTime);
  const simSpeedRef = useRef(simSpeed);
  const lastUpdateRef = useRef(Date.now());

  useEffect(() => {
    simTimeRef.current = simTime;
    simSpeedRef.current = simSpeed;
    lastUpdateRef.current = Date.now();
    setDisplayTime(formatSimTime(simTime));
  }, [simTime, simSpeed]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!simTimeRef.current) return;
      const elapsedMs = Date.now() - lastUpdateRef.current;
      const simMs = elapsedMs * simSpeedRef.current;
      const advanced = new Date(new Date(simTimeRef.current).getTime() + simMs);
      setDisplayTime(formatSimTime(advanced.toISOString()));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const handleSpeedSelect = async (speed: number) => {
    setPendingSpeed(speed);
    try {
      const res = await fetch('/api/sim/speed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speed }),
      });
      if (!res.ok) throw new Error('Failed');
    } catch (e) {
      console.error('Speed change failed:', e);
    } finally {
      setPendingSpeed(null);
    }
  };

  return (
    <div className="w-full bg-[#0a0f1e] border-b border-white/10 shrink-0 z-50">
      {/* Top row — metrics */}
      <div className="flex items-center justify-between px-6 h-12">
        <div className="flex items-center space-x-6">
          <h1 className="text-xl font-bold tracking-wider text-white">SpaceATC</h1>
          <div className="flex items-center space-x-1 bg-black/40 rounded-lg p-0.5 border border-white/5">
            <button
              onClick={() => setActiveTab('ground')}
              className={`px-3 py-1 text-[10px] font-mono font-bold tracking-wider uppercase rounded transition-all cursor-pointer ${
                activeTab === 'ground'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Ground Negotiation
            </button>
            <button
              onClick={() => setActiveTab('reflex')}
              className={`px-3 py-1 text-[10px] font-mono font-bold tracking-wider uppercase rounded transition-all cursor-pointer ${
                activeTab === 'reflex'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Onboard Reflex
            </button>
          </div>
        </div>

        <div className="flex items-center space-x-6 text-sm font-medium">
          <div className="flex items-center space-x-2 text-blue-400">
            <Rocket className="w-4 h-4" />
            <Tooltip text="Real Starlink satellites tracked from CelesTrak's live orbital database. Updated every hour." position="bottom">
              <span>Active Satellites:</span>
            </Tooltip>
            <strong className="text-white">{metrics.active_satellites}</strong>
          </div>
          <div className="text-gray-600">|</div>
          <div className="flex items-center space-x-2 text-red-400">
            <ShieldAlert className="w-4 h-4" />
            <Tooltip text="Predicted close approaches where collision probability exceeds 1 in 10,000, the industry standard alert threshold." position="bottom">
              <span>Conjunctions:</span>
            </Tooltip>
            <strong className="text-white">{metrics.conjunctions_detected}</strong>
          </div>
          <div className="text-gray-600">|</div>
          <div className="flex items-center space-x-2 text-green-400">
            <CheckCircle2 className="w-4 h-4" />
            <Tooltip text="Conjunctions successfully resolved through autonomous agent negotiation and human approval." position="bottom">
              <span>Resolved:</span>
            </Tooltip>
            <strong className="text-white">{metrics.resolved}</strong>
          </div>
          <div className="text-gray-600">|</div>
          <div className="flex items-center space-x-2 text-purple-400">
            <Zap className="w-4 h-4" />
            <span>Maneuvers:</span> <strong className="text-white">{metrics.maneuvers_executed}</strong>
          </div>
          <div className="text-gray-600">|</div>
          <div className="flex items-center space-x-2 text-amber-400">
            <Tooltip text="Total fuel burned across all maneuvers. 0.1 m/s ≈ the speed of a slow walk, a tiny nudge that prevents catastrophic collision." position="bottom">
              <span>Total ΔV:</span>
            </Tooltip>
            {/* total_delta_v_ms is already in m/s end to end (conjunction.py
                converts km/s -> m/s once). The previous /1000 divided it a
                second time, pinning this headline metric at 0.000. */}
            <strong className="text-white">{metrics.total_delta_v_ms.toFixed(3)} m/s</strong>
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

      {/* Bottom row — sim clock + speed selector.
          Hidden on the Onboard Reflex tab: these control the orbital propagation
          speed of the globe, which isn't shown in Reflex mode (it has its own
          frame/playback controls), so they'd read as dead controls there. */}
      {activeTab === 'ground' && (
      <div className="flex items-center justify-between px-6 h-9 bg-[#060a14] border-t border-white/5">
        {/* Sim clock */}
        <div className="flex items-center space-x-2 text-xs font-mono">
          <Clock className="w-3.5 h-3.5 text-cyan-500" />
          <span className="text-gray-500 uppercase tracking-widest">Sim Time</span>
          <span className="text-cyan-300 font-semibold">{displayTime}</span>
          <span className="text-gray-600">|</span>
          <span className="text-yellow-400 font-bold">{simSpeed}× SPEED</span>
        </div>

        {/* Speed selector */}
        <div className="flex items-center space-x-2">
          <span
            className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mr-1"
            title="At 60×: Starlink satellites complete one orbit in ~90 seconds. At 1×: same orbit takes 90 minutes."
          >
            Sim Speed:
          </span>
          <div className="flex items-center space-x-1">
            {SPEED_OPTIONS.map((speed) => {
              const isActive = simSpeed === speed;
              const isPending = pendingSpeed === speed;
              return (
                <button
                  key={speed}
                  onClick={() => handleSpeedSelect(speed)}
                  disabled={isPending}
                  title={
                    speed === 1
                      ? '1×: Real time. Satellites barely move.'
                      : speed === 60
                        ? '60×: One orbit (~90 min) in 90 seconds.'
                        : speed === 300
                          ? '300×: Full orbit in 18 seconds.'
                          : speed === 600
                            ? '600×: Full orbit in 9 seconds.'
                            : `${speed}× simulation speed`
                  }
                  className={`
                    px-2 py-0.5 text-[11px] font-mono rounded transition-all duration-150
                    ${isActive
                      ? 'bg-blue-600 text-white border border-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.5)]'
                      : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10 hover:text-white'
                    }
                    ${isPending ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
                  `}
                >
                  {speed}×
                </button>
              );
            })}
          </div>
        </div>
      </div>
      )}
    </div>
  );
};
