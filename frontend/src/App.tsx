import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { Globe } from './components/Globe/Globe';
import { MetricsBar } from './components/MetricsBar/MetricsBar';
import { EventFeed } from './components/EventFeed/EventFeed';
import { HITLPanel } from './components/HITLPanel/HITLPanel';
import { MathPanel } from './components/MathPanel/MathPanel';
import { OutcomeOverlay } from './components/Outcome/OutcomeOverlay';
import { StageTracker } from './components/StageTracker/StageTracker';
import { Legend } from './components/Legend/Legend';
import { ReflexPanel } from './components/ReflexPanel/ReflexPanel';
import { ToastHost } from './components/Toast/Toast';
import { useWebSocket } from './hooks/useWebSocket';
import { useSpaceStore } from './store/useSpaceStore';
import { Rocket } from 'lucide-react';

function Dashboard() {
  const { updateSatellites, setActiveConjunctions, updateMetrics, activeTab } = useSpaceStore();
  const addToast = useSpaceStore(s => s.addToast);
  const decisionOutcome = useSpaceStore(s => s.decisionOutcome);
  const isCollision = decisionOutcome?.decision === 'veto';
  const [isInjecting, setIsInjecting] = useState(false);
  const wsConnected = useSpaceStore(s => s.wsConnected);
  const [everConnected, setEverConnected] = useState(false);
  useWebSocket();

  useEffect(() => {
    if (wsConnected) setEverConnected(true);
  }, [wsConnected]);

  useEffect(() => {
    fetch('/api/satellites')
      .then(res => res.json())
      .then(data => updateSatellites(data))
      .catch(console.error);

    fetch('/api/conjunctions')
      .then(res => res.json())
      .then(data => setActiveConjunctions(data))
      .catch(console.error);

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
      .catch(console.error);
  }, [updateSatellites, setActiveConjunctions, updateMetrics]);

  const handleDemoInject = async () => {
    if (isInjecting) return;
    setIsInjecting(true);
    try {
      const res = await fetch('/api/demo/inject', { method: 'POST' });
      let body: any = null;
      try { body = await res.json(); } catch { /* non-JSON response */ }

      if (!res.ok) {
        addToast(body?.detail || `Inject failed (HTTP ${res.status})`, 'error');
      } else if (body?.status === 'no_conjunction') {
        addToast(body?.detail || 'Pipeline ran but no conjunction was detected.', 'info');
      } else {
        addToast('Conjunction injected, running negotiation...', 'success');
      }
    } catch (e) {
      console.error("Failed to inject demo", e);
      addToast('Could not reach the server to inject a conjunction.', 'error');
    } finally {
      setIsInjecting(false);
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-[#0a0f1e] text-white overflow-hidden relative">
      {!wsConnected && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[100] px-3 py-1 rounded bg-black/70 border border-white/10 text-[11px] font-mono text-gray-300 pointer-events-none">
          {everConnected ? 'Backend offline, retrying...' : 'Connecting to mission control...'}
        </div>
      )}
      <MetricsBar />
      {activeTab === 'ground' && <StageTracker />}
      {activeTab === 'ground' ? (
        <div className="flex-1 flex flex-row overflow-hidden">
          <div className={`flex-1 relative ${isCollision ? 'animate-screen-shake' : ''}`}>
            <Globe />
            <Legend />

            <button
              onClick={handleDemoInject}
              disabled={isInjecting}
              className="absolute top-4 right-4 z-50 flex items-center space-x-2 bg-red-600 hover:bg-red-500 disabled:bg-red-900 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded shadow-lg border border-red-400 transition-colors focus:outline-none focus:ring-2 focus:ring-red-300/60"
            >
              <Rocket className={`w-4 h-4 ${isInjecting ? 'animate-pulse' : ''}`} />
              <span>{isInjecting ? 'INJECTING…' : 'INJECT CONJUNCTION'}</span>
            </button>
          </div>
          <div className="w-[clamp(18rem,22vw,28rem)] border-l border-white/10 flex flex-col bg-black/40">
            <EventFeed />
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <ReflexPanel />
        </div>
      )}
      {activeTab === 'ground' && (
        <>
          <HITLPanel />
          <MathPanel />
          <OutcomeOverlay />
        </>
      )}
      <ToastHost />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
