import React, { useEffect } from 'react';
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
import { useWebSocket } from './hooks/useWebSocket';
import { useSpaceStore } from './store/useSpaceStore';
import { Rocket } from 'lucide-react';

function Dashboard() {
  const { updateSatellites, setActiveConjunctions, updateMetrics, activeTab } = useSpaceStore();
  const decisionOutcome = useSpaceStore(s => s.decisionOutcome);
  const isCollision = decisionOutcome?.decision === 'veto';
  useWebSocket();

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
    try {
      await fetch('/api/demo/inject', { method: 'POST' });
    } catch (e) {
      console.error("Failed to inject demo", e);
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-[#0a0f1e] text-white overflow-hidden relative">
      <MetricsBar />
      {activeTab === 'ground' ? (
        <div className="flex-1 flex flex-row overflow-hidden">
          <div className={`flex-1 relative ${isCollision ? 'animate-screen-shake' : ''}`}>
            <Globe />
            <StageTracker />
            <Legend />

            <button
              onClick={handleDemoInject}
              className="absolute top-4 right-4 z-50 flex items-center space-x-2 bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded shadow-lg border border-red-400 transition-colors focus:outline-none focus:ring-2 focus:ring-red-300/60"
            >
              <Rocket className="w-4 h-4" />
              <span>INJECT CONJUNCTION</span>
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
      <HITLPanel />
      <MathPanel />
      <OutcomeOverlay />
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
