import React, { useState, useEffect } from 'react';
import { useSpaceStore } from '../../store/useSpaceStore';
import { ChevronRight, TrendingUp, ShieldCheck } from 'lucide-react';
import { Tooltip } from '../Tooltip';

/** The actual method this codebase uses (backend/orbital/conjunction.py):
 * a simplified 2D Gaussian model, since TLEs carry no covariance to feed a
 * real Akella-Alfriend calculation. Stated plainly rather than implying a
 * textbook method this code doesn't run. */
const PC_METHOD_EXPLANATION =
  'Simplified 2D Gaussian model. TLEs carry no covariance, so this assumes ' +
  'a fixed 1-sigma position uncertainty of 1 km and a 10 m combined hard-body ' +
  'radius: Pc = pi * r^2 / sigma^2 * exp(-0.5 * (miss distance / sigma)^2).';

/** Format a probability as "1 in N", which reads faster than an exponent. */
const asOdds = (pc: number) => {
  if (!isFinite(pc) || pc <= 0) return 'negligible';
  return `1 in ${Math.round(1 / pc).toLocaleString()}`;
};

/**
 * Resolution summary shown after a maneuver is approved.
 *
 * This replaces a full-screen modal that dumped all 32 rows of the backend's
 * computation trace — 25 of which were raw binary-search iterations. That hid
 * the globe at the exact moment the satellite maneuvers, and the three rows
 * that actually mattered were lost in the noise. The derivation is still one
 * click away, so the credibility of "we really computed this" is preserved.
 */
export const MathPanel: React.FC = () => {
  const summary = useSpaceStore((s) => s.maneuverSummary);
  const result = useSpaceStore((s) => s.maneuverResult);
  const [showTrace, setShowTrace] = useState(false);

  useEffect(() => {
    if (!summary) setShowTrace(false);
  }, [summary]);

  if (!summary) return null;

  // Prefer the backend-confirmed numbers once maneuver_executed lands; until
  // then show the proposal's own predicted values.
  const confirmed = result && result.event_id === summary.eventId ? result : null;
  const missBefore = confirmed?.miss_km_before ?? summary.missBeforeKm;
  const missAfter = confirmed?.miss_km_after ?? summary.missAfterKm;
  const pcBefore = confirmed?.pc_before ?? summary.pcBefore;
  const pcAfter = confirmed?.pc_after ?? summary.pcAfter;
  const deltaV = confirmed?.delta_v_ms ?? summary.deltaV;

  const missGain =
    missBefore !== null && missBefore > 0 ? missAfter / missBefore : null;

  const burnLabel = (() => {
    const d = new Date(summary.burnTime);
    return isNaN(d.getTime())
      ? null
      : `${d.toISOString().slice(11, 19)} UTC`;
  })();

  return (
    <div className="pointer-events-auto fixed left-4 top-20 z-[55] w-[min(92vw,380px)] font-mono">
      <div className="bg-[#0b1220]/95 backdrop-blur-sm border border-green-500/40 rounded-lg shadow-[0_0_30px_rgba(34,197,94,0.15)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-green-500/10 border-b border-green-500/30">
          <ShieldCheck className="w-4 h-4 text-green-400" />
          <span className="text-green-300 font-bold tracking-widest text-[11px]">
            MANEUVER RESOLVED
          </span>
          <span className="ml-auto text-[10px] text-gray-400">
            {confirmed ? 'CONFIRMED' : 'EXECUTING…'}
          </span>
        </div>

        {/* Headline: the separation actually gained */}
        <div className="px-4 pt-3 pb-2">
          <div className="text-[10px] tracking-widest text-gray-400 mb-1">
            MISS DISTANCE AT CLOSEST APPROACH
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl text-red-400 line-through decoration-red-500/50">
              {missBefore !== null ? `${missBefore.toFixed(3)} km` : '—'}
            </span>
            <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
            <span className="text-2xl font-bold text-green-400">
              {missAfter.toFixed(3)} km
            </span>
          </div>
          {missGain !== null && (
            <div className="flex items-center gap-1 mt-1 text-[11px] text-green-300">
              <TrendingUp className="w-3 h-3" />
              <span>{missGain.toFixed(1)}x more separation</span>
            </div>
          )}
        </div>

        {/* Collision probability */}
        <div className="px-4 py-2 border-t border-white/10">
          <Tooltip text={PC_METHOD_EXPLANATION} position="bottom">
            <div className="text-[10px] tracking-widest text-gray-400 mb-1 cursor-help underline decoration-dotted decoration-gray-600 underline-offset-2 w-fit">
              COLLISION PROBABILITY
            </div>
          </Tooltip>
          <div className="flex items-baseline gap-2 text-[13px]">
            <span className="text-red-400">
              {pcBefore !== null ? asOdds(pcBefore) : '—'}
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            <span className="text-green-400 font-bold">{asOdds(pcAfter)}</span>
          </div>
        </div>

        {/* Cost of the fix */}
        <div className="px-4 py-2 border-t border-white/10 flex items-center justify-between text-[12px]">
          <span className="text-gray-400 text-[10px] tracking-widest">FUEL COST</span>
          <span className="text-blue-300 font-bold">
            {deltaV.toFixed(3)} m/s{' '}
            <span className="text-gray-400 font-normal">{summary.burnDirection}</span>
          </span>
        </div>
        {burnLabel && (
          <div className="px-4 pb-2 flex items-center justify-between text-[11px]">
            <span className="text-gray-400 text-[10px] tracking-widest">BURN AT</span>
            <span className="text-gray-300">{burnLabel}</span>
          </div>
        )}

        {/* Derivation, collapsed by default */}
        {summary.trace.length > 0 && (
          <div className="border-t border-white/10">
            <button
              onClick={() => setShowTrace((v) => !v)}
              className="w-full flex items-center gap-1.5 px-4 py-2 text-[10px] tracking-widest text-gray-400 hover:text-green-300 transition-colors focus:outline-none focus:text-green-300"
            >
              <ChevronRight
                className={`w-3 h-3 transition-transform ${showTrace ? 'rotate-90' : ''}`}
              />
              <span>{showTrace ? 'HIDE' : 'SHOW'} DERIVATION ({summary.trace.length} STEPS)</span>
            </button>
            {showTrace && (
              <div className="max-h-52 overflow-y-auto custom-scrollbar px-4 pb-3 space-y-0.5 text-[10px] leading-relaxed">
                {summary.trace.map((item, idx) => (
                  // Index-based key: the backend emits duplicate `t` values
                  // (binary-search rows use t=4..28 while the three result rows
                  // are hardcoded to t=15,16,17), so keying on `t` silently
                  // dropped exactly the rows that matter.
                  <div key={idx} className="flex justify-between gap-3">
                    <span className="text-green-400/70 shrink-0">{item.text}</span>
                    <span className="text-gray-300 text-right">{item.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
