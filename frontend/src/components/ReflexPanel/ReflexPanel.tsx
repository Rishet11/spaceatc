import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  SkipBack,
  Cpu,
  Terminal,
  Activity,
  ShieldAlert,
  Compass,
  ArrowRight,
  Upload,
  Video
} from 'lucide-react';

interface FrameData {
  image: string;
  box: number[] | null;
  keypoints: number[][] | null;
  pose: {
    translation: number[];
    quaternion: number[];
    distance: number;
  };
  status: string;
  threat_level: string;
  decision_log: string;
  dodge_command: any | null;
}

export const ReflexPanel: React.FC = () => {
  const [totalFrames, setTotalFrames] = useState<number>(100);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [frameData, setFrameData] = useState<FrameData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [logMessages, setLogMessages] = useState<string[]>([]);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(300); // ms per frame
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // 1. Fetch total frame count on mount
  useEffect(() => {
    fetch('/api/reflex/total_frames')
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch total frames");
        return res.json();
      })
      .then((data) => setTotalFrames(data.total_frames))
      .catch((err) => {
        console.error(err);
        setTotalFrames(100); // fallback
      });
  }, []);

  // 2. Fetch single frame data
  const fetchFrame = async (idx: number) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/reflex/frame/${idx}`);
      if (!res.ok) throw new Error(`Failed to fetch frame ${idx}`);
      const data: FrameData = await res.json();
      setFrameData(data);
      setError(null);

      // Append decision logs to local terminal state
      if (data.decision_log) {
        const lines = data.decision_log.split('\n');
        setLogMessages((prev) => {
          const updated = [...prev, ...lines];
          return updated.slice(-150); // Keep last 150 lines
        });
      }
      
      // Auto scroll terminal to bottom
      setTimeout(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);

    } catch (err: any) {
      setError(err.message || "Failed to load frame data");
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Trigger fetch when currentFrame changes
  useEffect(() => {
    fetchFrame(currentFrame);
  }, [currentFrame]);

  // 4. Playback loop
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(() => {
        setCurrentFrame((prev) => {
          if (prev >= totalFrames - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, playbackSpeed);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, totalFrames, playbackSpeed]);

  const handlePlayPause = () => setIsPlaying(!isPlaying);
  const handleReset = () => {
    setIsPlaying(false);
    setCurrentFrame(0);
    setLogMessages([]);
  };

  const handleStepForward = () => {
    setIsPlaying(false);
    if (currentFrame < totalFrames - 1) {
      setCurrentFrame((prev) => prev + 1);
    }
  };

  const handleStepBackward = () => {
    setIsPlaying(false);
    if (currentFrame > 0) {
      setCurrentFrame((prev) => prev - 1);
    }
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setUploadError(null);
    setIsPlaying(false);
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await fetch('/api/reflex/upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!res.ok) {
        const errText = await res.text();
        let errMsg = 'Failed to upload video';
        try {
          const parsed = JSON.parse(errText);
          errMsg = parsed.detail || errMsg;
        } catch {
          errMsg = errText || errMsg;
        }
        throw new Error(errMsg);
      }
      
      const data = await res.json();
      setTotalFrames(data.total_frames);
      setCurrentFrame(0);
      setVideoFileName(file.name);
      setFrameData(null);
      
      setLogMessages((prev) => [
        ...prev,
        `[SYSTEM] Dynamic video stream loaded: ${file.name}`,
        `[SYSTEM] Read ${data.total_frames} frames from video container.`,
      ].slice(-150));
    } catch (err: any) {
      console.error(err);
      setUploadError(err.message || 'Error uploading video');
      setLogMessages((prev) => [
        ...prev,
        `[SYSTEM ERROR] Failed to load video: ${err.message}`,
      ].slice(-150));
    } finally {
      setIsUploading(false);
    }
  };

  const handleResetVideo = async () => {
    setIsUploading(true);
    setUploadError(null);
    setIsPlaying(false);
    try {
      const res = await fetch('/api/reflex/reset_video', {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to reset video');
      const data = await res.json();
      setTotalFrames(data.total_frames);
      setCurrentFrame(0);
      setVideoFileName(null);
      setFrameData(null);
      setLogMessages((prev) => [
        ...prev,
        `[SYSTEM] Reset to default Starlink Tango debris video stream.`,
      ].slice(-150));
    } catch (err: any) {
      console.error(err);
      setUploadError('Failed to reset video');
    } finally {
      setIsUploading(false);
    }
  };

  // Trajectory Simulation Logic: calculate offsets based on state
  const distance = frameData?.pose.distance ?? 5.0;
  const isEvading = frameData?.status === "CRITICAL";
  const isWarning = frameData?.status === "WARNING";

  return (
    <div className="w-full h-full grid grid-cols-12 gap-6 p-6 overflow-y-auto bg-[#070a13] font-sans text-gray-200">
      
      {/* 1. LEFT PANEL: Camera Feed & Video Controls (7 columns) */}
      <div className="col-span-12 xl:col-span-7 flex flex-col space-y-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur-md relative flex flex-col flex-1 min-h-[450px]">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Compass className="w-5 h-5 text-emerald-400 animate-spin-slow" />
              <span className="text-sm font-mono tracking-widest font-bold text-emerald-400">
                ONBOARD CAM - TANGO SATELLITE
              </span>
            </div>
            {/* Status Badge */}
            <div className="flex items-center space-x-2">
              <span className="text-xs font-mono text-gray-400">STATUS:</span>
              <span
                className={`px-3 py-1 rounded text-xs font-mono font-bold uppercase tracking-wider animate-pulse ${
                  frameData?.status === "CRITICAL"
                    ? "bg-red-600/20 text-red-500 border border-red-500/40"
                    : frameData?.status === "WARNING"
                    ? "bg-amber-600/20 text-amber-500 border border-amber-500/40"
                    : "bg-emerald-600/20 text-emerald-500 border border-emerald-500/40"
                }`}
              >
                {frameData?.status ?? "OFFLINE"}
              </span>
            </div>
          </div>

          {/* Video / Frame Feed Frame */}
          <div className="flex-1 relative bg-black/60 rounded-xl overflow-hidden border border-white/5 flex items-center justify-center min-h-[350px]">
            {isUploading && (
              <div className="absolute inset-0 bg-black/95 backdrop-blur-sm z-40 flex flex-col items-center justify-center space-y-4">
                <div className="relative w-16 h-16 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-4 border-emerald-500/20" />
                  <div className="absolute inset-0 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
                  <Cpu className="w-6 h-6 text-emerald-400 animate-pulse" />
                </div>
                <div className="flex flex-col items-center space-y-1">
                  <span className="text-sm font-mono font-bold tracking-widest text-emerald-400 uppercase animate-pulse">
                    INGESTING DATA STREAM
                  </span>
                  <span className="text-[10px] font-mono text-gray-500">
                    PARSING CONTROLLERS & INITIALIZING MODELS
                  </span>
                </div>
              </div>
            )}

            {frameData?.image ? (
              <img
                src={`data:image/jpeg;base64,${frameData.image}`}
                alt="Onboard Sensor Feed"
                className="w-full h-full object-contain max-h-[500px]"
              />
            ) : (
              <div className="text-gray-500 font-mono text-sm">
                {isLoading ? "RUNNING INFERENCE..." : "LOADING CAMERA FEED..."}
              </div>
            )}

            {/* Scanning HUD Overlays */}
            <div className="absolute inset-0 pointer-events-none border border-emerald-500/10">
              {/* Target Bounding Box corner tags (decorative) */}
              <div className="absolute top-4 left-4 w-4 h-4 border-t-2 border-l-2 border-emerald-500/40" />
              <div className="absolute top-4 right-4 w-4 h-4 border-t-2 border-r-2 border-emerald-500/40" />
              <div className="absolute bottom-4 left-4 w-4 h-4 border-b-2 border-l-2 border-emerald-500/40" />
              <div className="absolute bottom-4 right-4 w-4 h-4 border-b-2 border-r-2 border-emerald-500/40" />
              
              {/* Scanline line animation */}
              <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(16,185,129,0.03)_50%,rgba(0,0,0,0.25)_50%)] bg-[size:100%_4px]" />
              <div className="absolute left-0 w-full h-[2px] bg-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.5)] animate-scanline" />

              {/* Threat Warning Alert Overlay */}
              {isEvading && (
                <div className="absolute inset-0 border-2 border-red-500 animate-pulse bg-red-950/15 flex items-center justify-center">
                  <div className="bg-black/80 px-6 py-3 border border-red-500 rounded-lg text-red-500 font-bold font-mono tracking-widest text-center shadow-lg">
                    CRITICAL COLLISION THREAT
                    <br />
                    <span className="text-xs text-white">AUTONOMOUS EVASION TRIGGERED</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Player controls */}
          <div className="mt-4 flex flex-col md:flex-row items-center justify-between gap-4 border-t border-white/5 pt-4">
            <div className="flex items-center space-x-2">
              <button
                onClick={handleReset}
                className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors cursor-pointer"
                title="Reset"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={handleStepBackward}
                disabled={currentFrame === 0}
                className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                title="Step Backward"
              >
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                onClick={handlePlayPause}
                className="p-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full transition-colors cursor-pointer shadow-lg shadow-emerald-600/30"
                title={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>
              <button
                onClick={handleStepForward}
                disabled={currentFrame >= totalFrames - 1}
                className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                title="Step Forward"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            {/* Slider bar */}
            <div className="flex-1 px-4 flex items-center space-x-2 w-full">
              <span className="text-xs font-mono text-gray-400">FRAME:</span>
              <input
                type="range"
                min={0}
                max={totalFrames - 1}
                value={currentFrame}
                onChange={(e) => {
                  setIsPlaying(false);
                  setCurrentFrame(parseInt(e.target.value));
                }}
                className="flex-1 accent-emerald-500 h-1 bg-white/10 rounded-lg cursor-pointer"
              />
              <span className="text-xs font-mono text-gray-300 w-16 text-right">
                {currentFrame + 1} / {totalFrames}
              </span>
            </div>

            {/* Speed config */}
            <div className="flex items-center space-x-2">
              <span className="text-xs font-mono text-gray-400">INTERVAL:</span>
              <select
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(parseInt(e.target.value))}
                className="bg-black/60 border border-white/10 rounded px-2 py-1 text-xs font-mono text-emerald-400 focus:outline-none"
              >
                <option value={500}>0.5s</option>
                <option value={300}>0.3s</option>
                <option value={150}>0.15s</option>
              </select>
            </div>
          </div>
        </div>

        {/* Video Upload Control Panel */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-md flex flex-col animate-fadeIn">
          <div className="flex items-center space-x-2 border-b border-white/10 pb-3 mb-4">
            <Video className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-mono tracking-widest font-bold text-emerald-400 uppercase">
              Sensor Feed Ingestion (YOLOv8 + 6DOF PIPELINE)
            </h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Upload Input Card */}
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-white/10 hover:border-emerald-500/50 bg-black/40 rounded-xl p-5 cursor-pointer transition-colors group relative">
              <Upload className="w-8 h-8 text-gray-400 group-hover:text-emerald-400 transition-colors mb-2" />
              <span className="text-xs font-mono text-gray-300 group-hover:text-white transition-colors text-center font-bold">
                UPLOAD VIDEO STREAM
              </span>
              <span className="text-[10px] font-mono text-gray-500 mt-1">
                MP4, AVI, MOV, MKV, WEBM
              </span>
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleVideoUpload}
                disabled={isUploading}
              />
            </label>

            {/* Ingested status */}
            <div className="flex flex-col justify-between border border-white/5 bg-black/50 rounded-xl p-4 min-h-[120px]">
              <div>
                <span className="text-[10px] font-mono text-gray-500 block uppercase">CURRENT FEED</span>
                <span className="text-sm font-mono font-bold text-emerald-400 block truncate mt-1" title={videoFileName || 'default_tango_dataset.mp4'}>
                  {videoFileName || 'default_tango_dataset.mp4'}
                </span>
                <span className="text-xs font-mono text-gray-400 block mt-1">
                  Resolution: Scaled to 224x224 for models
                </span>
              </div>
              
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="text-[10px] font-mono text-gray-500">PIPELINE:</span>
                  <span className="text-[10px] font-mono font-bold text-emerald-500 uppercase tracking-widest bg-emerald-950/30 px-2 py-0.5 rounded border border-emerald-500/20">
                    READY
                  </span>
                </div>
                
                {videoFileName && (
                  <button
                    onClick={handleResetVideo}
                    className="flex items-center space-x-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono py-1 px-2.5 rounded transition-colors text-gray-300 hover:text-white cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>RESET FEED</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {uploadError && (
            <div className="mt-3 flex items-start space-x-2 text-xs font-mono text-red-400 bg-red-950/20 border border-red-500/30 rounded-xl p-3">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{uploadError}</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. RIGHT PANEL: Pose Telemetry & Reasoning Engine (5 columns) */}
      <div className="col-span-12 xl:col-span-5 flex flex-col space-y-6">
        
        {/* 2.1 Pose Telemetry HUD */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-md flex flex-col">
          <div className="flex items-center space-x-2 border-b border-white/10 pb-3 mb-4">
            <Compass className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-mono tracking-widest font-bold text-emerald-400 uppercase">
              6DOF Pose Telemetry (CNN)
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Translation Vector */}
            <div className="col-span-2 md:col-span-1 border border-white/5 bg-black/40 rounded-xl p-3">
              <span className="text-xs font-mono text-gray-500 block mb-2">TRANSLATION (meters)</span>
              <div className="space-y-2 font-mono text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">X:</span>
                  <span className="font-bold text-white">{frameData?.pose.translation[0].toFixed(3) ?? "0.000"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Y:</span>
                  <span className="font-bold text-white">{frameData?.pose.translation[1].toFixed(3) ?? "0.000"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Z:</span>
                  <span className="font-bold text-white">{frameData?.pose.translation[2].toFixed(3) ?? "0.000"}</span>
                </div>
              </div>
            </div>

            {/* Rotation Quaternion */}
            <div className="col-span-2 md:col-span-1 border border-white/5 bg-black/40 rounded-xl p-3">
              <span className="text-xs font-mono text-gray-500 block mb-2">QUATERNION (orientation)</span>
              <div className="space-y-1 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Qw:</span>
                  <span className="font-bold text-white">{frameData?.pose.quaternion[0].toFixed(3) ?? "1.000"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Qx:</span>
                  <span className="font-bold text-white">{frameData?.pose.quaternion[1].toFixed(3) ?? "0.000"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Qy:</span>
                  <span className="font-bold text-white">{frameData?.pose.quaternion[2].toFixed(3) ?? "0.000"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Qz:</span>
                  <span className="font-bold text-white">{frameData?.pose.quaternion[3].toFixed(3) ?? "0.000"}</span>
                </div>
              </div>
            </div>

            {/* Threat Distance Slider Indicator */}
            <div className="col-span-2 border border-white/5 bg-black/40 rounded-xl p-4 flex flex-col">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-mono text-gray-400">CLOSEST APPROACH RANGE</span>
                <span
                  className={`text-lg font-mono font-bold ${
                    isEvading ? "text-red-500" : isWarning ? "text-amber-500" : "text-emerald-500"
                  }`}
                >
                  {distance.toFixed(2)} m
                </span>
              </div>
              {/* Range status bar */}
              <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden relative border border-white/5">
                <div
                  className={`h-full transition-all duration-150 rounded-full ${
                    isEvading ? "bg-red-500" : isWarning ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(100, (distance / 5.0) * 100)}%` }}
                />
                {/* 1.5m Threshold marker */}
                <div className="absolute left-[30%] top-0 bottom-0 w-[2px] bg-red-600" title="1.5m Alert Limit" />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-gray-500 mt-1">
                <span>0.0m (Collision)</span>
                <span>1.5m (Evasion Threshold)</span>
                <span>5.0m+ (Safe)</span>
              </div>
            </div>
          </div>
        </div>

        {/* 2.2 Onboard AI Reasoning Console */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-md flex flex-col flex-1 min-h-[350px]">
          <div className="flex items-center space-x-2 border-b border-white/10 pb-3 mb-4">
            <Cpu className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-mono tracking-widest font-bold text-emerald-400 uppercase">
              Onboard Decision Engine (LLM + RAG)
            </h3>
          </div>

          {/* Terminal Console */}
          <div className="flex-1 bg-black/60 rounded-xl border border-white/5 p-4 font-mono text-xs overflow-y-auto max-h-[300px] flex flex-col space-y-2 relative shadow-inner">
            <div className="absolute top-2 right-2 text-[9px] text-emerald-500/50 uppercase tracking-widest">
              Llama-3B-Int4 // Gram-Constrained
            </div>

            {logMessages.map((msg, i) => {
              let color = "text-gray-300";
              if (msg.startsWith("Search Query:") || msg.startsWith("Found Play:")) {
                color = "text-sky-400";
              } else if (msg.startsWith("Executing Evasion") || msg.startsWith("CRITICAL")) {
                color = "text-red-400 font-bold";
              } else if (msg.includes("Command constraint validated")) {
                color = "text-emerald-400 font-bold";
              } else if (msg.startsWith("Verdict:")) {
                color = "text-amber-400";
              }
              return (
                <div key={i} className={color}>
                  {msg}
                </div>
              );
            })}
            
            <div ref={logEndRef} />
          </div>

          {/* Grammar JSON Output Panel */}
          {frameData?.dodge_command && (
            <div className="mt-4 border border-red-500/30 bg-red-950/10 rounded-xl p-3">
              <span className="text-[10px] font-mono text-red-400 block mb-1 font-bold">
                EMITTED COMMAND (FORCED JSON SCHEMA)
              </span>
              <pre className="text-xs font-mono text-white overflow-x-auto bg-black/40 p-2 rounded border border-white/5">
                {JSON.stringify(frameData.dodge_command, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* 3. BOTTOM PANEL: Evasion Trajectory Simulation (Full Width 12 columns) */}
      <div className="col-span-12 bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
          <div className="flex items-center space-x-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-mono tracking-widest font-bold text-emerald-400 uppercase">
              Evade Trajectory Path Visualizer (Reflex Action)
            </h3>
          </div>
          {isEvading && (
            <span className="text-xs font-mono text-red-500 bg-red-950/20 border border-red-500/30 rounded px-2 py-0.5 animate-pulse uppercase">
              ACTIVE THRUSTER FIRE (AXIS Y)
            </span>
          )}
        </div>

        {/* Evasion animation canvas simulation */}
        <div className="h-44 bg-black/60 rounded-xl border border-white/5 relative overflow-hidden flex items-center justify-center">
          
          {/* Visual Grid Lines */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:30px_30px]" />

          {/* Reference Centerline */}
          <div className="absolute left-0 right-0 h-[1px] bg-white/10 border-dashed border-b border-white/10" />

          {/* Orbit corridors boundaries */}
          <div className="absolute left-0 right-0 h-8 border-y border-emerald-500/10 bg-emerald-500/5 top-1/2 -translate-y-1/2" />

          {/* Satellite Trajectory Line */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {/* Evasion deviation curve */}
            <path
              d={`M 0 88 L 200 88 Q 350 ${isEvading ? "140" : "88"} 500 ${isEvading ? "140" : "88"} T 900 88`}
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
              strokeDasharray={isEvading ? "0" : "5, 5"}
              className="transition-all duration-300"
            />
            
            {/* Debris Crossing Line */}
            <path
              d="M 350 0 L 550 176"
              fill="none"
              stroke="#ef4444"
              strokeWidth="2.5"
              strokeDasharray="4, 4"
            />
          </svg>

          {/* Satellite Icon Node */}
          <div
            className={`absolute w-8 h-8 rounded-full border flex items-center justify-center shadow-lg transition-all duration-300 ${
              isEvading
                ? "bg-emerald-600/30 border-emerald-500 shadow-emerald-500/20"
                : "bg-gray-800/40 border-gray-600"
            }`}
            style={{
              left: `${Math.min(95, 20 + (currentFrame / totalFrames) * 60)}%`,
              top: `calc(50% - 16px + ${isEvading ? "50px" : "0px"})`
            }}
          >
            <Cpu className={`w-4 h-4 ${isEvading ? "text-emerald-400" : "text-gray-400"}`} />

            {/* Thruster Plume */}
            {isEvading && (
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-3 h-6 bg-gradient-to-b from-transparent via-amber-500 to-red-600 blur-[1px] rounded-full animate-pulse transform rotate-180" />
            )}
            
            {/* Labels */}
            <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[9px] font-mono text-gray-500 uppercase tracking-widest whitespace-nowrap">
              Satellite
            </span>
          </div>

          {/* Debris Icon Node */}
          <div
            className="absolute w-6 h-6 rounded-lg bg-red-950/40 border border-red-500 flex items-center justify-center shadow-lg shadow-red-500/10 transition-all duration-100"
            style={{
              left: `calc(35% - 12px + ${(currentFrame / totalFrames) * 150}px)`,
              top: `calc(0% - 12px + ${(currentFrame / totalFrames) * 132}px)`
            }}
          >
            <div className="w-2 h-2 bg-red-500 rounded-sm animate-spin-slow" />
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-mono text-red-400 uppercase tracking-widest whitespace-nowrap">
              Debris
            </span>
          </div>

          {/* Visual indicators */}
          <div className="absolute top-2 left-4 text-[10px] font-mono text-gray-500 flex items-center space-x-4">
            <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-emerald-500 mr-1.5" /> NOMINAL FLIGHT PATH</span>
            <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-red-500 mr-1.5" /> DEBRIS trajectory</span>
          </div>
          
          {/* Action Callout */}
          {isEvading && (
            <div className="absolute bottom-2 right-4 bg-red-950/30 border border-red-500/40 px-3 py-1 rounded text-[10px] font-mono text-red-400 tracking-wider">
              THRUST ACTION AXIS-Y (+50m CORRIDOR BIAS)
            </div>
          )}
        </div>
      </div>

    </div>
  );
};
