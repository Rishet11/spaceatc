import { useEffect, useRef } from 'react';
import { useSpaceStore } from '../store/useSpaceStore';
import { WSMessage } from '../types';

export const useWebSocket = () => {
  const wsRef = useRef<WebSocket | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnedDisconnectRef = useRef<boolean>(false);
  const {
    updateSatellites,
    addFeedEvent,
    setHitlRequest,
    updateMetrics,
    setActiveConjunctions,
    setSimSpeed,
    setSimTime,
    setActiveMathTrace,
    clearTrail,
    setResolvedEvent,
    setNegotiationBids,
    resetForNewConjunction,
    addToast,
    setWsConnected,
    setPipelineStage,
    setManeuverResult,
  } = useSpaceStore();

  useEffect(() => {
    let backoff = 1000;

    // Single source of truth for the metrics mapping; this was duplicated
    // verbatim in four places.
    const refreshMetrics = () => {
      fetch('/api/metrics')
        .then(res => res.json())
        .then(data => updateMetrics({
          metrics: {
            active_satellites: data.active_satellites,
            conjunctions_detected: data.conjunctions_detected,
            resolved: data.resolved,
            maneuvers_executed: data.maneuvers_executed,
            total_delta_v_ms: data.total_delta_v_ms,
            system_status: data.system_status
          }
        }))
        .catch(() => { /* transient; the next event or metrics_update retries */ });
    };
    
    const connectWs = () => {
      // Always connect through the current origin. In dev, vite proxies /ws to
      // the backend (see vite.config.ts), so this works identically in both
      // modes -- and, unlike a hardcoded localhost:7860, it also works for
      // anyone opening the dashboard from another machine on the LAN, where
      // "localhost" would resolve to their own machine instead of the host.
      const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = `${wsProto}://${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        backoff = 1000; // Reset backoff on successful connect
        setWsConnected(true);
        if (warnedDisconnectRef.current) {
          addToast('Live connection restored.', 'success');
          warnedDisconnectRef.current = false;
        }
      };

      ws.onclose = () => {
        console.log(`WebSocket disconnected, reconnecting in ${backoff}ms...`);
        setWsConnected(false);
        // Warn once per disconnect episode so reconnect attempts don't spam toasts.
        if (!warnedDisconnectRef.current) {
          addToast('Live connection lost — reconnecting…', 'error');
          warnedDisconnectRef.current = true;
        }
        timeoutRef.current = setTimeout(connectWs, backoff);
        backoff = Math.min(backoff * 1.5, 5000); // Max 5s backoff
      };
      
      ws.onerror = (e) => console.error('WebSocket error', e);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WSMessage;

          switch (msg.type) {
            case 'satellite_update':
              updateSatellites(msg.payload.satellites);
              if (msg.payload.sim_time) setSimTime(msg.payload.sim_time);
              if (msg.payload.sim_speed !== undefined) setSimSpeed(msg.payload.sim_speed);
              break;

            case 'conjunction_detected':
              addFeedEvent(msg);
              // resetForNewConjunction sets the stage to 'detected' synchronously,
              // so the stepper advances the instant the message lands rather than
              // waiting for the /api/conjunctions round-trip below.
              resetForNewConjunction();
              fetch('/api/conjunctions')
                .then(res => res.json())
                .then(data => setActiveConjunctions(data))
                .catch(() => addToast('Could not refresh conjunction list.', 'error'));
              refreshMetrics();
              break;

            case 'negotiation_update': {
              addFeedEvent(msg);
              setPipelineStage('negotiating');
              // Surface competing operator bids for the stage tracker.
              const bids = (msg.payload as any)?.proposals;
              if (Array.isArray(bids) && bids.length > 0) setNegotiationBids(bids);
              break;
            }

            case 'hitl_request':
              addFeedEvent(msg);
              setPipelineStage('awaiting');
              setHitlRequest(msg);
              break;

            case 'maneuver_executed': {
              addFeedEvent(msg);
              setActiveMathTrace(null);
              setPipelineStage('resolved');
              clearTrail(msg.payload.satellite_name);

              // The backend already computes the real before/after figures.
              // Keep them so the UI can show measured values instead of the
              // frontend's optimistic pre-decision estimates.
              const p = msg.payload as any;
              setManeuverResult({
                event_id: p.event_id,
                satellite_name: p.satellite_name,
                operator: p.operator,
                delta_v_ms: p.delta_v_ms,
                pc_before: p.pc_before,
                pc_after: p.pc_after,
                miss_km_before: p.miss_km_before,
                miss_km_after: p.miss_km_after,
                burn_time: p.burn_time,
              });

              // We need both satellites for the resolution visual
              const currentConj = useSpaceStore.getState().activeConjunctions.find(c => c.event_id === msg.payload.event_id);
              if (currentConj) {
                setResolvedEvent({
                  satA: currentConj.sat_primary,
                  satB: currentConj.sat_secondary,
                  timestamp: Date.now()
                });
              }

              fetch('/api/conjunctions')
                .then(res => res.json())
                .then(data => setActiveConjunctions(data))
                .catch(() => { /* metrics refresh below still runs */ });
              refreshMetrics();
              break;
            }

            case 'metrics_update':
              // The backend broadcasts this every 5s; it was previously dropped
              // on the floor, so the metrics bar only refreshed opportunistically.
              updateMetrics({ metrics: msg.payload as any });
              break;

            case 'system_status':
              addFeedEvent(msg);
              refreshMetrics();
              break;
          }
        } catch (e) {
          console.error("Failed to parse WS message", e);
        }
      };
    };

    connectWs();

    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on unmount
        wsRef.current.close();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);
};
