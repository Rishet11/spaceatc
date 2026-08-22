import { create } from 'zustand';
import {
  Satellite,
  ConjunctionEvent,
  WSMessageHitlRequest,
  Metrics,
  EventLogItem,
  DecisionOutcome,
  ManeuverBid,
  ManeuverResult,
  ManeuverSummary,
  PipelineStage
} from '../types';

export type ToastLevel = 'info' | 'error' | 'success';
export interface ToastItem {
  id: string;
  message: string;
  level: ToastLevel;
}

export interface SpaceState {
  satellites: Record<string, Satellite>;
  activeConjunctions: ConjunctionEvent[];
  currentHitlRequest: WSMessageHitlRequest | null;
  activeMathTrace: any[] | null;
  resolvedEvent: { satA: string; satB: string; timestamp: number } | null;
  decisionOutcome: DecisionOutcome | null;
  negotiationBids: ManeuverBid[] | null;
  /**
   * Explicit pipeline stage, driven synchronously from the WebSocket stream.
   * Previously the stage was derived from ConjunctionEvent.status, but the
   * backend only ever writes 'detected' | 'pending_execution' | 'vetoed' |
   * 'resolved' — never 'negotiating' — so the NEGOTIATE step could never light
   * up. Driving it from the message stream makes every stage reachable.
   */
  pipelineStage: PipelineStage;
  /** Real before/after numbers from the backend's maneuver_executed event. */
  maneuverResult: ManeuverResult | null;
  /** Judge-readable approved-maneuver summary (replaces the raw trace dump). */
  maneuverSummary: ManeuverSummary | null;
  metrics: Metrics;
  eventFeed: EventLogItem[];

  systemStatus: string;
  activeSatellitesCount: number;
  conjunctionsDetected: number;
  conjunctionsResolved: number;
  maneuversExecuted: number;
  totalDeltaV: number;

  simSpeed: number;
  simTime: string;
  setSimSpeed: (speed: number) => void;
  setSimTime: (time: string) => void;

  wsConnected: boolean;
  setWsConnected: (connected: boolean) => void;

  updateSatellites: (sats: Satellite[]) => void;
  updateMetrics: (m: Partial<SpaceState>) => void;
  addFeedEvent: (event: EventLogItem) => void;
  setHitlRequest: (req: WSMessageHitlRequest | null) => void;
  setActiveMathTrace: (trace: any[] | null) => void;
  setActiveConjunctions: (conjunctions: ConjunctionEvent[]) => void;
  destroyedSatellites: string[];
  addDestroyedSatellites: (names: string[]) => void;
  clearTrail: (name: string) => void;
  trailClearedCount: number; // simple toggle to force reactivity
  setResolvedEvent: (event: { satA: string; satB: string; timestamp: number } | null) => void;
  setDecisionOutcome: (outcome: DecisionOutcome | null) => void;
  setNegotiationBids: (bids: ManeuverBid[] | null) => void;
  setPipelineStage: (stage: PipelineStage) => void;
  setManeuverResult: (result: ManeuverResult | null) => void;
  setManeuverSummary: (summary: ManeuverSummary | null) => void;
  clearConjunctionVisuals: () => void;
  resetForNewConjunction: () => void;
  activeTab: 'ground' | 'reflex';
  setActiveTab: (tab: 'ground' | 'reflex') => void;

  toasts: ToastItem[];
  addToast: (message: string, level?: ToastLevel) => void;
  dismissToast: (id: string) => void;
}

// Monotonic counter for feed entries; see EventLogItem.seq.
let feedSeq = 0;

export const useSpaceStore = create<SpaceState>((set) => ({
  satellites: {},
  activeConjunctions: [],
  currentHitlRequest: null,
  activeMathTrace: null,
  resolvedEvent: null,
  decisionOutcome: null,
  negotiationBids: null,
  pipelineStage: 'idle',
  maneuverResult: null,
  maneuverSummary: null,
  eventFeed: [],
  destroyedSatellites: [],
  trailClearedCount: 0,
  
  metrics: {
    active_satellites: 0,
    conjunctions_detected: 0,
    resolved: 0,
    maneuvers_executed: 0,
    total_delta_v_ms: 0,
    system_status: 'ACTIVE'
  },

  // Legacy flat properties used by existing components (will be retained for compatibility)
  systemStatus: 'ACTIVE',
  activeSatellitesCount: 0,
  conjunctionsDetected: 0,
  conjunctionsResolved: 0,
  maneuversExecuted: 0,
  totalDeltaV: 0,

  // Matches the backend default (backend/main.py SIM_SPEED = 1.0). This was
  // 60, so the speed selector briefly showed 60x before the first WS frame.
  simSpeed: 1,
  simTime: '',

  wsConnected: false,
  setWsConnected: (connected) => set({ wsConnected: connected }),

  updateMetrics: (m) => set((state) => ({
    ...state,
    ...m
  })),

  updateSatellites: (sats) => set((state) => {
    const newMap = { ...state.satellites };
    sats.forEach(s => {
      newMap[s.norad_id] = { ...newMap[s.norad_id], ...s };
    });
    return { satellites: newMap };
  }),

  addFeedEvent: (event) => set((state) => ({
    eventFeed: [{ ...event, seq: feedSeq++ }, ...state.eventFeed].slice(0, 100)
  })),

  setHitlRequest: (req) => set({ currentHitlRequest: req }),
  setActiveMathTrace: (trace) => set({ activeMathTrace: trace }),
  setActiveConjunctions: (conjunctions) => set({ activeConjunctions: conjunctions }),
  addDestroyedSatellites: (names) => set((state) => ({ 
    destroyedSatellites: [...state.destroyedSatellites, ...names] 
  })),
  setSimSpeed: (speed) => set({ simSpeed: speed }),
  setSimTime: (time) => set({ simTime: time }),
  clearTrail: (name) => set((state) => {
    // Because trail state is local to SatelliteLayer, we just increment a counter
    // and broadcast the name that needs clearing. The component will listen.
    // Or we could store trail state here, but that's expensive.
    // Instead, we'll dispatch an event on the window object.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('clear-trail', { detail: { name } }));
    }
    return { trailClearedCount: state.trailClearedCount + 1 };
  }),
  setResolvedEvent: (event) => set({ resolvedEvent: event }),
  setDecisionOutcome: (outcome) => set({ decisionOutcome: outcome }),
  setNegotiationBids: (bids) => set({ negotiationBids: bids }),
  setPipelineStage: (stage) => set({ pipelineStage: stage }),
  setManeuverResult: (result) => set({ maneuverResult: result }),
  setManeuverSummary: (summary) => set({ maneuverSummary: summary }),
  clearConjunctionVisuals: () => set({ resolvedEvent: null, negotiationBids: null }),
  resetForNewConjunction: () => set({
    destroyedSatellites: [],
    resolvedEvent: null,
    decisionOutcome: null,
    negotiationBids: null,
    maneuverResult: null,
    maneuverSummary: null,
    pipelineStage: 'detected',
  }),
  activeTab: 'ground',
  setActiveTab: (tab) => set({ activeTab: tab }),

  toasts: [],
  addToast: (message, level = 'info') => set((state) => ({
    toasts: [
      ...state.toasts,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, message, level },
    ],
  })),
  dismissToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id),
  })),
}));
