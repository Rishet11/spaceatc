import { create } from 'zustand';
import {
  Satellite,
  ConjunctionEvent,
  WSMessageHitlRequest,
  Metrics,
  EventLogItem,
  DecisionOutcome,
  ManeuverBid
} from '../types';

export interface SpaceState {
  satellites: Record<string, Satellite>;
  activeConjunctions: ConjunctionEvent[];
  currentHitlRequest: WSMessageHitlRequest | null;
  activeMathTrace: any[] | null;
  resolvedEvent: { satA: string; satB: string; timestamp: number } | null;
  decisionOutcome: DecisionOutcome | null;
  negotiationBids: ManeuverBid[] | null;
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
  /** Clear lingering resolved/green visuals and stale bid data once an event is over. */
  clearConjunctionVisuals: () => void;
  /** Full reset before a new conjunction so destroyed sats reappear and stale visuals drop. */
  resetForNewConjunction: () => void;
  activeTab: 'ground' | 'reflex';
  setActiveTab: (tab: 'ground' | 'reflex') => void;
}

export const useSpaceStore = create<SpaceState>((set) => ({
  satellites: {},
  activeConjunctions: [],
  currentHitlRequest: null,
  activeMathTrace: null,
  resolvedEvent: null,
  decisionOutcome: null,
  negotiationBids: null,
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

  simSpeed: 60,
  simTime: '',

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
    eventFeed: [event, ...state.eventFeed].slice(0, 100)
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
  clearConjunctionVisuals: () => set({ resolvedEvent: null, negotiationBids: null }),
  resetForNewConjunction: () => set({
    destroyedSatellites: [],
    resolvedEvent: null,
    decisionOutcome: null,
    negotiationBids: null,
  }),
  activeTab: 'ground',
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
