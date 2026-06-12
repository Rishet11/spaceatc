import React, { useEffect, useRef } from 'react';
import { useSpaceStore } from './store';
import { Globe } from './components/Globe/Globe';
import { MetricsBar } from './components/MetricsBar/MetricsBar';
import { EventFeed } from './components/EventFeed/EventFeed';
import { HITLPanel } from './components/HITLPanel/HITLPanel';

function App() {
  const wsRef = useRef<WebSocket | null>(null);
  const { 
    updateSatellites, 
    addFeedEvent, 
    setHitlRequest,
    updateMetrics,
  } = useSpaceStore();

  useEffect(() => {
    // 1. Initial fetch for metrics
    fetch('http://127.0.0.1:8000/api/metrics')
      .then(res => res.json())
      .then(data => {
        updateMetrics({
          activeSatellitesCount: data.active_satellites,
          conjunctionsDetected: data.conjunctions_detected,
          conjunctionsResolved: data.conjunctions_resolved,
          maneuversExecuted: data.maneuvers_executed,
          totalDeltaV: data.total_delta_v,
          systemStatus: data.system_status
        });
      })
      .catch(console.error);

    // 2. Initial fetch for active conjunctions
    fetch('http://127.0.0.1:8000/api/conjunctions')
      .then(res => res.json())
      .then(data => {
        useSpaceStore.setState({ activeConjunctions: data });
      })
      .catch(console.error);

    // 3. Connect WebSocket
    const connectWs = () => {
      const ws = new WebSocket('ws://127.0.0.1:8000/ws');
      wsRef.current = ws;

      ws.onopen = () => console.log('WebSocket connected');
      ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting...');
        setTimeout(connectWs, 2000);
      };
      ws.onerror = (e) => console.error('WebSocket error', e);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          switch (msg.type) {
            case 'satellite_update':
              updateSatellites(msg.payload.satellites);
              break;
              
            case 'conjunction_detected':
              addFeedEvent(msg);
              // Refresh conjunctions and metrics
              fetch('http://127.0.0.1:8000/api/conjunctions')
                .then(res => res.json())
                .then(data => useSpaceStore.setState({ activeConjunctions: data }));
              fetch('http://127.0.0.1:8000/api/metrics')
                .then(res => res.json())
                .then(data => updateMetrics({
                  activeSatellitesCount: data.active_satellites,
                  conjunctionsDetected: data.conjunctions_detected,
                  conjunctionsResolved: data.conjunctions_resolved,
                  maneuversExecuted: data.maneuvers_executed,
                  totalDeltaV: data.total_delta_v
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
              // Refresh conjunctions and metrics
              fetch('http://127.0.0.1:8000/api/conjunctions')
                .then(res => res.json())
                .then(data => useSpaceStore.setState({ activeConjunctions: data }));
              fetch('http://127.0.0.1:8000/api/metrics')
                .then(res => res.json())
                .then(data => updateMetrics({
                  activeSatellitesCount: data.active_satellites,
                  conjunctionsDetected: data.conjunctions_detected,
                  conjunctionsResolved: data.conjunctions_resolved,
                  maneuversExecuted: data.maneuvers_executed,
                  totalDeltaV: data.total_delta_v
                }));
              break;

            case 'system_status':
              addFeedEvent(msg);
              updateMetrics({ systemStatus: msg.payload.status });
              break;
          }
        } catch (e) {
          console.error("Failed to parse WS message", e);
        }
      };
    };

    connectWs();

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black text-white">
      <Globe />
      <MetricsBar />
      <EventFeed />
      <HITLPanel />
    </div>
  );
}

export default App;
