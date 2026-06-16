import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Rocket, ArrowRight, Activity, ArrowDown } from 'lucide-react';

const CountUp = ({ end, duration, prefix = '', suffix = '' }: { end: number, duration: number, prefix?: string, suffix?: string }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let start = 0;
    const increment = end / (duration / 16);
    const timer = setInterval(() => {
      start += increment;
      if (start >= end) {
        setCount(end);
        clearInterval(timer);
      } else {
        setCount(Math.floor(start));
      }
    }, 16);
    return () => clearInterval(timer);
  }, [end, duration]);

  return <span>{prefix}{count.toLocaleString()}{suffix}</span>;
};

export const Landing: React.FC = () => {
  const navigate = useNavigate();
  const [showStats, setShowStats] = useState(false);
  const flowRef = useRef<HTMLDivElement>(null);
  const [activeStep, setActiveStep] = useState(-1);

  // Stats fade in after 1s
  useEffect(() => {
    const t = setTimeout(() => setShowStats(true), 1000);
    return () => clearTimeout(t);
  }, []);

  // IntersectionObserver for flow steps
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Animate steps 0, 1, 2, 3 left to right
          const steps = [0, 1, 2, 3];
          steps.forEach(i => {
            setTimeout(() => setActiveStep(i), i * 600);
          });
        }
      });
    }, { threshold: 0.5 });
    if (flowRef.current) observer.observe(flowRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="bg-[#0a0f1e] text-white min-h-screen font-sans selection:bg-red-500/30 overflow-x-hidden">
      <style>{`
        @keyframes twinkle {
          0% { opacity: 0.2; transform: scale(0.8); }
          100% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes bounceDown {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(10px); }
        }
      `}</style>
      
      {/* SECTION 1: HERO */}
      <section className="relative w-full h-screen flex flex-col items-center justify-center overflow-hidden">
        {/* Starfield Background */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          {Array.from({ length: 200 }).map((_, i) => (
            <div
              key={i}
              className="absolute bg-white rounded-full"
              style={{
                top: `${Math.random() * 100}%`,
                left: `${Math.random() * 100}%`,
                width: `${Math.random() * 2 + 1}px`,
                height: `${Math.random() * 2 + 1}px`,
                animation: `twinkle 3s infinite alternate`,
                animationDelay: `${Math.random() * 3}s`
              }}
            />
          ))}
        </div>

        <div className="z-10 text-center">
          <h1 className="text-7xl font-bold tracking-tight text-white drop-shadow-lg">
            SpaceATC
          </h1>
          <p className="text-xl text-gray-400 mt-4 max-w-2xl mx-auto">
            The coordination layer space was missing.
          </p>
        </div>

        {/* Hero Stats */}
        <div className={`absolute bottom-24 flex flex-col md:flex-row gap-8 md:gap-16 transition-opacity duration-1000 z-10 ${showStats ? 'opacity-100' : 'opacity-0'}`}>
          <div className="text-center">
            <div className="text-4xl font-bold text-white mb-2">
              <CountUp end={43000} duration={2000} suffix="+" />
            </div>
            <div className="text-sm text-gray-500 uppercase tracking-widest font-mono">Objects in LEO</div>
          </div>
          <div className="w-px bg-white/10 hidden md:block" />
          <div className="text-center">
            <div className="text-4xl font-bold text-white mb-2">
              <CountUp end={144000} duration={2500} />
            </div>
            <div className="text-sm text-gray-500 uppercase tracking-widest font-mono">Maneuvers/Year</div>
          </div>
          <div className="w-px bg-white/10 hidden md:block" />
          <div className="text-center">
            <div className="text-4xl font-bold text-[#ef4444] mb-2 drop-shadow-[0_0_15px_rgba(239,68,68,0.3)]">
              <CountUp end={11.1} duration={3000} prefix="$" suffix="B" />
            </div>
            <div className="text-sm text-[#ef4444]/70 uppercase tracking-widest font-mono">At risk annually</div>
          </div>
        </div>

        <div className="absolute bottom-8 z-10 text-gray-500" style={{ animation: 'bounceDown 2s infinite' }}>
          <ArrowDown className="w-6 h-6" />
        </div>
      </section>

      {/* SECTION 2: THE GAP */}
      <section className="w-full py-32 px-6 bg-gradient-to-b from-[#0a0f1e] to-black border-y border-white/5 relative z-10">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-20 items-center">
          {/* Timeline diagram */}
          <div className="bg-white/5 p-10 rounded-3xl border border-white/10 font-mono text-sm relative">
            <div className="flex flex-col items-center space-y-6">
              <div className="bg-gray-800 border border-gray-600 px-6 py-3 rounded-lg text-white font-bold tracking-widest">
                SpaceX Stargaze — Jan 2026
              </div>
              <ArrowDown className="text-gray-500 w-6 h-6" />
              <div className="text-[#4fc3f7] text-center max-w-[250px]">
                "CDM sent to both operators simultaneously"
              </div>
              <ArrowDown className="text-gray-500 w-6 h-6" />
              <div className="flex w-full justify-between px-10">
                <div className="bg-red-900/50 border border-red-500/50 px-6 py-3 rounded-lg text-red-300 text-center">Operator A ?</div>
                <div className="bg-red-900/50 border border-red-500/50 px-6 py-3 rounded-lg text-red-300 text-center">Operator B ?</div>
              </div>
              <div className="mt-8 text-center text-lg text-red-400 font-bold font-sans tracking-wide">
                "Who moves? Nobody decides."
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-3xl font-bold mb-8 leading-snug">
              SpaceX Stargaze tells you two satellites are going to collide.
            </h2>
            <div className="text-xl text-gray-400 mb-8 space-y-4">
              <p>It does NOT tell you:</p>
              <ul className="list-disc pl-6 space-y-2 text-white">
                <li>Who maneuvers</li>
                <li>By how much</li>
                <li>By when</li>
              </ul>
            </div>
            <blockquote className="border-l-4 border-[#ef4444] pl-6 italic text-gray-500 leading-relaxed text-lg bg-red-950/10 py-4 pr-4 rounded-r-xl">
              "If the reaction required human approval, such an event might not have been successfully mitigated."
              <footer className="mt-4 text-sm text-gray-600 font-mono normal-case tracking-wider not-italic">
                — SpaceX Stargaze announcement, Jan 29, 2026
              </footer>
            </blockquote>
          </div>
        </div>
      </section>

      {/* SECTION 3: THE SOLUTION */}
      <section className="w-full py-32 px-6 bg-black relative z-10" ref={flowRef}>
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-24">The Protocol</h2>
          <div className="flex flex-col md:flex-row items-center justify-between relative gap-8 md:gap-0">
            {/* Step 1 */}
            <div className={`flex flex-col items-center text-center w-64 transition-all duration-700 ${activeStep >= 0 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
              <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-6 shadow-lg transition-colors duration-500 ${activeStep >= 0 ? 'bg-gray-800 shadow-gray-800/50' : 'bg-gray-900'}`}>
                <Activity className={`w-10 h-10 ${activeStep >= 0 ? 'text-gray-300' : 'text-gray-600'}`} />
              </div>
              <h3 className="font-mono font-bold tracking-widest text-gray-300 mb-2">DETECT</h3>
              <p className="text-sm text-gray-500">Real TLE data<br/>from CelesTrak</p>
            </div>
            
            <ArrowRight className={`hidden md:block w-8 h-8 transition-colors duration-500 ${activeStep >= 1 ? 'text-[#4fc3f7]' : 'text-gray-800'}`} />

            {/* Step 2 */}
            <div className={`flex flex-col items-center text-center w-64 transition-all duration-700 ${activeStep >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
              <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-6 shadow-lg transition-colors duration-500 ${activeStep >= 1 ? 'bg-[#4fc3f7]/20 shadow-[#4fc3f7]/30' : 'bg-gray-900'}`}>
                <Activity className={`w-10 h-10 ${activeStep >= 1 ? 'text-[#4fc3f7]' : 'text-gray-600'}`} />
              </div>
              <h3 className="font-mono font-bold tracking-widest text-[#4fc3f7] mb-2">NEGOTIATE</h3>
              <p className="text-sm text-gray-500">Two AI agents<br/>bid on who maneuvers</p>
            </div>

            <ArrowRight className={`hidden md:block w-8 h-8 transition-colors duration-500 ${activeStep >= 2 ? 'text-blue-500' : 'text-gray-800'}`} />

            {/* Step 3 */}
            <div className={`flex flex-col items-center text-center w-64 transition-all duration-700 ${activeStep >= 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
              <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-6 shadow-lg transition-colors duration-500 ${activeStep >= 2 ? 'bg-blue-900/40 shadow-blue-500/30' : 'bg-gray-900'}`}>
                <Rocket className={`w-10 h-10 ${activeStep >= 2 ? 'text-blue-400' : 'text-gray-600'}`} />
              </div>
              <h3 className="font-mono font-bold tracking-widest text-blue-400 mb-2">PROPOSE</h3>
              <p className="text-sm text-gray-500">Lowest-cost<br/>bid selected automatically</p>
            </div>

            <ArrowRight className={`hidden md:block w-8 h-8 transition-colors duration-500 ${activeStep >= 3 ? 'text-[#ef4444]' : 'text-gray-800'}`} />

            {/* Step 4 */}
            <div className={`flex flex-col items-center text-center w-64 transition-all duration-700 ${activeStep >= 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
              <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-6 shadow-lg transition-colors duration-500 ${activeStep >= 3 ? 'bg-[#ef4444]/20 shadow-[#ef4444]/40 border border-[#ef4444]/30' : 'bg-gray-900'}`}>
                <ShieldAlert className={`w-10 h-10 ${activeStep >= 3 ? 'text-[#ef4444]' : 'text-gray-600'}`} />
              </div>
              <h3 className="font-mono font-bold tracking-widest text-[#ef4444] mb-2">APPROVE</h3>
              <p className="text-sm text-gray-500">Human reviews<br/>and confirms</p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4: NUMBERS */}
      <section className="w-full py-24 bg-gradient-to-t from-[#0a0f1e] to-black border-y border-white/5 relative z-10">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row justify-around items-center text-center gap-12 md:gap-0">
          <div>
            <div className="text-5xl font-bold text-white mb-4">0.087 <span className="text-3xl text-gray-500">m/s</span></div>
            <div className="text-sm text-gray-400 uppercase tracking-widest font-mono">Fuel used to<br/>resolve a collision</div>
          </div>
          <div className="w-px h-16 bg-white/10 hidden md:block" />
          <div>
            <div className="text-5xl font-bold text-[#22c55e] mb-4">1.2×10⁻³ <span className="text-2xl text-gray-500 mx-2">→</span> 3.1×10⁻⁷</div>
            <div className="text-sm text-gray-400 uppercase tracking-widest font-mono">Collision probability<br/>before and after</div>
          </div>
          <div className="w-px h-16 bg-white/10 hidden md:block" />
          <div>
            <div className="text-5xl font-bold text-white mb-4">&lt; 60 <span className="text-3xl text-gray-500">seconds</span></div>
            <div className="text-sm text-gray-400 uppercase tracking-widest font-mono">From detection<br/>to resolution</div>
          </div>
        </div>
      </section>

      {/* SECTION 5: CTA */}
      <section className="w-full h-screen flex flex-col items-center justify-center relative bg-[#0a0f1e]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-red-900/10 via-[#0a0f1e] to-[#0a0f1e] pointer-events-none" />
        
        <h2 className="text-5xl md:text-6xl font-bold mb-16 text-center z-10 drop-shadow-xl tracking-tight">
          See it resolve a conjunction live.
        </h2>
        
        <button
          onClick={() => navigate('/dashboard')}
          className="z-10 bg-[#ef4444] hover:bg-red-500 text-white font-bold text-xl px-12 py-5 rounded-full shadow-lg transition-colors duration-200 flex items-center gap-3 group cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-300/60"
        >
          Launch SpaceATC
          <ArrowRight className="w-6 h-6 group-hover:translate-x-2 transition-transform" />
        </button>
        
        <p className="z-10 mt-8 text-gray-500 font-mono text-sm tracking-wider">
          Using real Starlink TLE data
        </p>
      </section>
    </div>
  );
};
