import React, { useState, useEffect, useRef } from 'react';
import { useSpaceStore } from '../../store/useSpaceStore';
import { ShieldAlert, Check, X, Clock } from 'lucide-react';
import { Tooltip } from '../Tooltip';

// Seconds an operator has to review a proposed maneuver before it is
// auto-vetoed. Auto-veto is a fail-safe, not a bypass: the LangGraph run is
// halted at `interrupt_before=["await_hitl"]` and cannot execute a burn
// without an explicit decision either way.
//
// Configurable because a live walkthrough narrates the numbers on this panel,
// and a review window that expires mid-sentence would veto a maneuver the
// operator was in the middle of approving. Whatever value is set here is the
// value shown on screen and the value we quote.
const REVIEW_WINDOW_S = Number(import.meta.env.VITE_HITL_TIMEOUT_S ?? 60);

// Fixed panel height in px. Substantial enough to read as the demo's one
// human decision point (200-240px), not a sliver. CameraDirector.tsx reads
// this same value (PANEL_HEIGHT_PX) to size how far it lifts the globe
// while this panel is open -- keep the two in sync if this changes.
export const HITL_PANEL_HEIGHT_PX = 224;
// Matches App.tsx's mission-control log column width exactly, so the panel's
// right edge always lands exactly where the log column begins, at any
// viewport width.
const LOG_COLUMN_WIDTH = 'clamp(18rem,22vw,28rem)';

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
  const [timeLeft, setTimeLeft] = useState(REVIEW_WINDOW_S);
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
      setTimeLeft(REVIEW_WINDOW_S);
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
          `Maneuver ${decision} failed: the backend did not confirm. Nothing was executed.`,
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
    if (pc === null) return "-";
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
    // Thresholds are fractions of the window so the colour ramp reads the
    // same whatever REVIEW_WINDOW_S is set to.
    if (timeLeft < REVIEW_WINDOW_S / 6) return 'bg-red-500';
    if (timeLeft < REVIEW_WINDOW_S / 2) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const timerWidth = (timeLeft / REVIEW_WINDOW_S) * 100;

  const riskBeforeWidth = riskWidth(pc_before);
  const riskAfterWidth = riskWidth(pc_after);

  // Real burn timestamp from the proposal instead of a hardcoded "60 min".
  const burnDate = new Date(proposal.burn_time);
  const burnLabel = isNaN(burnDate.getTime())
    ? '-'
    : `${burnDate.toISOString().slice(11, 16)} UTC`;
  const missBeforeKm = conj ? conj.miss_distance_km : null;

  return (
    <div
      style={{ height: `${HITL_PANEL_HEIGHT_PX}px`, right: LOG_COLUMN_WIDTH }}
      className={`fixed bottom-0 left-0 bg-[#0f172a] border-t-4 border-red-500 z-50 text-white shadow-[0_-10px_40px_rgba(0,0,0,0.5)] flex flex-col font-mono transition-transform duration-300 ease-out ${mounted ? 'translate-y-0' : 'translate-y-full'}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-black/20 shrink-0">
        <div className="flex items-center space-x-2 text-red-500 font-bold text-base tracking-wider">
          <ShieldAlert className="w-5 h-5" />
          <Tooltip text="Human-In-The-Loop: every maneuver requires explicit human approval before execution. No AI acts without oversight." position="top">
            <span>MANEUVER AUTHORIZATION REQUIRED</span>
          </Tooltip>
        </div>
        <div className={`flex items-center space-x-1.5 text-base font-bold ${timeLeft < REVIEW_WINDOW_S / 3 ? 'text-red-500 animate-pulse' : 'text-gray-300'}`}>
          <Clock className="w-4 h-4" />
          <span>{timeLeft}s</span>
        </div>
      </div>

      {/* AI Rationale: the single most judge-facing sentence in the app --
          the LLM explaining a real decision -- so it gets a prominent spot
          at the top with room to actually be read, not a truncated line at
          the bottom. */}
      {proposal.rationale && (
        <div className="px-4 py-2 border-b border-white/10 bg-blue-500/10 shrink-0">
          <div className="flex items-baseline gap-2">
            <span className="text-blue-400 font-bold text-[11px] tracking-widest shrink-0">
              AI RATIONALE
            </span>
            <p className="text-sm text-gray-100 leading-snug line-clamp-2" title={proposal.rationale}>
              {proposal.rationale}
            </p>
          </div>
        </div>
      )}

      {/* Main Content. overflow-y-auto is a safety net, not the intended
          look: below the lg breakpoint this stacks vertically and needs
          more than the panel's fixed height, so it scrolls internally
          instead of bleeding out over the globe above it. */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center flex-1 min-h-0 overflow-y-auto px-4 py-3 gap-3 lg:gap-4">
        {/* Left: Maneuver Details */}
        <div className="grid grid-cols-4 gap-x-3 gap-y-1.5 text-sm lg:w-[34%] lg:border-r border-white/10 lg:pr-4">
          <span className="text-gray-400">SATELLITE</span>
          <span className="font-bold text-right truncate">{proposal.satellite_name}</span>
          <span className="text-gray-400">OPERATOR</span>
          <span className="font-bold text-right truncate">{proposal.operator}</span>

          <span className="text-gray-400">
            <Tooltip text="Delta-V: the velocity change produced by a thruster burn. Computed using Clohessy-Wiltshire relative motion equations." position="top">
              <span className="border-b border-dashed border-gray-600">ΔV</span>
            </Tooltip>
          </span>
          <span className="font-bold text-blue-400 text-right truncate">
            {proposal.delta_v_ms.toFixed(3)} m/s{' '}
            <Tooltip text="Along the direction of orbital travel. Most fuel-efficient for changing arrival time at the conjunction point." position="top">
              <span className="border-b border-dashed border-blue-800">{proposal.burn_direction}</span>
            </Tooltip>
          </span>
          <span className="text-gray-400">BURN AT</span>
          <span className="font-bold text-yellow-400 text-right truncate">{burnLabel}</span>

          <span className="text-gray-400">MISS DIST.</span>
          <span className="font-bold text-green-400 text-right col-span-3 truncate">
            {missBeforeKm !== null ? `${missBeforeKm.toFixed(2)}` : '-'}
            {' → '}
            {proposal.post_maneuver_miss_km.toFixed(2)} km
          </span>
        </div>

        {/* Right: Risk Comparison */}
        <div className="flex flex-1 gap-3 lg:gap-6 items-center">
          {/* Before */}
          <div className="flex-1 bg-black/30 rounded-lg px-3 py-2 border border-white/10 flex items-center gap-3">
            <div className="flex flex-col items-start shrink-0">
              <span className="text-gray-400 font-bold tracking-widest text-[10px]">BEFORE</span>
              <span className="text-3xl font-bold text-red-500 leading-tight">{formatPcFraction(pc_before)}</span>
            </div>
            <div className="flex-1 flex flex-col gap-0.5">
              <div className="text-red-400 text-xs">
                <Tooltip text="Probability of Collision: how likely a physical impact is at closest approach. Industry alert threshold: 1 in 10,000 (1×10⁻⁴). We target below 1 in 1,000,000." position="top">
                  <span className="border-b border-dashed border-red-800">Pc</span>
                </Tooltip>
                : {pc_before !== null ? pc_before.toExponential(2) : '-'}
              </div>
              <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-red-500" style={{ width: `${riskBeforeWidth}%` }}></div>
              </div>
            </div>
          </div>

          {/* After */}
          <div className="flex-1 bg-black/30 rounded-lg px-3 py-2 border border-white/10 flex items-center gap-3">
            <div className="flex flex-col items-start shrink-0">
              <span className="text-gray-400 font-bold tracking-widest text-[10px]">AFTER</span>
              <span className="text-3xl font-bold text-green-500 leading-tight">{formatPcFraction(pc_after)}</span>
            </div>
            <div className="flex-1 flex flex-col gap-0.5">
              <div className="text-green-400 text-xs">
                <Tooltip text="Probability of Collision: how likely a physical impact is at closest approach. Industry alert threshold: 1 in 10,000 (1×10⁻⁴). We target below 1 in 1,000,000." position="top">
                  <span className="border-b border-dashed border-green-800">Pc</span>
                </Tooltip>
                : {pc_after.toExponential(2)}
              </div>
              <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-green-500" style={{ width: `${riskAfterWidth}%` }}></div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-center gap-3 shrink-0">
          <button
            onClick={() => handleAction('approve')}
            disabled={submitting}
            className="flex items-center space-x-2 px-7 py-2.5 bg-[#22c55e] hover:bg-[#16a34a] disabled:bg-green-900 disabled:cursor-not-allowed text-white font-bold rounded shadow-[0_0_16px_rgba(34,197,94,0.3)] transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-green-300/60"
          >
            <Check className="w-4 h-4" />
            <span className="text-base tracking-wider whitespace-nowrap">
              {submitting ? 'EXECUTING…' : 'APPROVE'}
            </span>
          </button>

          <button
            onClick={() => handleAction('veto')}
            disabled={submitting}
            className="flex items-center space-x-2 px-6 py-2.5 bg-red-600 hover:bg-red-500 disabled:bg-red-900 disabled:cursor-not-allowed text-white font-bold rounded transition-colors focus:outline-none focus:ring-2 focus:ring-red-300/60"
          >
            <X className="w-4 h-4" />
            <span className="text-base tracking-wider">VETO</span>
          </button>
        </div>
      </div>

      {/* Countdown Bar */}
      <div className="relative h-1.5 bg-gray-800">
        <div
          className={`h-full transition-all duration-1000 ease-linear ${getTimerColor()}`}
          style={{ width: `${timerWidth}%`, float: 'right' }}
        ></div>
      </div>
    </div>
  );
};
