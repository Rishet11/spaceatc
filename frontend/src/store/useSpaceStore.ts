import { create } from 'zustand';
import {
  Satellite,
  ConjunctionEvent,
  WSMessageHitlRequest,
  Metrics,
  EventLogItem
} from '../types';

export interface SpaceState {
  satellites: Record<string, Satellite>;
  activeConjunctions: ConjunctionEvent[];
  currentHitlRequest: WSMessageHitlRequest | null;
  metrics: Metrics;
  eventFeed: EventLogItem[];

  systemStatus: string;
  activeSatellitesCount: number;
  conjunctionsDetected: number;
  conjunctionsResolved: number;
  maneuversExecuted: number;
  totalDeltaV: number;

  updateSatellites: (sats: Satellite[]) => void;
  updateMetrics: (m: Partial<SpaceState>) => void;
  addFeedEvent: (event: EventLogItem) => void;
  setHitlRequest: (req: WSMessageHitlRequest | null) => void;
  setActiveConjunctions: (conjunctions: ConjunctionEvent[]) => void;
}

export const useSpaceStore = create<SpaceState>((set) => ({
  satellites: {},
  activeConjunctions: [],
  currentHitlRequest: null,
  eventFeed: [],
  
  metrics: {
    active_satellites: 0,
    conjunctions_detected: 0,
    resolved: 0,
    maneuvers_executed: 0,
    total_delta_v: 0,
    system_status: 'ACTIVE'
  },

  // Legacy flat properties used by existing components (will be retained for compatibility)
  systemStatus: 'ACTIVE',
  activeSatellitesCount: 0,
  conjunctionsDetected: 0,
  conjunctionsResolved: 0,
  maneuversExecuted: 0,
  totalDeltaV: 0,

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
  setActiveConjunctions: (conjunctions) => set({ activeConjunctions: conjunctions })
}));
