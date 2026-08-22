import React, { useState, useEffect, useRef } from 'react';
import { useSpaceStore } from '../../store/useSpaceStore';
import { ShieldAlert, Check, X, Clock } from 'lucide-react';
import { Tooltip } from '../Tooltip';

export const HITLPanel: React.FC = () => {
  const {
    currentHitlRequest,
    setHitlRequest,
    activeConjunctions,
    setActiveConjunctions,
    setActiveMathTrace,
    setResolvedEvent,
    setDecisionOutcome,
    setManeuverSummary,
    setPipelineStage,
    addToast,
  } = useSpaceStore();
  const [timeLeft, setTimeLeft] = useState(30);
  const [mounted, setMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Guards re-entry from every source at once: double-click, the auto-veto
  // timer, and React StrictMode's double-invocation in dev.
  const inFlightRef = useRef(false);
  // Always points at the current render's handleAction so the countdown does
  // not fire a decision built from a stale closure.
  const actionRef = useRef<(d: 'approve' | 'veto') => void>(() => {});

  useEffect(() => {
    if (currentHitlRequest) {
      // Trigger slide-up animation shortly after mount
      requestAnimationFrame(() => setMounted(true));

      inFlightRef.current = false;
      setSubmitting(false);
      setTimeLeft(30);
      // The interval only decrements. Firing the auto-veto from inside the
      // updater made it a side effect inside a state updater, which React
      // StrictMode double-invokes in development -- producing two veto POSTs.
      const timer = setInterval(() => {
        setTimeLeft(t => (t <= 0 ? 0 : t - 1));
      }, 1000);
      return () => clearInterval(timer);
    } else {
      setMounted(false);
    }
  }, [currentHitlRequest]);

  // Auto-veto is driven off the rendered value, not from inside the updater.
  useEffect(() => {
    if (currentHitlRequest && timeLeft === 0) actionRef.current('veto');
  }, [timeLeft, currentHitlRequest]);

  if (!currentHitlRequest) return null;

  const { payload } = currentHitlRequest;
  const { event_id, proposal } = payload;
  
  const conj = activeConjunctions.find(c => c.event_id === event_id);
  // No fabricated fallback: if the conjunction row has not arrived yet we show
  // an em dash rather than inventing a 1-in-100 collision probability.
  const pc_before = conj ? conj.pc : null;
  const pc_after = proposal.post_maneuver_pc;

  const handleAction = async (decision: 'approve' | 'veto') => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setMounted(false); // trigger slide down

    const satA = conj?.sat_primary ?? proposal.satellite_name;
    const satB = conj?.sat_secondary ?? '';

    setDecisionOutcome({
      decision,
      eventId: event_id,
      satA,
      satB,
      satelliteName: proposal.satellite_name,
      operator: proposal.operator,
      deltaV: proposal.delta_v_ms,
      burnDirection: proposal.burn_direction,
      pcBefore: pc_before ?? proposal.post_maneuver_pc,
      pcAfter: pc_after,
      timestamp: Date.now(),
    });

    if (decision === 'approve') {
      // Judge-readable summary built from real proposal fields. The raw
      // computation trace rides along but is collapsed by default.
      setManeuverSummary({
        eventId: event_id,
        satelliteName: proposal.satellite_name,
        operator: proposal.operator,
        deltaV: proposal.delta_v_ms,
        burnDirection: proposal.burn_direction,
        burnTime: proposal.burn_time,
        missBeforeKm: conj ? conj.miss_distance_km : null,
        missAfterKm: proposal.post_maneuver_miss_km,
        pcBefore: pc_before,
        pcAfter: pc_after,
        fuelCostUnits: proposal.fuel_cost_units ?? null,
        trace: proposal.computation_trace || [],
      });
      if (conj) {
        setResolvedEvent({ satA, satB, timestamp: Date.now() });
      }
    } else {
      setPipelineStage('collision');
    }

    setTimeout(async () => {
      try {
        const res = await fetch(`/api/hitl/${event_id}/${decision}`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const listRes = await fetch('/api/conjunctions');
        setActiveConjunctions(await listRes.json());
      } catch (e) {
        // Do not leave the UI asserting an outcome the backend never confirmed.
        console.error(`Failed to ${decision}`, e);
        addToast(
          `Maneuver ${decision} failed — the backend did not confirm. Nothing was executed.`,
          'error'
        );
        setDecisionOutcome(null);
        setResolvedEvent(null);
        setManeuverSummary(null);
      }
      setHitlRequest(null);
      setSubmitting(false);
    }, 300); // wait for animation to complete
  };

  actionRef.current = handleAction;

  const formatPcFraction = (pc: number | null) => {
    if (pc === null) return "\u2014";
    if (pc <= 0) return "SAFE";
    return "1 in " + Math.round(1 / pc).toLocaleString();
  };

  // Real Pc values span 1e-3 down to 1e-6. On a linear scale against a
  // hardcoded 0.01 ceiling both bars were nearly empty, which squashed the
  // most dramatic comparison in the demo. Log scale between the industry alert
  // threshold (1e-4) and our target (1e-6) makes the drop visible.
  const riskWidth = (pc: number | null) => {
    if (pc === null || pc <= 0) return 0;
    const hi = Math.log10(1e-3);
    const lo = Math.log10(1e-7);
    return Math.max(2, Math.min(100, ((Math.log10(pc) - lo) / (hi - lo)) * 100));
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

  const riskBeforeWidth = riskWidth(pc_before);
  const riskAfterWidth = riskWidth(pc_after);

  // Real burn timestamp from the proposal instead of a hardcoded "60 min".
  const burnDate = new Date(proposal.burn_time);
  const burnLabel = isNaN(burnDate.getTime())
    ? '\u2014'
    : `${burnDate.toISOString().slice(11, 16)} UTC`;
  const missBeforeKm = conj ? conj.miss_distance_km : null;

  return (
    <div 
      className={`fixed bottom-0 left-0 right-0 h-auto min-h-[280px] bg-[#0f172a] border-t-4 border-red-500 z-50 text-white shadow-[0_-10px_40px_rgba(0,0,0,0.5)] flex flex-col font-mono transition-transform duration-300 ease-out ${mounted ? 'translate-y-0' : 'translate-y-full'}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-black/20">
        <div className="flex items-center space-x-3 text-red-500 font-bold text-lg tracking-wider">
          <ShieldAlert className="w-6 h-6" />
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
      <div className="flex flex-col lg:flex-row flex-1 p-6 gap-5 lg:gap-0">
        {/* Left Column: Maneuver Details */}
        <div className="w-full lg:w-1/3 flex flex-col justify-center space-y-4 text-sm lg:border-r border-white/10 lg:pr-6">
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
            <span className="text-gray-400">BURN AT:</span>
            <span className="font-bold text-yellow-400">{burnLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">MISS DISTANCE:</span>
            <span className="font-bold text-green-400">
              {missBeforeKm !== null ? `${missBeforeKm.toFixed(3)}` : '\u2014'}
              {' \u2192 '}
              {proposal.post_maneuver_miss_km.toFixed(3)} km
            </span>
          </div>
          {proposal.rationale && (
            <div className="flex justify-between">
              <span className="text-gray-400 shrink-0 mr-3">AI RATIONALE:</span>
              <span className="text-xs text-gray-500 text-right">{proposal.rationale}</span>
            </div>
          )}
        </div>

        {/* Right Column: Risk Comparison */}
        <div className="w-full lg:w-2/3 flex px-0 lg:px-6 gap-4 lg:gap-8 items-center justify-center">
          {/* Before */}
          <div className="flex-1 bg-black/30 rounded-xl p-4 border border-white/10 flex flex-col items-center">
            <div className="text-gray-400 mb-2 font-bold tracking-widest text-xs">BEFORE MANEUVER</div>
            <div className="text-red-400 text-sm mb-1">
              <Tooltip text="Probability of Collision — how likely a physical impact is at closest approach. Industry alert threshold: 1 in 10,000 (1×10⁻⁴). We target below 1 in 1,000,000." position="top">
                <span className="border-b border-dashed border-red-800">Pc</span>
              </Tooltip>
              : {pc_before !== null ? pc_before.toExponential(2) : '\u2014'}
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
            disabled={submitting}
            className="flex items-center space-x-3 px-12 py-4 bg-[#22c55e] hover:bg-[#16a34a] disabled:bg-green-900 disabled:cursor-not-allowed text-white font-bold rounded shadow-[0_0_16px_rgba(34,197,94,0.3)] transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-green-300/60"
          >
            <Check className="w-6 h-6" />
            <span className="text-xl tracking-wider">
              {submitting ? 'EXECUTING\u2026' : 'APPROVE MANEUVER'}
            </span>
          </button>

          <button
            onClick={() => handleAction('veto')}
            disabled={submitting}
            className="flex items-center space-x-2 px-8 py-4 bg-red-600 hover:bg-red-500 disabled:bg-red-900 disabled:cursor-not-allowed text-white font-bold rounded transition-colors focus:outline-none focus:ring-2 focus:ring-red-300/60"
          >
            <X className="w-5 h-5" />
            <span className="text-lg tracking-wider">VETO</span>
          </button>
        </div>
      </div>
    </div>
  );
};
