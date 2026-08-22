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
  // NOTE: verified against the live API — GET /api/conjunctions returns
  // sat_primary, sat_secondary, operator-less rows plus session_id. The
  // operator_* and tca_iso fields are declared by ConjunctionEventResponse in
  // backend/api/schemas.py but the route does not serialize through it, so
  // they are absent at runtime. Marked optional so the compiler forces a
  // null-check instead of letting `undefined` reach the DOM.
  operator_primary?: string;
  operator_secondary?: string;
  session_id?: string;
  tca: string;
  tca_iso?: string;
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
  rationale?: string;
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

export interface WSMessageMetricsUpdate extends WSMessageBase {
  type: 'metrics_update';
  payload: Metrics;
}

export type WSMessage =
  | WSMessageSatelliteUpdate
  | WSMessageMetricsUpdate
  | WSMessageConjunctionDetected
  | WSMessageNegotiationUpdate
  | WSMessageHitlRequest
  | WSMessageManeuverExecuted
  | WSMessageSystemStatus;

export interface EventLogItem {
  timestamp: string;
  type: string;
  payload: any;
  /**
   * Monotonic ingestion sequence, assigned by the store. The feed previously
   * keyed rows on `timestamp::type`, but the backend emits several
   * negotiation_update events inside the same millisecond, so those keys
   * collided and React dropped rows.
   */
  seq?: number;
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

/**
 * Real before/after numbers broadcast on `maneuver_executed`.
 * Source: backend/agents/nodes/maneuver_executor.py — these are computed by the
 * backend, never synthesized here. Used to render the resolution summary.
 */
export interface ManeuverResult {
  event_id: string;
  satellite_name: string;
  operator: string;
  delta_v_ms: number;
  pc_before: number;
  pc_after: number;
  miss_km_before: number;
  miss_km_after: number;
  burn_time: string;
}

/**
 * Judge-readable summary of an approved maneuver.
 *
 * Every field here is a real value taken from the winning proposal and the
 * detected conjunction — nothing is synthesized in the frontend. `trace` keeps
 * the full derivation available behind a disclosure so the "we really computed
 * this" evidence is not lost, without dumping 25 binary-search rows on screen.
 */
export interface ManeuverSummary {
  eventId: string;
  satelliteName: string;
  operator: string;
  deltaV: number;
  burnDirection: string;
  burnTime: string;
  missBeforeKm: number | null;
  missAfterKm: number;
  pcBefore: number | null;
  pcAfter: number;
  fuelCostUnits: number | null;
  trace: any[];
}
