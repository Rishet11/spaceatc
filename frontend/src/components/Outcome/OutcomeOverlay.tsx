import React, { useEffect } from 'react';
import { useSpaceStore } from '../../store/useSpaceStore';
import { ShieldCheck, AlertTriangle, ArrowRight } from 'lucide-react';

/**
 * Full-screen cinematic feedback for a human decision. Renders the instant the
 * operator clicks APPROVE / VETO (driven by store.decisionOutcome): a brief
 * colour flash plus a headline banner that spells out the consequence, so the
 * weight of the choice lands immediately. Auto-dismisses after ~4s.
 */
export const OutcomeOverlay: React.FC = () => {
  const decisionOutcome = useSpaceStore(s => s.decisionOutcome);
  const setDecisionOutcome = useSpaceStore(s => s.setDecisionOutcome);

  useEffect(() => {
    if (decisionOutcome) {
      const t = setTimeout(() => setDecisionOutcome(null), 4200);
      return () => clearTimeout(t);
    }
  }, [decisionOutcome, setDecisionOutcome]);

  if (!decisionOutcome) return null;

  const approved = decisionOutcome.decision === 'approve';
  const { satA, satB, satelliteName, deltaV, pcBefore, pcAfter } = decisionOutcome;

  const formatPc = (pc: number) => (pc <= 0 ? 'SAFE' : `1 in ${Math.round(1 / pc).toLocaleString()}`);
  const riskReduction = pcAfter > 0 ? Math.round(pcBefore / pcAfter) : null;

  return (
    <div className="fixed inset-0 z-[70] pointer-events-none flex flex-col items-center justify-start font-mono">
      {/* Full-screen colour flash */}
      <div
        className={`absolute inset-0 animate-outcome-flash ${
          approved ? 'bg-green-500' : 'bg-red-600'
        }`}
      />

      {/* Headline banner */}
      <div
        className={`relative mt-28 animate-outcome-pop rounded-2xl border-2 px-10 py-6 backdrop-blur-md text-center shadow-2xl ${
          approved
            ? 'border-green-400 bg-green-950/80 shadow-[0_0_60px_rgba(34,197,94,0.5)]'
            : 'border-red-500 bg-red-950/80 shadow-[0_0_60px_rgba(239,68,68,0.6)]'
        }`}
      >
        <div className="flex items-center justify-center space-x-3">
          {approved ? (
            <ShieldCheck className="w-9 h-9 text-green-400" />
          ) : (
            <AlertTriangle className="w-9 h-9 text-red-400 animate-pulse" />
          )}
          <h1
            className={`text-3xl md:text-4xl font-black tracking-widest ${
              approved ? 'text-green-300' : 'text-red-300'
            }`}
          >
            {approved ? 'COLLISION AVOIDED' : 'COLLISION NOT PREVENTED'}
          </h1>
        </div>

        <div
          className={`mt-1 text-sm tracking-[0.3em] font-bold ${
            approved ? 'text-green-500' : 'text-red-500'
          }`}
        >
          {approved ? 'MANEUVER EXECUTED' : 'MANEUVER VETOED · DEBRIS FIELD GENERATED'}
        </div>

        {/* Consequence detail */}
        {approved ? (
          <div className="mt-5 flex items-center justify-center space-x-8 text-sm">
            <div className="flex flex-col">
              <span className="text-gray-400 text-xs tracking-wider">SATELLITE</span>
              <span className="font-bold text-white">{satelliteName}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-gray-400 text-xs tracking-wider">ΔV APPLIED</span>
              <span className="font-bold text-blue-300">{deltaV.toFixed(3)} m/s</span>
            </div>
            <div className="flex flex-col">
              <span className="text-gray-400 text-xs tracking-wider">COLLISION RISK</span>
              <span className="flex items-center font-bold">
                <span className="text-red-400">{formatPc(pcBefore)}</span>
                <ArrowRight className="w-4 h-4 mx-2 text-gray-500" />
                <span className="text-green-400">{formatPc(pcAfter)}</span>
              </span>
            </div>
            {riskReduction && (
              <div className="flex flex-col">
                <span className="text-gray-400 text-xs tracking-wider">RISK CUT BY</span>
                <span className="font-bold text-green-300">{riskReduction.toLocaleString()}×</span>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-5 flex items-center justify-center space-x-8 text-sm">
            <div className="flex flex-col">
              <span className="text-gray-400 text-xs tracking-wider">SATELLITES LOST</span>
              <span className="font-bold text-red-300">
                {[satA, satB].filter(Boolean).join('  ·  ')}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-gray-400 text-xs tracking-wider">REALIZED RISK</span>
              <span className="font-bold text-red-400">{formatPc(pcBefore)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-gray-400 text-xs tracking-wider">EST. DEBRIS</span>
              <span className="font-bold text-orange-300">3,000+ fragments</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
