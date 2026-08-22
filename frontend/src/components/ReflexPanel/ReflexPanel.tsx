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
  // Decision-Loop Replay: sweeps the relative range across threat bands to
  // demonstrate the full autonomous policy on the benchmark clip. Detection +
  // decision logic stay live; only the range is a labeled swept input.
  const [replayMode, setReplayMode] = useState<boolean>(false);
  // Prewarm progress so playback is smooth instead of laggy on first pass.
  const [bufferReady, setBufferReady] = useState<number>(0);
  const [bufferTotal, setBufferTotal] = useState<number>(0);
  const [prewarmNonce, setPrewarmNonce] = useState<number>(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const fetchSeqRef = useRef<number>(0);

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
    const seq = ++fetchSeqRef.current;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/reflex/frame/${idx}${replayMode ? '?mode=replay' : ''}`);
      if (!res.ok) {
        // Surface the backend's human-readable reason (e.g. 503 when the YOLO26
        // weights or video are unavailable on the deployment) instead of a
        // generic message.
        let detail = `Failed to fetch frame ${idx}`;
        try {
          const body = await res.json();
          if (body?.detail) detail = body.detail;
        } catch { /* non-JSON error body */ }
        throw new Error(detail);
      }
      const data: FrameData = await res.json();
      if (seq !== fetchSeqRef.current) return; // a newer request superseded this one
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

      // Auto scroll terminal container only (avoiding page-level scroll)
      setTimeout(() => {
        if (terminalRef.current) {
          terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
      }, 50);

    } catch (err: any) {
      if (seq !== fetchSeqRef.current) return;
      setError(err.message || "Failed to load frame data");
    } finally {
      if (seq === fetchSeqRef.current) setIsLoading(false);
    }
  };

  // 3. Trigger fetch when the frame or the replay mode changes
  useEffect(() => {
    fetchFrame(currentFrame);
  }, [currentFrame, replayMode]);

  // 3b. Pre-warm: background-compute frames into the server cache so playback is
  // smooth instead of running CPU inference live per frame. Re-runs on mount,
  // when replay mode toggles, and after an upload/reset (via prewarmNonce).
  useEffect(() => {
    const q = replayMode ? '?mode=replay' : '';
    setBufferReady(0);
    setBufferTotal(0);
    fetch(`/api/reflex/prewarm${q}`, { method: 'POST' }).catch(() => {});
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`/api/reflex/prewarm_status${q}`);
        if (!r.ok) return;
        const d = await r.json();
        setBufferReady(d.ready ?? 0);
        setBufferTotal(d.total ?? 0);
        if (d.done || (d.total > 0 && (d.ready ?? 0) >= d.total)) clearInterval(poll);
      } catch { /* ignore prewarm poll errors */ }
    }, 1500);
    return () => clearInterval(poll);
  }, [replayMode, prewarmNonce]);

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

  const toggleReplay = () => {
    setIsPlaying(false);
    setCurrentFrame(0);
    setLogMessages([]);
    setReplayMode((m) => !m);
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
      // An uploaded clip shows REAL measured range, not the replay sweep.
      setReplayMode(false);
      setPrewarmNonce((n) => n + 1);

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
      setPrewarmNonce((n) => n + 1);
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

  // Live Decision card: surface what the agent chose this frame, pulled from the
  // fields the frame response already carries (no extra request). The play name
  // and verdict live inside decision_log; the command is structured.
  const status = frameData?.status ?? "OFFLINE";
  const bandLabel = status === "CRITICAL" ? "EVASION" : status;
  const decisionLines = frameData?.decision_log ? frameData.decision_log.split('\n') : [];
  const playMatch = decisionLines.find((l) => l.startsWith('Found Play:'))?.match(/Found Play: '([^']+)'/);
  const playName = playMatch ? playMatch[1] : null;
  const verdictLine = decisionLines.find((l) => l.startsWith('Verdict:'));
  const verdict = verdictLine ? verdictLine.replace(/^Verdict:\s*/, '') : null;
  const cmd = frameData?.dodge_command;
  // An uploaded off-domain clip detects nothing; show that as scanning, not broken.
  const noTarget = !!frameData && frameData.box === null;

  // ---------------------------------------------------------------------
  // Encounter schematic geometry.
  //
  // This used to be driven by position in the video clip (satX = 50 + t*900),
  // which made the dodge unreachable: the swept range only crosses into
  // CRITICAL at t > 0.795, putting satX above 766, while the offset branch
  // required satX <= 750. The satellite therefore never left the centerline,
  // and the drawn S-curve sat entirely behind it.
  //
  // Everything below is now derived from the MEASURED range, so the marker and
  // the path are always consistent and the maneuver is visible exactly when the
  // safety check actually fires.
  // ---------------------------------------------------------------------
  const SAFE_RANGE_M = 2.2;   // backend/api/reflex_playbook.py:76
  const WARNING_RANGE_M = 1.5; // backend/api/reflex_playbook.py:77
  const CLOSEST_RANGE_M = 0.6; // REPLAY_RANGE_NEAR_M

  // How far through the approach we are (0 = first warning, 1 = closest point).
  const approach = Math.max(
    0,
    Math.min(1, (SAFE_RANGE_M - distance) / (SAFE_RANGE_M - CLOSEST_RANGE_M))
  );
  // How committed the evasion is (0 at the CRITICAL threshold, 1 at closest).
  const evadeAmount = Math.max(
    0,
    Math.min(1, (WARNING_RANGE_M - distance) / (WARNING_RANGE_M - CLOSEST_RANGE_M))
  );

  const MAX_OFFSET_PX = 52;
  const satX = 50 + approach * 900;
  // Negative = above the centerline, away from the debris crossing.
  const offset = isEvading ? evadeAmount * MAX_OFFSET_PX : 0;
  const satY = 88 - offset;

  // x at which the evasion departs the nominal corridor (the CRITICAL crossing).
  const critX =
    50 + ((SAFE_RANGE_M - WARNING_RANGE_M) / (SAFE_RANGE_M - CLOSEST_RANGE_M)) * 900;

  // The backend emits post_evade_action: 'schedule_correction_burn' on every
  // burn. It was previously read by nothing; it drives the return leg here.
  const willCorrect = cmd?.post_evade_action === 'schedule_correction_burn';

  // Flown path: straight, then departing at critX toward the current offset.
  const flownPath = isEvading
    ? `M 0 88 L ${critX.toFixed(0)} 88 Q ${((critX + satX) / 2).toFixed(0)} ${(88 - offset * 1.25).toFixed(0)} ${satX.toFixed(0)} ${satY.toFixed(0)}`
    : 'M 0 88 L 1000 88';

  // Planned return to the nominal corridor after the encounter.
  const correctionPath =
    isEvading && willCorrect
      ? `M ${satX.toFixed(0)} ${satY.toFixed(0)} Q ${((satX + 1000) / 2).toFixed(0)} ${(88 - offset * 1.25).toFixed(0)} 1000 88`
      : null;

  // Debris closes on the corridor and crosses it at the point of closest
  // approach, so the near-miss happens where the satellite has stepped aside.
  const debrisX = 90 + approach * 900;
  // Keep the marker exactly on its drawn crossing line (M 0 0 L 1000 176).
  const debrisY = (debrisX / 1000) * 176;

  return (
    <div className="w-full h-full grid grid-cols-12 gap-6 p-6 overflow-y-auto bg-[#070a13] font-sans text-gray-200">

      {/* Context header for judges */}
      <div className="col-span-12 border-b border-white/5 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-mono font-bold text-white">OrbitMind · Vision-Based Proximity Reflex</h2>
            <p className="text-sm text-gray-100 mt-1.5 max-w-3xl leading-snug">
              An onboard satellite sees tumbling debris through its own camera, decides how to dodge it, and fires the maneuver itself, all in real time and with every thruster command safety-checked before it runs.
            </p>
            <p className="text-xs font-mono text-gray-400 mt-1.5 max-w-3xl">
              YOLO26 detection + MobileNetV3 6-DOF pose (metric, via the ESA SPEED+ camera model) feed a closed decision loop: classify the range band, retrieve an evasion playbook, reason with an LLM, and validate every thruster command against a deterministic safety envelope. Demonstrated on the ESA SPEED+ Tango spacecraft-proximity benchmark.
            </p>
          </div>
          <div className="flex items-center space-x-4 text-[10px] font-mono text-gray-500">
            {/* Bands must match backend/api/reflex_playbook.py:76-77 —
                SAFE_RANGE_M = 2.2, WARNING_RANGE_M = 1.5. The legend
                previously claimed SAFE was anything above 1.5 m, which
                contradicted the amber chip sitting next to it. */}
            <span className="flex items-center space-x-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /><span>SAFE (&gt;2.2 m)</span></span>
            <span className="flex items-center space-x-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /><span>WARNING (1.5&ndash;2.2 m)</span></span>
            <span className="flex items-center space-x-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /><span>EVASION (&lt;1.5 m)</span></span>
          </div>
        </div>
      </div>

      {/* 1. LEFT PANEL: Camera Feed & Video Controls (7 columns) */}
      <div className="col-span-12 xl:col-span-7 flex flex-col space-y-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur-md relative flex flex-col flex-1 min-h-[450px]">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Compass className="w-5 h-5 text-emerald-400" />
              <span className="text-sm font-mono tracking-widest font-bold text-emerald-400">
                ONBOARD CAM · TANGO SATELLITE
              </span>
            </div>
            {/* Replay toggle + status badge */}
            <div className="flex items-center space-x-3">
              <button
                onClick={toggleReplay}
                title="Scenario Playback walks the relative range across every threat band so the full autonomous decision policy is visible. Detection and decision logic stay live; only the closing range is scripted."
                className={`px-3 py-1 rounded text-xs font-mono font-bold uppercase tracking-wider border transition-colors cursor-pointer ${
                  replayMode
                    ? "bg-sky-600/30 text-sky-300 border-sky-500/50"
                    : "bg-white/5 text-gray-300 border-white/10 hover:bg-white/10 hover:text-white"
                }`}
              >
                {replayMode ? "● Scenario Playback" : "Scenario Playback"}
              </button>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono text-gray-400">STATUS:</span>
                <span
                  className={`px-3 py-1 rounded text-xs font-mono font-bold uppercase tracking-wider ${
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
          </div>

          {/* Video / Frame Feed Frame */}
          <div className={`flex-1 relative bg-black/60 rounded-xl overflow-hidden flex items-center justify-center min-h-[350px] transition-colors duration-300 ${
            isEvading ? "border border-red-500/60" : "border border-white/5"
          }`}>
            {isUploading && (
              <div className="absolute inset-0 bg-black/90 z-40 flex flex-col items-center justify-center space-y-4">
                <div className="relative w-12 h-12 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-4 border-emerald-500/20" />
                  <div className="absolute inset-0 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
                </div>
                <div className="flex flex-col items-center space-y-1">
                  {bufferTotal > 0 ? (
                    <>
                      <span className="text-sm font-mono text-emerald-400">
                        Buffering {bufferReady}/{bufferTotal} frames ({Math.round((bufferReady / bufferTotal) * 100)}%)
                      </span>
                      <span className="text-[10px] font-mono text-gray-500">Running YOLO + pose estimation per frame</span>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-mono text-emerald-400">Processing video...</span>
                      <span className="text-[10px] font-mono text-gray-500">Initializing YOLO + pose estimation</span>
                    </>
                  )}
                </div>
              </div>
            )}
            {isEvading && (
              <div className="absolute top-10 left-1/2 -translate-x-1/2 z-30 bg-red-950/80 border border-red-500/60 px-4 py-1.5 rounded text-xs font-mono text-red-400 font-bold tracking-wider">
                EVASION ACTIVE · range &lt;1.5 m{replayMode ? " (simulated)" : ""}
              </div>
            )}
            {replayMode && (
              <div className="absolute top-0 left-0 right-0 z-30 bg-amber-500/90 text-black px-4 py-2 text-[11px] font-mono font-bold tracking-wide text-center leading-snug">
                SCENARIO PLAYBACK · walks the satellite through every threat band (safe to evade) so you can watch the full autonomous policy. Detection and 6-DOF pose are live; only the closing range is scripted.
              </div>
            )}
            {bufferTotal > 0 && bufferReady < bufferTotal && (
              <div className="absolute bottom-3 left-3 z-30 flex items-center space-x-2 bg-black/70 border border-white/10 px-2.5 py-1 rounded text-[10px] font-mono text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Buffering {Math.round((bufferReady / bufferTotal) * 100)}%</span>
              </div>
            )}

            {noTarget && !isLoading && !isUploading && (
              <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                <div className="bg-black/70 border border-amber-500/40 rounded-lg px-4 py-2 text-center">
                  <span className="text-xs font-mono font-bold text-amber-400">NO TARGET IN FRAME · SCANNING</span>
                  {videoFileName && (
                    <span className="block text-[10px] font-mono text-gray-400 mt-1 max-w-xs">
                      This onboard model is trained for spacecraft proximity imagery (ESA SPEED+ / Tango).
                    </span>
                  )}
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
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-md flex flex-col">
          <div className="flex items-center space-x-2 border-b border-white/10 pb-3 mb-4">
            <Video className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-mono tracking-widest font-bold text-emerald-400 uppercase">
              Sensor Feed Ingestion (YOLO26 + 6DOF PIPELINE)
            </h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Upload Input Card */}
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-white/10 hover:border-emerald-500/50 bg-black/40 rounded-xl p-5 cursor-pointer transition-colors group relative">
              <Upload className="w-8 h-8 text-gray-400 group-hover:text-emerald-400 transition-colors mb-2" />
              <span className="text-xs font-mono text-gray-300 group-hover:text-white transition-colors text-center font-bold">
                UPLOAD A SPEED+ STYLE CLIP
              </span>
              <span className="text-[10px] font-mono text-gray-500 mt-1 text-center leading-snug max-w-[16rem]">
                Trained on ESA SPEED+ / Tango spacecraft imagery. Other footage may show no target, and it runs live so it is slower than the bundled clip.
              </span>
              <span className="text-[10px] font-mono text-gray-600 mt-1">
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
                  Pipeline: YOLO26 800px → 6-DOF pose (224px crop)
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

        {/* 2.0 Agent Live Decision (hero) */}
        <div className={`rounded-2xl p-5 backdrop-blur-md border transition-colors ${
          isEvading
            ? "bg-red-950/20 border-red-500/40"
            : isWarning
            ? "bg-amber-950/15 border-amber-500/30"
            : "bg-emerald-950/10 border-emerald-500/25"
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Cpu className="w-5 h-5 text-emerald-400" />
              <span className="text-sm font-mono tracking-widest font-bold text-emerald-400 uppercase">
                Live Decision
              </span>
            </div>
            <span className={`px-3 py-1 rounded text-xs font-mono font-bold uppercase tracking-wider border ${
              isEvading
                ? "bg-red-600/20 text-red-400 border-red-500/40"
                : isWarning
                ? "bg-amber-600/20 text-amber-400 border-amber-500/40"
                : "bg-emerald-600/20 text-emerald-400 border-emerald-500/40"
            }`}>
              {bandLabel}
            </span>
          </div>

          <div className="space-y-2.5">
            <div>
              <span className="text-[10px] font-mono text-gray-500 uppercase block">Retrieved play</span>
              <span className="text-sm font-mono text-white">{playName ?? "Awaiting telemetry"}</span>
            </div>
            {verdict && (
              <div>
                <span className="text-[10px] font-mono text-gray-500 uppercase block">Verdict</span>
                <span className="text-sm font-mono text-gray-200">{verdict}</span>
              </div>
            )}
            <div>
              <span className="text-[10px] font-mono text-gray-500 uppercase block">Command</span>
              {cmd ? (
                <span className="text-sm font-mono font-bold text-red-400">
                  EVADE · +{cmd.axis} · {cmd.delta_v_cm_s} cm/s · {cmd.duration_ms} ms · guardrail validated
                </span>
              ) : (
                <span className="text-sm font-mono text-emerald-400">No burn. Passive tracking.</span>
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-white/10 text-[10px] font-mono text-gray-500 leading-snug">
            deterministic band → RAG playbook → LLM reasoning → guardrail-validated command
          </div>
        </div>

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
                <span className="text-xs font-mono text-gray-400">CLOSEST APPROACH RANGE · {replayMode ? <span className="text-amber-400">SIMULATED</span> : <span className="text-emerald-400">MEASURED</span>}</span>
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
          <div className="flex items-start space-x-2 border-b border-white/10 pb-3 mb-4">
            <Cpu className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-mono tracking-widest font-bold text-emerald-400 uppercase">
                Onboard Decision Engine
              </h3>
              <p className="text-[10px] font-mono text-gray-500 mt-0.5">
                deterministic classification → retrieval-grounded reasoning (LLM+RAG) → guardrail-validated command
              </p>
            </div>
          </div>

          {/* Terminal Console */}
          <div 
            ref={terminalRef}
            className="flex-1 bg-black/60 rounded-xl border border-white/5 p-4 font-mono text-xs overflow-y-auto max-h-[300px] flex flex-col space-y-2 relative shadow-inner"
          >
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
              Evasion Schematic (illustrative, not to scale)
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
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1000 176" preserveAspectRatio="none">
            {/* Nominal corridor the satellite would have flown */}
            {isEvading && (
              <path
                d="M 0 88 L 1000 88"
                fill="none"
                stroke="#64748b"
                strokeWidth="1.5"
                strokeDasharray="4, 6"
                opacity="0.5"
              />
            )}

            {/* Actually-flown path, driven by the measured range */}
            <path
              d={flownPath}
              fill="none"
              stroke="#10b981"
              strokeWidth="2.5"
              strokeDasharray={isEvading ? "0" : "5, 5"}
            />

            {/* Scheduled correction burn back to the nominal corridor.
                Driven by the real post_evade_action field. */}
            {correctionPath && (
              <path
                d={correctionPath}
                fill="none"
                stroke="#10b981"
                strokeWidth="2"
                strokeDasharray="6, 5"
                opacity="0.55"
              />
            )}

            {/* Debris Crossing Line */}
            <path
              d="M 0 0 L 1000 176"
              fill="none"
              stroke="#ef4444"
              strokeWidth="2.5"
              strokeDasharray="4, 4"
              opacity="0.7"
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
              left: `${(satX / 1000) * 100}%`,
              top: `${(satY / 176) * 100}%`,
              transform: 'translate(-50%, -50%)'
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
              left: `${(debrisX / 1000) * 100}%`,
              top: `${(debrisY / 176) * 100}%`,
              transform: 'translate(-50%, -50%)'
            }}
          >
            <div className="w-2 h-2 bg-red-500 rounded-sm" />
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
              CROSS-TRACK BURN · {cmd?.axis ? `${cmd.axis}-AXIS` : 'Y-AXIS'}
              {cmd?.delta_v_cm_s !== undefined ? ` · ${cmd.delta_v_cm_s} cm/s` : ''}
            </div>
          )}
        </div>
      </div>

    </div>
  );
};
