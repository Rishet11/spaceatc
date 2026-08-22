import React from 'react';
import { useSpaceStore } from '../../store/useSpaceStore';
import { PipelineStage } from '../../types';

const STEPS = ['DETECT', 'NEGOTIATE', 'DECIDE', 'OUTCOME'];

const STAGE_INDEX: Record<PipelineStage, number> = {
  idle: -1,
  detected: 0,
  negotiating: 1,
  awaiting: 2,
  resolved: 3,
  collision: 3,
};

const CAPTIONS: Record<PipelineStage, string> = {
  idle: 'Monitoring tracked objects, no active conjunction',
  detected: 'Two satellites on a converging collision course',
  negotiating: 'Operators bidding to decide who maneuvers',
  awaiting: 'Awaiting human authorization for the avoidance maneuver',
  resolved: 'Maneuver executed, collision avoided',
  collision: 'Maneuver vetoed, collision occurred',
};

function useStage(): PipelineStage {
  // The stage is now driven explicitly from the WebSocket stream
  // (see useWebSocket.ts). The previous implementation derived it from
  // ConjunctionEvent.status, but the backend never writes 'negotiating' or
  // 'pending_hitl' to the DB — only 'detected', 'pending_execution', 'vetoed'
  // and 'resolved' — so the NEGOTIATE step was unreachable. The terminal
  // decision states still win, so the tracker never regresses to idle after a
  // decision has been made.
  const pipelineStage = useSpaceStore((s) => s.pipelineStage);
  const currentHitlRequest = useSpaceStore((s) => s.currentHitlRequest);
  const decisionOutcome = useSpaceStore((s) => s.decisionOutcome);
  const resolvedEvent = useSpaceStore((s) => s.resolvedEvent);

  if (decisionOutcome?.decision === 'veto') return 'collision';
  if (decisionOutcome?.decision === 'approve' || resolvedEvent) return 'resolved';
  if (currentHitlRequest) return 'awaiting';
  return pipelineStage;
}

export const StageTracker: React.FC = () => {
  const stage = useStage();
  const idx = STAGE_INDEX[stage];
  const negotiationBids = useSpaceStore((s) => s.negotiationBids);

  const outcomeLabel =
    stage === 'resolved' ? 'AVOIDED' : stage === 'collision' ? 'COLLISION' : 'OUTCOME';
  const minScore =
    negotiationBids && negotiationBids.length > 0
      ? Math.min(...negotiationBids.map((b) => b.bid_score))
      : null;

  return (
    <div className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 z-30 w-[min(92%,720px)]">
      <div className="bg-black/55 backdrop-blur-sm border border-white/10 rounded-lg px-5 py-2.5 font-mono shadow-lg">
        {/* Stepper */}
        <div className="flex items-center justify-between">
          {STEPS.map((label, i) => {
            const isLast = i === STEPS.length - 1;
            const done = idx > i;
            const current = idx === i;
            const lbl = isLast ? outcomeLabel : label;

            let textColor = 'text-gray-600';
            if (isLast && current)
              textColor = stage === 'collision' ? 'text-red-300' : 'text-green-300';
            else if (current) textColor = 'text-white';
            else if (done) textColor = 'text-gray-300';

            let dot = 'bg-gray-700';
            if (current)
              dot = isLast
                ? stage === 'collision'
                  ? 'bg-red-500'
                  : 'bg-green-500'
                : 'bg-cyan-400';
            else if (done) dot = 'bg-gray-400';

            // The active step reads as a filled pill with a pulsing ring so the
            // transition is legible from across a room, not an 8px dot swap.
            const pillRing = isLast
              ? stage === 'collision'
                ? 'bg-red-500/15 ring-1 ring-red-400/70'
                : 'bg-green-500/15 ring-1 ring-green-400/70'
              : 'bg-cyan-400/15 ring-1 ring-cyan-300/70';

            return (
              <React.Fragment key={label}>
                <div
                  className={`flex items-center gap-2 rounded-full px-2.5 py-1 transition-all duration-300 ${
                    current ? pillRing : ''
                  }`}
                >
                  <span className="relative flex h-2.5 w-2.5">
                    {current && (
                      <span
                        className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dot}`}
                      />
                    )}
                    <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dot}`} />
                  </span>
                  <span className={`text-[11px] font-bold tracking-widest ${textColor}`}>
                    {lbl}
                  </span>
                </div>
                {!isLast && (
                  <div
                    className={`flex-1 h-0.5 mx-2 rounded transition-colors duration-300 ${
                      done ? 'bg-cyan-500/60' : 'bg-gray-800'
                    }`}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Caption */}
        <div className="mt-1.5 text-center text-[12px] text-gray-300">{CAPTIONS[stage]}</div>

        {/* Competing operator bids during negotiation / decision */}
        {(stage === 'negotiating' || stage === 'awaiting') &&
          negotiationBids &&
          negotiationBids.length > 0 && (
            <div className="mt-2 border-t border-white/10 pt-2 flex flex-wrap justify-center gap-x-6 gap-y-1 text-[11px]">
              {negotiationBids.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-gray-400">{b.operator}</span>
                  <span className="text-blue-300">ΔV {b.delta_v_ms.toFixed(3)} m/s</span>
                  {b.bid_score === minScore && (
                    <span className="text-green-400 text-[9px] tracking-widest">WINNER</span>
                  )}
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
};
