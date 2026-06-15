export interface ECIPosition {
  x: number;
  y: number;
  z: number;
}

export interface Satellite {
  norad_id: string;
  name: string;
  operator: string;
  position?: number[]; // [x, y, z] from backend
  lat?: number;
  lon?: number;
  alt_km?: number;
  is_highlighted?: boolean;
}

export interface ConjunctionEvent {
  event_id: string;
  sat_primary: string;
  sat_secondary: string;
  operator_primary: string;
  operator_secondary: string;
  tca: string;
  tca_iso: string;
  miss_distance_km: number;
  pc: number;
  relative_velocity_km_s: number;
  status: 'detected' | 'negotiating' | 'pending_hitl' | 'resolved' | 'vetoed';
  created_at: string;
  resolved_at?: string;
}

export interface ManeuverProposal {
  proposal_id: string;
  event_id: string;
  operator: string;
  satellite_name: string;
  delta_v_ms: number;
  burn_direction: 'prograde' | 'retrograde' | 'radial';
  burn_time: string;
  post_maneuver_pc: number;
  post_maneuver_miss_km: number;
  fuel_cost_units: number;
  bid_score: number;
  computation_trace?: string[];
}

export interface Metrics {
  active_satellites: number;
  conjunctions_detected: number;
  resolved: number;
  maneuvers_executed: number;
  total_delta_v_ms: number;
  system_status: 'ACTIVE' | 'IDLE' | 'ERROR';
}

export interface WSMessageBase {
  timestamp: string;
  type: string;
  payload: any;
}

export interface WSMessageSatelliteUpdate extends WSMessageBase {
  type: 'satellite_update';
  payload: {
    satellites: Satellite[];
    sim_time?: string;
    sim_speed?: number;
  };
}

export interface WSMessageConjunctionDetected extends WSMessageBase {
  type: 'conjunction_detected';
  payload: ConjunctionEvent & { message?: string };
}

export interface WSMessageNegotiationUpdate extends WSMessageBase {
  type: 'negotiation_update';
  payload: {
    event_id: string;
    bids: ManeuverProposal[];
    message?: string;
  };
}

export interface HITLRequest {
  event_id: string;
  proposal: ManeuverProposal;
  message?: string;
}

export interface WSMessageHitlRequest extends WSMessageBase {
  type: 'hitl_request';
  payload: HITLRequest;
}

export interface WSMessageManeuverExecuted extends WSMessageBase {
  type: 'maneuver_executed';
  payload: {
    event_id: string;
    proposal_id: string;
    satellite_name: string;
    operator: string;
    message?: string;
  };
}

export interface WSMessageSystemStatus extends WSMessageBase {
  type: 'system_status';
  payload: {
    status: 'ACTIVE' | 'IDLE' | 'ERROR';
    message?: string;
  };
}

export type WSMessage =
  | WSMessageSatelliteUpdate
  | WSMessageConjunctionDetected
  | WSMessageNegotiationUpdate
  | WSMessageHitlRequest
  | WSMessageManeuverExecuted
  | WSMessageSystemStatus;

export interface EventLogItem {
  timestamp: string;
  type: string;
  payload: any;
}

export interface DecisionOutcome {
  decision: 'approve' | 'veto';
  eventId: string;
  satA: string;
  satB: string;
  satelliteName: string;
  operator: string;
  deltaV: number;
  burnDirection: 'prograde' | 'retrograde' | 'radial';
  pcBefore: number;
  pcAfter: number;
  timestamp: number;
}

export type PipelineStage =
  | 'idle'
  | 'detected'
  | 'negotiating'
  | 'awaiting'
  | 'resolved'
  | 'collision';

export interface ManeuverBid {
  operator: string;
  delta_v_ms: number;
  bid_score: number;
}
