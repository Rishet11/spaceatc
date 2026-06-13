import { useEffect, useRef } from 'react';
import { useSpaceStore } from '../store/useSpaceStore';
import { WSMessage } from '../types';

export const useWebSocket = () => {
  const wsRef = useRef<WebSocket | null>(null);
  const { 
    updateSatellites, 
    addFeedEvent, 
    setHitlRequest,
    updateMetrics,
    setActiveConjunctions
  } = useSpaceStore();

  useEffect(() => {
    let backoff = 1000;
    
    const connectWs = () => {
      const ws = new WebSocket('ws://localhost:8000/ws');
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        backoff = 1000; // Reset backoff on successful connect
      };
      
      ws.onclose = () => {
        console.log(`WebSocket disconnected, reconnecting in ${backoff}ms...`);
        setTimeout(connectWs, backoff);
        backoff = Math.min(backoff * 1.5, 5000); // Max 5s backoff
      };
      
      ws.onerror = (e) => console.error('WebSocket error', e);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WSMessage;
          if (msg.type !== 'satellite_update') console.log(`[WS MESSAGE] ${msg.type}`, msg.payload);
          
          switch (msg.type) {
            case 'satellite_update':
              updateSatellites(msg.payload.satellites);
              break;
              
            case 'conjunction_detected':
              addFeedEvent(msg);
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
                    total_delta_v: data.total_delta_v,
                    system_status: data.system_status
                  }
                }));
              break;
              
            case 'negotiation_update':
              addFeedEvent(msg);
              break;
              
            case 'hitl_request':
              addFeedEvent(msg);
              setHitlRequest(msg);
              break;
              
            case 'maneuver_executed':
              addFeedEvent(msg);
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
                    total_delta_v: data.total_delta_v,
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
                    total_delta_v: data.total_delta_v,
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
    };
  }, []);
};
