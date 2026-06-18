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
  } = useSpaceStore();

  useEffect(() => {
    let backoff = 1000;
    
    const connectWs = () => {
      const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = import.meta.env.DEV
        ? 'ws://localhost:7860/ws'
        : `${wsProto}://${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        backoff = 1000; // Reset backoff on successful connect
        if (warnedDisconnectRef.current) {
          addToast('Live connection restored.', 'success');
          warnedDisconnectRef.current = false;
        }
      };

      ws.onclose = () => {
        console.log(`WebSocket disconnected, reconnecting in ${backoff}ms...`);
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
              resetForNewConjunction();
              fetch('/api/conjunctions')
                .then(res => res.json())
                .then(data => setActiveConjunctions(data));
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
                }));
              break;
              
            case 'negotiation_update': {
              addFeedEvent(msg);
              // Surface competing operator bids for the stage tracker.
              const bids = (msg.payload as any)?.proposals;
              if (Array.isArray(bids) && bids.length > 0) setNegotiationBids(bids);
              break;
            }
              
            case 'hitl_request':
              addFeedEvent(msg);
              setHitlRequest(msg);
              break;
              
            case 'maneuver_executed':
              addFeedEvent(msg);
              setActiveMathTrace(null);
              clearTrail(msg.payload.satellite_name);
              
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
                .then(data => setActiveConjunctions(data));
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
                }));
              break;

            case 'system_status':
              addFeedEvent(msg);
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
                }));
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
