import React, { useEffect, useRef } from 'react';
import { useSpaceStore } from '../../store/useSpaceStore';
import { Tooltip } from '../Tooltip';

// ---------------------------------------------------------------------------
// Badge colors by [TAG] prefix parsed from the message string
// ---------------------------------------------------------------------------
const BADGE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'TLE INGESTION': { bg: 'bg-gray-700/60',    text: 'text-gray-300',   border: 'border-gray-500/40' },
  'DETECTOR':      { bg: 'bg-red-900/60',      text: 'text-red-300',    border: 'border-red-500/40'  },
  'COORDINATOR':   { bg: 'bg-yellow-900/60',   text: 'text-yellow-300', border: 'border-yellow-500/40' },
  'OPERATOR':      { bg: 'bg-blue-900/60',     text: 'text-blue-300',   border: 'border-blue-500/40' },
  'HITL':          { bg: 'bg-orange-900/60',   text: 'text-orange-300', border: 'border-orange-500/40' },
  'EXECUTOR':      { bg: 'bg-green-900/60',    text: 'text-green-300',  border: 'border-green-500/40' },
  'SYSTEM':        { bg: 'bg-slate-700/60',    text: 'text-slate-300',  border: 'border-slate-500/40' },
};

// Dot accent colors for the left border strip
const BADGE_DOT: Record<string, string> = {
  'TLE INGESTION': 'border-l-gray-400',
  'DETECTOR':      'border-l-red-400',
  'COORDINATOR':   'border-l-yellow-400',
  'OPERATOR':      'border-l-blue-400',
  'HITL':          'border-l-orange-400',
  'EXECUTOR':      'border-l-green-400',
  'SYSTEM':        'border-l-slate-400',
};

const BADGE_TOOLTIPS: Record<string, string> = {
  'DETECTOR': "Orbital conjunction detection agent using SGP4 propagation and TCA optimization",
  'COORDINATOR': "Contract-Net Protocol negotiation coordinator — manages bid collection and winner selection",
  'OPERATOR': "Operator agent — computes minimum delta-V bid using Clohessy-Wiltshire equations",
  'EXECUTOR': "Maneuver execution agent — applies approved burn and updates orbital state",
  'HITL': "Human-In-The-Loop gate — final approval required before any satellite maneuver",
};

function parseBadge(message: string): string {
  // Extract first [TAG] from message, e.g. "[DETECTOR] ..." → "DETECTOR"
  // Also handle multi-word tags like "[TLE INGESTION]" and "[OPERATOR SpaceX]"
  const match = message.match(/^\[([^\]]+)\]/);
  if (!match) return 'SYSTEM';
  const full = match[1]; // e.g. "OPERATOR SpaceX"
  // Check for known prefixes
  for (const key of Object.keys(BADGE_COLORS)) {
    if (full === key || full.startsWith(key + ' ') || full.startsWith(key)) {
      return key;
    }
  }
  return 'SYSTEM';
}

function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return '--:--:--';
  }
}

// ---------------------------------------------------------------------------
// Each row in the mission control log
// ---------------------------------------------------------------------------
interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
}

// ---------------------------------------------------------------------------
// EventFeed — reads from store.eventFeed, expands messages[] arrays from payloads
// ---------------------------------------------------------------------------
export const EventFeed: React.FC = () => {
  const { eventFeed } = useSpaceStore();
  const endRef = useRef<HTMLDivElement>(null);

  // Expand each WS event into one log entry per message string.
  // Falls back to a generic entry if no messages array is present.
  const logEntries: LogEntry[] = React.useMemo(() => {
    const entries: LogEntry[] = [];

    [...eventFeed].reverse().forEach((ev) => {
      const messages: string[] = ev.payload?.messages ?? [];
      // Use timestamp + type as the stable base — these won't shift when new
      // events are prepended to the feed the way array indices do.
      const base = `${ev.timestamp}::${ev.type}`;

      if (messages.length > 0) {
        messages.forEach((msg, mIdx) => {
          entries.push({
            id: `${base}::${mIdx}`,
            timestamp: ev.timestamp,
            message: msg,
          });
        });
      } else {
        // Fallback: synthesise a message from the event type
        const fallback = ev.payload?.message ?? ev.type.replace(/_/g, ' ').toUpperCase();
        entries.push({
          id: `${base}::0`,
          timestamp: ev.timestamp,
          message: `[SYSTEM] ${fallback}`,
        });
      }
    });

    // Cap at 50 most recent
    return entries.slice(-50);
  }, [eventFeed]);

  // Auto-scroll to bottom on new entry
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logEntries.length]);

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar font-mono">
      {/* Header */}
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase">
          Mission Control Log
        </span>
        <span className="text-[10px] text-gray-600">{logEntries.length} events</span>
      </div>

      {logEntries.length === 0 ? (
        <div className="text-xs text-gray-600 italic text-center mt-6">
          Awaiting system events…
        </div>
      ) : (
        logEntries.map((entry) => {
          const badge = parseBadge(entry.message);
          const colors = BADGE_COLORS[badge] ?? BADGE_COLORS['SYSTEM'];
          const dotColor = BADGE_DOT[badge] ?? 'border-l-slate-400';
          const timeStr = formatTime(entry.timestamp);

          // Strip the [TAG] prefix from the display text so it's not repeated
          const displayText = entry.message.replace(/^\[[^\]]+\]\s*/, '');

          return (
            <div
              key={entry.id}
              className={`
                flex flex-col border-l-2 pl-2.5 pr-2 py-1.5 rounded-r
                bg-white/3 border-white/5
                ${dotColor}
                text-[11px] leading-snug
              `}
            >
              {/* Top row: time + badge */}
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-gray-600 text-[10px]">{timeStr}</span>
                {BADGE_TOOLTIPS[badge] ? (
                  <Tooltip text={BADGE_TOOLTIPS[badge]} position="bottom">
                    <span
                      className={`
                        px-1.5 py-0 rounded text-[9px] font-bold tracking-widest uppercase border
                        ${colors.bg} ${colors.text} ${colors.border}
                      `}
                    >
                      {badge}
                    </span>
                  </Tooltip>
                ) : (
                  <span
                    className={`
                      px-1.5 py-0 rounded text-[9px] font-bold tracking-widest uppercase border
                      ${colors.bg} ${colors.text} ${colors.border}
                    `}
                  >
                    {badge}
                  </span>
                )}
              </div>
              {/* Message text */}
              <span className="text-gray-200 leading-tight break-words">{displayText}</span>
            </div>
          );
        })
      )}

      <div ref={endRef} />
    </div>
  );
};
