import { create } from 'zustand';

// Use same schemas as backend
export interface SatellitePosition {
  norad_id: string;
  name: string;
  operator: string;
  fuel_units: number;
  maneuver_count: number;
  position?: number[];
  lat?: number;
  lon?: number;
  alt_km?: number;
  is_highlighted?: boolean;
}

export interface ConjunctionEvent {
  event_id: string;
  sat_primary: string;
  sat_secondary: string;
  tca: string;
  miss_distance_km: number;
  pc: number;
  relative_velocity_km_s: number;
  status: string; // 'detected' | 'negotiating' | 'pending_execution' | 'resolved' | 'vetoed'
}

export interface WSMessage {
  type: string;
  timestamp: string;
  payload: any;
}

export interface SpaceState {
  // System state
  systemStatus: string;
  activeSatellitesCount: number;
  conjunctionsDetected: number;
  conjunctionsResolved: number;
  maneuversExecuted: number;
  totalDeltaV: number;
  
  // Realtime data
  satellites: Record<string, SatellitePosition>;
  activeConjunctions: ConjunctionEvent[];
  eventFeed: any[];
  
  // HITL state
  currentHitlRequest: any | null;

  // Actions
  updateMetrics: (metrics: any) => void;
  updateSatellites: (sats: SatellitePosition[]) => void;
  addFeedEvent: (event: any) => void;
  setHitlRequest: (req: any | null) => void;
}

export const useSpaceStore = create<SpaceState>((set) => ({
  systemStatus: 'ACTIVE',
  activeSatellitesCount: 0,
  conjunctionsDetected: 0,
  conjunctionsResolved: 0,
  maneuversExecuted: 0,
  totalDeltaV: 0,
  
  satellites: {},
  activeConjunctions: [],
  eventFeed: [],
  currentHitlRequest: null,

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
    eventFeed: [event, ...state.eventFeed].slice(0, 100) // Keep last 100
  })),

  setHitlRequest: (req) => set({ currentHitlRequest: req })
}));
