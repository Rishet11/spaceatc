# SpaceATC — Final Visual & Integration Prompts
**Run in this exact order. Model recommendation listed for each.**
**Deadline: June 14 11:59 PM IST**

---

## PRIORITY ORDER
1. Satellite dots (broken = demo looks dead)
2. Time warp simulation speed (makes orbits visible)
3. Human-readable event feed (judges need context)
4. HITL panel redesign (emotional peak of demo)
5. Streaming math panel (technical differentiator)
6. Metrics real math verification (credibility)
7. Hover tooltips (accessibility for non-technical judges)
8. Post-maneuver orbit visual (resolution moment)
9. Landing page (use Gemini — save Sonnet quota)
10. Universe bug prompt (run last, after everything works)

---

## PROMPT 1 — Fix Satellite Dots + Orbit Trails + Conjunction Visual
**Model: OPUS**

```
Read frontend/src/components/Globe/SatelliteLayer.tsx and Globe.tsx completely.
The satellite dots are not rendering. Fix this completely.

The root cause is almost certainly one of:
1. InstancedMesh matrix not being updated (instanceMatrix.needsUpdate = true missing)
2. ECI position values being NaN (bad coordinate conversion)
3. Satellites array empty in Zustand store (WebSocket not dispatching correctly)

Debug in this order:
STEP 1 - Add to SatelliteLayer.tsx:
  const satellites = useSpaceStore(s => s.satellites)
  console.log('Satellites in store:', satellites.length, satellites[0])
  If 0: problem is in useWebSocket.ts dispatch
  If >0 with NaN positions: problem is coordinate conversion
  If >0 with valid positions: problem is InstancedMesh setup

STEP 2 - Fix coordinate conversion.
The backend sends ECI position in km as {x, y, z}.
Convert to Three.js globe coordinates (unit sphere + altitude):

  import * as satellite from 'satellite.js'

  function eciToThreeJS(
    pos: {x: number, y: number, z: number}, 
    time: Date
  ): THREE.Vector3 {
    const gmst = satellite.gstime(time)
    const geodetic = satellite.eciToGeodetic(
      {x: pos.x, y: pos.y, z: pos.z}, 
      gmst
    )
    const lat = satellite.radiansToDegrees(geodetic.latitude)
    const lon = satellite.radiansToDegrees(geodetic.longitude)
    const alt = geodetic.height  // km above Earth surface
    
    // Convert to Three.js sphere coordinates
    // Earth radius = 1.0 in our scene, altitude scaled
    const R = 1.0 + alt / 6371.0
    const latRad = lat * Math.PI / 180
    const lonRad = lon * Math.PI / 180
    
    return new THREE.Vector3(
      R * Math.cos(latRad) * Math.cos(lonRad),
      R * Math.sin(latRad),
      R * Math.cos(latRad) * Math.sin(lonRad)
    )
  }

STEP 3 - Fix InstancedMesh setup:
  Use this exact pattern (verified from R3F docs):

  const meshRef = useRef<THREE.InstancedMesh>(null)
  const tempObject = useMemo(() => new THREE.Object3D(), [])
  
  useFrame(() => {
    if (!meshRef.current) return
    const now = new Date()
    
    satellites.forEach((sat, i) => {
      if (!sat.position) return
      const pos = eciToThreeJS(sat.position, now)
      tempObject.position.copy(pos)
      
      // Scale: normal=1, highlighted=2, resolved=1.5
      const scale = sat.is_highlighted ? 2.0 : 1.0
      tempObject.scale.setScalar(scale)
      tempObject.updateMatrix()
      meshRef.current!.setMatrixAt(i, tempObject.matrix)
    })
    meshRef.current.instanceMatrix.needsUpdate = true
    
    // Color by operator using instanceColor
    if (meshRef.current.instanceColor) {
      const color = new THREE.Color()
      satellites.forEach((sat, i) => {
        if (sat.is_highlighted) color.set('#ef4444')      // red: conjunction
        else if (sat.operator?.includes('Demo')) color.set('#ffffff')  // white: demo
        else if (sat.operator?.includes('SpaceX')) color.set('#4fc3f7') // blue: Starlink
        else color.set('#ff9800')                          // orange: others
        meshRef.current!.setColorAt(i, color)
      })
      if (meshRef.current.instanceColor) 
        meshRef.current.instanceColor.needsUpdate = true
    }
  })
  
  return (
    <instancedMesh 
      ref={meshRef} 
      args={[undefined, undefined, Math.max(satellites.length, 200)]}
    >
      <sphereGeometry args={[0.004, 4, 4]} />
      <meshBasicMaterial />
    </instancedMesh>
  )

STEP 4 - Add starfield background (one draw call, no performance cost):
  Add to Globe.tsx inside the Canvas:
  
  function Starfield() {
    const positions = useMemo(() => {
      const pos = new Float32Array(3000)
      for (let i = 0; i < 1000; i++) {
        const r = 50 + Math.random() * 50
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(2 * Math.random() - 1)
        pos[i*3] = r * Math.sin(phi) * Math.cos(theta)
        pos[i*3+1] = r * Math.cos(phi)
        pos[i*3+2] = r * Math.sin(phi) * Math.sin(theta)
      }
      return pos
    }, [])
    
    return (
      <points>
        <bufferGeometry>
          <bufferAttribute 
            attach="attributes-position" 
            count={1000} 
            array={positions} 
            itemSize={3} 
          />
        </bufferGeometry>
        <pointsMaterial size={0.1} color="#ffffff" sizeAttenuation />
      </points>
    )
  }

STEP 5 - Conjunction visual:
  When conjunction_detected fires (sat.is_highlighted === true for two sats):
  
  function ConjunctionZone() {
    const conjunctions = useSpaceStore(s => s.conjunctions)
    const satellites = useSpaceStore(s => s.satellites)
    const pulseRef = useRef(0)
    
    const activePair = conjunctions.find(c => c.status === 'negotiating' 
                                          || c.status === 'detected')
    if (!activePair) return null
    
    const satA = satellites.find(s => s.name === activePair.sat_primary)
    const satB = satellites.find(s => s.name === activePair.sat_secondary)
    if (!satA || !satB) return null
    
    const posA = eciToThreeJS(satA.position, new Date())
    const posB = eciToThreeJS(satB.position, new Date())
    const midpoint = posA.clone().add(posB).multiplyScalar(0.5)
    const dist = posA.distanceTo(posB)
    
    useFrame((state) => {
      pulseRef.current = Math.sin(state.clock.elapsedTime * 4) * 0.3 + 1
    })
    
    return (
      <>
        {/* Pulsing red conjunction zone */}
        <mesh position={midpoint} scale={pulseRef.current}>
          <sphereGeometry args={[0.02, 8, 8]} />
          <meshBasicMaterial color="#ef4444" transparent opacity={0.6} />
        </mesh>
        
        {/* Line between the two satellites */}
        <line>
          <bufferGeometry 
            setFromPoints={[posA, posB]} 
          />
          <lineBasicMaterial color="#ef4444" opacity={0.8} transparent />
        </line>
        
        {/* Distance label using @react-three/drei Html */}
        <Html position={midpoint} center>
          <div style={{
            background: 'rgba(239,68,68,0.9)',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
            whiteSpace: 'nowrap'
          }}>
            ⚠ {(dist * 6371).toFixed(1)} km — COLLISION COURSE
          </div>
        </Html>
      </>
    )
  }

STEP 6 - Camera auto-zoom on conjunction:
  In Globe.tsx, add a ref to camera and effect:
  
  const { camera } = useThree()
  const activePair = useSpaceStore(s => s.conjunctions.find(
    c => c.status === 'negotiating' || c.status === 'detected'
  ))
  
  useEffect(() => {
    if (!activePair) return
    // Camera lerp handled in useFrame
  }, [activePair])
  
  useFrame(() => {
    if (activePair) {
      // Find midpoint and zoom there
      const target = new THREE.Vector3(0, 0, 3.5) // closer zoom
      camera.position.lerp(target, 0.02)
    }
  })

After all fixes: console.log should show satellite count > 0,
dots should be visible on globe, conjunction zone should pulse red.
Show me the final working SatelliteLayer.tsx and Globe.tsx.
```

---

## PROMPT 2 — Time Warp Simulation Speed
**Model: SONNET**

```
Implement time warp (simulation speed control) for the satellite visualization.
This is critical: at real-time (1x), satellites barely move. 
At 60x, one orbit (90 min) = 90 real seconds. Visually compelling.

BACKEND CHANGES — backend/main.py:

Add these global variables at top of main.py:
  import time as time_module
  
  SIM_SPEED = 60.0           # default: 60x (1 real sec = 1 orbital min)
  SIM_START_REAL = None      # set on startup
  SIM_START_UTC = None       # datetime at sim start

On startup event, add:
  SIM_START_REAL = time_module.time()
  SIM_START_UTC = datetime.utcnow()

Add function to get current sim time:
  def get_sim_time() -> datetime:
    elapsed_real = time_module.time() - SIM_START_REAL
    elapsed_sim = elapsed_real * SIM_SPEED
    return SIM_START_UTC + timedelta(seconds=elapsed_sim)

In the satellite broadcast background task, change:
  # OLD: propagate to current real time
  # dt = datetime.utcnow()
  # NEW: propagate to simulation time
  dt = get_sim_time()

Add new REST endpoints in routes.py:
  GET /api/sim/speed → returns {"speed": SIM_SPEED, "sim_time": get_sim_time().isoformat()}
  POST /api/sim/speed → body: {"speed": float} → sets SIM_SPEED, returns new speed
    Valid values: 1, 10, 60, 300, 600
    On change: reset SIM_START_REAL = now, SIM_START_UTC = get_sim_time()
    (this prevents time jump when changing speed)

Add to satellite_update WebSocket message payload:
  "sim_time": get_sim_time().isoformat(),
  "sim_speed": SIM_SPEED

FRONTEND CHANGES:

1. Add SimClock component to MetricsBar area:
  Shows: SIM TIME: 2026-06-13 14:23:07 UTC  |  60× SPEED
  The time updates every second using setInterval reading from WS payload

2. Add speed selector buttons below MetricsBar (small, top-right area):
  [1×]  [10×]  [60×]  [300×]  [600×]
  Active button highlighted in blue.
  On click: POST /api/sim/speed with selected value
  
  Style: dark buttons, monospace, small (text-xs)
  Label: "SIMULATION SPEED — 1× = Real time | 60× = 1 sec per orbital minute"

3. Add to Zustand store:
  simSpeed: number (default 60)
  simTime: string (ISO datetime from WS)
  setSimSpeed: (speed: number) => void
  setSimTime: (time: string) => void

4. In useWebSocket.ts, handle satellite_update:
  if (msg.payload.sim_time) store.setSimTime(msg.payload.sim_time)
  if (msg.payload.sim_speed) store.setSimSpeed(msg.payload.sim_speed)

5. Show a tooltip on the speed selector:
  "At 60×: Starlink satellites complete one orbit in ~90 seconds.
   At 1×: same orbit takes 90 minutes."

IMPORTANT: The demo injection endpoint should NOT use sim_time —
it always fires immediately in real time. Only the satellite 
position broadcast uses sim_time.

After implementing, verify:
  - At 60x, satellite dots visibly move across the globe
  - At 1x, they barely move
  - Speed change is instant with no jump
  - Sim clock displayed in UI updates smoothly
```

---

## PROMPT 3 — Human-Readable Event Feed
**Model: SONNET**

```
The event feed currently shows raw event type names like 
"conjunction_detected", "negotiation_update". 
Judges cannot understand this. Fix completely.

In backend/agents/nodes/, update every node to write 
human-readable messages to state["messages"].
These messages should include REAL computed values.

tle_ingestion.py — add to messages:
  f"[TLE INGESTION] Loaded {count} active satellites from CelesTrak"
  f"[TLE INGESTION] Coverage: SpaceX Starlink, OneWeb, active payloads"

conjunction_detector.py — add to messages:
  f"[DETECTOR] Conjunction: {sat_primary} / {sat_secondary}"
  f"[DETECTOR] Miss distance: {miss_km:.3f} km | Pc: {pc:.2e} | TCA: {tca.strftime('%H:%M:%S')} UTC"
  f"[DETECTOR] Status: ALERT — Pc exceeds 1×10⁻⁴ threshold"

negotiation_coordinator.py — add to messages:
  f"[COORDINATOR] Broadcasting Call for Proposals to operators"
  f"[COORDINATOR] Operators involved: {op_a}, {op_b}"

operator_agent.py — add to messages:
  f"[OPERATOR {op_a}] Bid: ΔV={dv_a:.3f} m/s | Score={score_a:.3f} | Fuel remaining: {fuel_a:.0f}%"
  f"[OPERATOR {op_b}] Bid: ΔV={dv_b:.3f} m/s | Score={score_b:.3f} | Fuel remaining: {fuel_b:.0f}%"
  f"[COORDINATOR] Winner: {winner} — lowest cost maneuver selected"

hitl_node.py — add to messages:
  f"[HITL] Proposal sent to human operator for approval"
  f"[HITL] Awaiting decision — 30 second timeout"

maneuver_executor.py — add to messages:
  f"[EXECUTOR] Maneuver approved and executed"
  f"[EXECUTOR] {satellite} — burn: {dv:.3f} m/s {direction}"
  f"[EXECUTOR] Pc: {pc_before:.2e} → {pc_after:.2e} ✓ SAFE"
  f"[EXECUTOR] Conjunction RESOLVED"

In frontend EventFeed.tsx:
  Read from store.eventLog which should be populated from 
  the "messages" field in every WebSocket payload.

  Each EventItem should show:
  - Colored badge by agent type:
    TLE INGESTION → gray #6b7280
    DETECTOR → red #ef4444  
    COORDINATOR → yellow #f59e0b
    OPERATOR → blue #3b82f6
    HITL → orange #f97316
    EXECUTOR → green #22c55e
    SYSTEM → gray #9ca3af
  
  - Timestamp (HH:MM:SS)
  - Full message text (not the raw event type)
  
  Parse the badge from the message string:
    const badge = message.match(/\[([^\]]+)\]/)?.[1] ?? 'SYSTEM'
  
  Auto-scroll to bottom on new message.
  Max 50 messages, oldest removed first.

The event feed should read like a mission control log,
not like a JSON debugger.
```

---

## PROMPT 4 — HITL Panel Redesign
**Model: OPUS**

```
Redesign HITLPanel.tsx completely. This is the emotional peak 
of the demo. Non-technical judges must understand it instantly.

Remove the current sidebar panel. Replace with a slide-up
panel from the bottom of the screen (full width, ~280px tall).

LAYOUT:
┌─────────────────────────────────────────────────────────────────┐
│  ⚠ MANEUVER AUTHORIZATION REQUIRED          ⏱ 29s              │
├─────────────────────────────┬───────────────────────────────────┤
│  SATELLITE: DEMO-SAT-A      │  BEFORE MANEUVER    AFTER         │
│  OPERATOR:  Demo Corp A     │  ┌──────────────┐  ┌──────────┐  │
│  BURN: 0.087 m/s prograde   │  │ Pc: 1.2×10⁻³ │  │ 3.1×10⁻⁷│  │
│  TIMING: 60 min before TCA  │  │ 1 in 833     │  │ 1 in 3M  │  │
│  IMPACT: LOW                │  │ ████████░░   │  │ █░░░░░░  │  │
│                             │  │    🔴 RISK   │  │  🟢 SAFE │  │
│                             │  └──────────────┘  └──────────┘  │
├─────────────────────────────┴───────────────────────────────────┤
│  ████████████████████████████░░░░░░░░  (countdown bar)          │
│                                                                  │
│         [  ✓  APPROVE MANEUVER  ]      [  ✗  VETO  ]           │
└─────────────────────────────────────────────────────────────────┘

Implementation:

Position: fixed bottom-0 left-0 right-0
Animation: translate-y-full → translate-y-0 on mount (300ms ease-out)
Background: #0f172a with red border-top (4px solid #ef4444)

The Pc values MUST come from the WebSocket hitl_request payload.
Do not hardcode them. Use:
  proposal.post_maneuver_pc for AFTER
  The conjunction event's pc field for BEFORE

"1 in 833" is computed as: Math.round(1 / pc).toLocaleString()
"1 in 3M" is computed as: Math.round(1 / post_pc).toLocaleString()

Risk bar: width = Math.min(pc / 0.01, 1) * 100 + "%"
  Full bar = red. Small bar = green.

Countdown timer:
  Start from timeout_seconds in payload (30s)
  Count down every second
  Bar fills right-to-left
  Color: green → yellow (< 15s) → red (< 5s)
  At 0: auto-veto (call POST /api/hitl/{event_id}/veto)

APPROVE button:
  Large (px-12 py-4), bright green (#22c55e)
  Subtle glow: box-shadow: 0 0 20px rgba(34,197,94,0.5)
  Pulsing animation on the glow (2s sine wave)
  On click: POST /api/hitl/{event_id}/approve
           → panel slides back down
           → trigger streaming math panel (Prompt 5)

VETO button:
  Smaller, red, no glow
  On click: POST /api/hitl/{event_id}/veto → panel slides down

The phrase "1 in 833 chance of collision" is the ONLY number
that matters to a non-technical judge. Make it big.
"1 in 3,200,000 after maneuver" makes them cheer.
Put both in large font (text-2xl at minimum).
```

---

## PROMPT 5 — Streaming Math Panel (Real Computation, Not Animation)
**Model: OPUS**

```
After APPROVE is clicked, show a "computation stream" for 3-4 seconds
before the maneuver_executed event fires. This must show REAL values.

BACKEND CHANGES:

In backend/orbital/conjunction.py, modify compute_minimum_delta_v
to return a computation trace alongside the result:

Add trace: list[dict] to ManeuverOutput dataclass:
  @dataclass
  class ManeuverOutput:
    delta_v_ms: float
    burn_direction: str
    burn_time: datetime
    post_maneuver_pc: float
    post_maneuver_miss_km: float
    trace: list[dict]  # NEW

Build the trace inside compute_minimum_delta_v:
  trace = []
  
  # After getting burn_time and tau:
  trace.append({"t": 0, "text": f"Burn time: {burn_time.strftime('%Y-%m-%dT%H:%M:%S')} UTC", "value": f"τ = {tau:.0f}s"})
  
  # After computing n:
  trace.append({"t": 1, "text": "Mean motion (from TLE)", "value": f"n = {n:.6f} rad/s"})
  
  # CW coefficients:
  cy = (4*np.sin(n*tau) - 3*n*tau) / n
  cx = 2*(1 - np.cos(n*tau)) / n
  trace.append({"t": 2, "text": "CW along-track coefficient", "value": f"Cy = {cy:.1f} km/(km/s)"})
  trace.append({"t": 3, "text": "CW radial coefficient", "value": f"Cx = {cx:.1f} km/(km/s)"})
  
  # Each binary search iteration (show first 8, then skip to final):
  iteration = 0
  # Inside the binary search loop:
  if iteration < 8 or abs(dv_max - dv_min) < 0.0001:
    new_miss, pc_mid = new_miss_and_pc(dv_mid)
    trace.append({
      "t": 4 + iteration,
      "text": f"Binary search [{iteration+1}]",
      "value": f"ΔV={dv_mid*1000:.4f} m/s → Pc={pc_mid:.2e} {'✓' if pc_mid <= target_pc else '✗'}"
    })
  iteration += 1
  
  # Final result:
  trace.append({"t": 15, "text": "CONVERGED", "value": f"ΔV = {best_dv*1000:.3f} m/s ({burn_direction})"})
  trace.append({"t": 16, "text": "Post-maneuver Pc", "value": f"{final_pc:.2e} — SAFE ✓"})
  trace.append({"t": 17, "text": "Post-maneuver miss distance", "value": f"{final_miss:.3f} km"})

In maneuver_executor.py, include trace in WebSocket event:
  state["websocket_events"].append({
    "type": "maneuver_executed",
    "payload": {
      ...existing fields...,
      "computation_trace": result.trace  # include the real trace
    }
  })

FRONTEND CHANGES:

Create frontend/src/components/MathPanel/MathPanel.tsx:

Shows when APPROVE is clicked (before maneuver_executed arrives).
Positioned: center screen overlay, dark background.
Disappears when maneuver_executed fires.

The computation_trace from the WebSocket payload is an array.
When the panel mounts, reveal each item sequentially:
  - Every 120ms, show the next item
  - Each item fades in (opacity 0 → 1, 80ms transition)
  - Do NOT pre-load all items — only show what "has arrived"

Display format (monospace font, terminal green #22c55e on black):
  ┌──────────────────────────────────────────────────┐
  │  ⚙ ORBITAL MECHANICS ENGINE                      │
  │  ─────────────────────────────────────────────   │
  │  Burn time: 2026-06-13T18:42:00 UTC    τ = 3600s │
  │  Mean motion (from TLE)           n = 0.001097   │
  │  CW along-track coefficient       Cy = -13450.2  │
  │  CW radial coefficient            Cx = 3160.1    │
  │  Binary search [1]    ΔV=2.0000 m/s → Pc=3.2e-17 ✓│
  │  Binary search [2]    ΔV=1.0000 m/s → Pc=2.1e-09 ✓│
  │  Binary search [3]    ΔV=0.5000 m/s → Pc=1.1e-06 ✓│
  │  Binary search [4]    ΔV=0.2500 m/s → Pc=8.4e-05 ✗│
  │  Binary search [5]    ΔV=0.3750 m/s → Pc=6.3e-06 ✓│
  │  ...                                              │
  │  ─────────────────────────────────────────────   │
  │  CONVERGED                    ΔV = 0.087 m/s     │
  │  Post-maneuver Pc             3.1×10⁻⁷ — SAFE ✓  │
  │  Post-maneuver miss distance  1.412 km            │
  └──────────────────────────────────────────────────┘

Each line renders with a blinking cursor at the end while
the next item is loading (│ character, 500ms blink).
After all items render: cursor disappears, green checkmark.
After 1 second: panel fades out.

This is NOT gimmicky because:
- trace values are computed by real CW binary search
- The ΔV that appears here matches exactly what's in the HITL panel
- Judges see the algorithm working, not a fake animation

DO NOT add artificial delays beyond the 120ms per item.
The values must come from the backend computation_trace field.
```

---

## PROMPT 6 — Verify All Metrics Use Real Math
**Model: SONNET**

```
Audit every metric displayed in MetricsBar and verify it uses
real computed values from the database or live computation.
Fix any that don't.

Check backend/api/routes.py GET /api/metrics:

REQUIRED real implementation:

async def get_metrics():
  async with aiosqlite.connect(settings.SQLITE_PATH) as db:
    # Active satellites: count from DB
    async with db.execute("SELECT COUNT(*) FROM satellites") as c:
      active_sats = (await c.fetchone())[0]
    
    # Total conjunctions detected ever
    async with db.execute("SELECT COUNT(*) FROM conjunctions") as c:
      total_conjunctions = (await c.fetchone())[0]
    
    # Resolved conjunctions
    async with db.execute(
      "SELECT COUNT(*) FROM conjunctions WHERE status='resolved'"
    ) as c:
      resolved = (await c.fetchone())[0]
    
    # Maneuvers executed (proposals that were winning + approved)
    async with db.execute(
      "SELECT COUNT(*) FROM proposals WHERE bid_score = (
        SELECT MIN(bid_score) FROM proposals p2 
        WHERE p2.event_id = proposals.event_id
      )"
    ) as c:
      maneuvers = (await c.fetchone())[0]
    
    # Total delta-V: SUM of all winning proposal delta_v_ms values
    # This is REAL: sum of actual computed CW maneuver costs
    async with db.execute("""
      SELECT COALESCE(SUM(p.delta_v_ms), 0) 
      FROM proposals p
      INNER JOIN conjunctions c ON p.event_id = c.event_id
      WHERE c.status = 'resolved'
      AND p.bid_score = (
        SELECT MIN(bid_score) FROM proposals p2 
        WHERE p2.event_id = p.event_id
      )
    """) as c:
      total_dv_ms = (await c.fetchone())[0]
    
    return {
      "active_satellites": active_sats,
      "conjunctions_detected": total_conjunctions,
      "resolved": resolved,
      "maneuvers_executed": maneuvers,
      "total_delta_v_ms": round(total_dv_ms, 3),
      "system_status": "ACTIVE"
    }

In MetricsBar.tsx, display total_delta_v_ms as:
  {(metrics.total_delta_v_ms / 1000).toFixed(3)} m/s
  (it's stored in ms, display in m/s)

Also broadcast metrics_update via WebSocket every 5 seconds:
  In main.py background task, after satellite broadcast:
  metrics = await get_metrics_data()
  await manager.broadcast({"type": "metrics_update", "payload": metrics})

Verify in browser console that metrics numbers change correctly
after running demo injection and approving the maneuver.
Show me the actual SQL query results as console.log output.
```

---

## PROMPT 7 — Hover Tooltips
**Model: SONNET**

```
Create a reusable Tooltip component and apply it to every 
technical term in the UI. This helps non-technical judges.

Create frontend/src/components/Tooltip.tsx:

  interface TooltipProps {
    text: string
    children: React.ReactNode
    position?: 'top' | 'bottom'
  }
  
  function Tooltip({ text, children, position = 'top' }: TooltipProps) {
    const [visible, setVisible] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout>>()
    
    return (
      <span 
        className="relative inline-block cursor-help"
        onMouseEnter={() => {
          timerRef.current = setTimeout(() => setVisible(true), 300)
        }}
        onMouseLeave={() => {
          clearTimeout(timerRef.current)
          setVisible(false)
        }}
      >
        {children}
        {visible && (
          <div className={`
            absolute z-50 w-64 p-2 text-xs text-white rounded-lg shadow-lg
            bg-gray-900 border border-gray-600
            ${position === 'top' ? 'bottom-full mb-2 left-1/2 -translate-x-1/2' 
                                 : 'top-full mt-2 left-1/2 -translate-x-1/2'}
          `}>
            {text}
            <div className={`
              absolute left-1/2 -translate-x-1/2 w-2 h-2 
              bg-gray-900 border-gray-600 rotate-45
              ${position === 'top' ? 'top-full border-r border-b -translate-y-1' 
                                   : 'bottom-full border-l border-t translate-y-1'}
            `} />
          </div>
        )}
      </span>
    )
  }

Apply these tooltips across the UI:

MetricsBar.tsx:
  <Tooltip text="Real Starlink satellites tracked from CelesTrak's live orbital database. Updated every hour.">
    <span>Active Satellites</span>
  </Tooltip>
  
  <Tooltip text="Predicted close approaches where collision probability exceeds 1 in 10,000 — the industry standard alert threshold.">
    <span>Conjunctions</span>
  </Tooltip>
  
  <Tooltip text="Conjunctions successfully resolved through autonomous agent negotiation and human approval.">
    <span>Resolved</span>
  </Tooltip>
  
  <Tooltip text="Total fuel burned across all maneuvers. 0.1 m/s ≈ the speed of a slow walk — a tiny nudge that prevents catastrophic collision.">
    <span>Total ΔV</span>
  </Tooltip>

HITLPanel.tsx:
  <Tooltip text="Probability of Collision — how likely a physical impact is at closest approach. Industry alert threshold: 1 in 10,000 (1×10⁻⁴). We target below 1 in 1,000,000.">
    <span>Pc</span>
  </Tooltip>
  
  <Tooltip text="Delta-V: the velocity change produced by a thruster burn. Computed using Clohessy-Wiltshire relative motion equations.">
    <span>ΔV</span>
  </Tooltip>
  
  <Tooltip text="Along the direction of orbital travel. Most fuel-efficient for changing arrival time at the conjunction point.">
    <span>prograde</span>
  </Tooltip>
  
  <Tooltip text="Human-In-The-Loop: every maneuver requires explicit human approval before execution. No AI acts without oversight.">
    <span>HITL</span>
  </Tooltip>

EventFeed items — add badge tooltips:
  DETECTOR → "Orbital conjunction detection agent using SGP4 propagation and TCA optimization"
  COORDINATOR → "Contract-Net Protocol negotiation coordinator — manages bid collection and winner selection"
  OPERATOR → "Operator agent — computes minimum delta-V bid using Clohessy-Wiltshire equations"
  EXECUTOR → "Maneuver execution agent — applies approved burn and updates orbital state"
  HITL → "Human-In-The-Loop gate — final approval required before any satellite maneuver"

Show me the final Tooltip component and one example of each application.
```

---

## PROMPT 8 — Post-Maneuver Orbit Visual
**Model: SONNET**

```
After maneuver_executed fires, the winning satellite's orbit trail
must visibly change direction on the globe. This is the resolution moment.

The SGP4 propagator cannot directly apply thrust, so we use this approach:
After maneuver, the satellite's lat/lon trajectory will slightly shift
because we slightly modify its mean motion in the state.

In backend/agents/nodes/maneuver_executor.py:
After executing the maneuver, update the satellite's stored TLE epoch
to simulate the orbital change:

  # Get the winning satellite from DB
  sat = await get_satellite(winning_proposal['satellite_name'])
  
  # Apply small mean motion perturbation
  # delta_v_ms = maneuver in m/s, orbital velocity ~7600 m/s
  # dV/V changes the period, shifting the ground track
  dv_ratio = winning_proposal['delta_v_ms'] / 7600.0  # fraction
  
  # Store a "maneuver offset" that gets applied during propagation
  # This is the lat/lon drift applied to this satellite's future positions
  await update_satellite_maneuver_offset(
    sat['norad_id'],
    lon_offset_rate = dv_ratio * 0.1,  # degrees per update cycle
    applied_at = datetime.utcnow()
  )

In the satellite broadcast, for satellites with maneuver_offset:
  if sat.get('maneuver_offset') and sat.get('offset_applied_at'):
    elapsed = (datetime.utcnow() - offset_applied_at).total_seconds()
    # Only apply for 60 seconds after maneuver
    if elapsed < 60:
      lon += lon_offset_rate * elapsed
      # This shifts the satellite slightly in longitude,
      # making the orbit trail appear to curve differently

In SatelliteLayer.tsx, maintain orbit_trails: Map<string, Vector3[]>
  When satellite_update fires:
    For each satellite, push current position to its trail array
    Keep last 40 positions
  
  When maneuver_executed fires:
    Clear the trail for the maneuvered satellite (store.clearTrail(name))
    This forces trail to rebuild from new trajectory
  
  Render orbit trails:
    For each satellite with trail.length > 2:
      Draw a line through all trail points
      Opacity fades from 0.8 (current) to 0 (oldest)
      Color: same as satellite dot color
      Width: 1px

For the resolution visual:
  When maneuver_executed fires:
  1. Both satellites change color to green (#22c55e)
  2. Conjunction zone (red pulse sphere) fades out over 1 second
  3. Connection line between satellites turns green then fades over 2 seconds
  4. HTML overlay appears over the globe for 3 seconds:
       <div style="fontSize: 2rem, color: #22c55e, fontWeight: bold">
         ✓ CONJUNCTION RESOLVED
       </div>
     Positioned at globe center, then fades out
  5. Camera lerps back to default view (position [0,0,4]) over 3 seconds

Show me the changes to SatelliteLayer.tsx and maneuver_executor.py.
```

---

## PROMPT 9 — Landing Page
**Model: GEMINI (use gemini-1.5-pro — save Claude quota)**

```
Create frontend/src/pages/Landing.tsx — a cinematic landing page
that loads at / (use React Router, /dashboard goes to main app).

DESIGN: Dark space theme. Professional. Not a hackathon project, 
a real product page.

Colors: #0a0f1e background, white text, #ef4444 red accent, 
#4fc3f7 blue accent.

SECTIONS:

[HERO — full viewport height]
  Background: CSS animated starfield
    200 divs, absolute positioned, random top/left,
    animation: twinkle 3s infinite alternate, random delays
    1-2px white dots
  
  Center content:
    SpaceATC  (text-7xl font-bold white, letter-spacing tight)
    "The coordination layer space was missing."  (text-xl gray-400, mt-4)
    
  Stats row (bottom of hero, fade in after 1s):
    [43,000+]          [144,000]           [$11.1B]
    Objects in LEO     Maneuvers/Year      At risk annually
    (numbers count up from 0 on load, using useEffect + setInterval)
  
  Scroll arrow (bottom center, bounce animation):
    ↓

[SECTION 2 — The Gap]
  Two column layout:
  
  LEFT: Timeline diagram
    [SpaceX Stargaze — Jan 2026]
         ↓
    "CDM sent to both operators simultaneously"
         ↓
    [Operator A ?]    [Operator B ?]
    "Who moves? Nobody decides."
  
  RIGHT: 
    "SpaceX Stargaze tells you two satellites are going to collide.
     
     It does NOT tell you:
     • Who maneuvers
     • By how much  
     • By when"
    
    Quote (blockquote styling):
    "If the reaction required human approval, such an event 
     might not have been successfully mitigated."
    — SpaceX Stargaze announcement, Jan 29, 2026

[SECTION 3 — The Solution]
  4-step horizontal flow:
  
  [DETECT]        [NEGOTIATE]      [PROPOSE]       [APPROVE]
  Real TLE data   Two AI agents    Lowest-cost     Human reviews
  from CelesTrak  bid on who       bid selected    and confirms
                  maneuvers        automatically   
  
  Each step: icon + title + subtitle
  Connected by arrows →
  Step highlight animates left to right on scroll (IntersectionObserver)

[SECTION 4 — Numbers]
  Three big stats:
  
  "0.087 m/s"          "1.2×10⁻³ → 3.1×10⁻⁷"    "< 60 seconds"
  Fuel used to         Collision probability       From detection
  resolve a collision  before and after            to resolution

[SECTION 5 — CTA]
  Full viewport height, centered:
  
  "See it resolve a conjunction live."
  
  [Launch SpaceATC →]  (large button, red, rounded-full, px-12 py-5)
  onClick: navigate('/dashboard')
  
  Small text below: "Using real Starlink TLE data · No login required"

Add React Router to App.tsx:
  import { BrowserRouter, Routes, Route } from 'react-router-dom'
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/dashboard" element={<Dashboard />} />
    </Routes>
  </BrowserRouter>

(Dashboard = existing App.tsx content, just rename the component)

Install: npm install react-router-dom
```

---

## PROMPT 10 — Universe Bug Prompt (Run This Last)
**Model: OPUS — Run after everything else is implemented**

```
Perform a complete end-to-end audit of SpaceATC.
Find and fix EVERY bug, integration issue, and edge case.
This is the final check before submission.

READ EVERY FILE before starting. Check these in order:

═══════════════════════════════════════════════════════
BACKEND AUDIT
═══════════════════════════════════════════════════════

1. STARTUP
   Run: uvicorn main:app --reload --port 8000
   Verify: zero errors in terminal output
   Check: init_db() called, TLEs fetched, background tasks started
   
   Common failures:
   - circular imports between agents/ modules
   - aiosqlite not initialized before first request
   - CelesTrak timeout crashing startup (need try/except with fallback)
   
   Fix: startup must not crash. Wrap CelesTrak fetch in:
     try:
       tles = await fetch_tle_group(CELESTRAK_STARLINK_TLE)
     except Exception as e:
       logger.warning(f"CelesTrak failed: {e}. Using empty satellite list.")
       tles = []

2. API ENDPOINTS
   Test every endpoint with curl:
   
   curl http://localhost:8000/health
   → must return: {"status": "ok", "satellites": N, "timestamp": "..."}
   
   curl http://localhost:8000/api/satellites
   → must return: list with >= 50 items, each having norad_id, name, 
     lat, lon, alt_km, operator, position {x,y,z}
   
   curl http://localhost:8000/api/conjunctions
   → must return: list (empty is fine before injection)
   
   curl http://localhost:8000/api/metrics
   → must return: active_satellites, conjunctions_detected, resolved,
     maneuvers_executed, total_delta_v_ms, system_status
   
   curl -X POST http://localhost:8000/api/demo/inject
   → must return: {"status": "injected", "event_id": "..."}
   → terminal must show agent pipeline starting
   
   curl -X GET http://localhost:8000/api/sim/speed
   → must return: {"speed": 60.0, "sim_time": "..."}
   
   Fix every endpoint that fails.

3. AGENT PIPELINE
   After POST /api/demo/inject, within 30 seconds verify in terminal:
   
   ✓ [ingest_tle] node executed
   ✓ [detect_conjunctions] node executed — pc > 1e-4
   ✓ [coordinate_negotiation] node executed
   ✓ [generate_operator_bid] node executed — two proposals created
   ✓ [await_hitl] node interrupted — waiting for human
   
   Common failures:
   - LangGraph interrupt() not working (check langgraph version >= 0.2)
   - agent state not carrying websocket_events between nodes
   - asyncio event loop issues with SQLite checkpointer
   
   Fix: if LangGraph interrupt() causes issues, implement HITL as:
     while state.get("hitl_decision") is None:
       await asyncio.sleep(0.5)
       # Check DB for decision
       decision = await get_hitl_decision(event_id)
       if decision:
         state["hitl_decision"] = decision

4. WEBSOCKET
   Open browser devtools → Network → WS → ws://localhost:8000/ws
   
   Verify messages arrive:
   ✓ satellite_update every 5 seconds with satellites list
   ✓ system_status after injection
   ✓ conjunction_detected after injection
   ✓ negotiation_update x3 (bids_requested, bids_received, winner_selected)
   ✓ hitl_request with full proposal
   ✓ maneuver_executed after approve
   ✓ metrics_update
   
   Common failures:
   - websocket_events not being drained from agent state
   - broadcast_queue not connected to manager.broadcast()
   - disconnect handling causing crash on page refresh
   
   Fix: wrap all broadcast calls:
     try:
       await manager.broadcast(message)
     except Exception:
       pass  # client disconnected, ignore

5. HITL RESUME
   After hitl_request fires:
   curl -X POST http://localhost:8000/api/hitl/{event_id}/approve
   
   Verify:
   ✓ LangGraph graph resumes from interrupt
   ✓ maneuver_executor node runs
   ✓ conjunction status updated to 'resolved' in DB
   ✓ maneuver_executed WS message fires with computation_trace

6. DEMO RESET
   curl -X POST http://localhost:8000/api/demo/reset
   curl -X POST http://localhost:8000/api/demo/inject
   
   Must work IDENTICALLY to first injection.
   Common failure: graph session_id conflict on second run.
   Fix: generate new UUID for session_id each injection.

═══════════════════════════════════════════════════════
FRONTEND AUDIT
═══════════════════════════════════════════════════════

7. GLOBE
   Open http://localhost:5173/dashboard
   
   Verify visually:
   ✓ Dark background (#0a0f1e)
   ✓ Earth sphere visible and slowly rotating
   ✓ Starfield visible (white dots in background)
   ✓ Satellite dots visible (>50 colored dots on globe)
   ✓ Dots update position every 5 seconds (check visually)
   ✓ Orbit controls work (click+drag to rotate, scroll to zoom)
   
   Common failures:
   - Canvas has no height (set h-full on parent div)
   - ECI coords return NaN (check satellite.js gstime call)
   - InstancedMesh count mismatch (use Math.max(satellites.length, 500))

8. DEMO FLOW
   Click INJECT CONJUNCTION button.
   
   Within 30 seconds verify visually:
   ✓ Two white satellites appear, turn yellow/pulsing
   ✓ Red pulsing sphere appears between them
   ✓ Distance label shows km countdown
   ✓ Camera auto-zooms to conjunction region
   ✓ Event feed shows human-readable messages
   ✓ "1 in 833" Pc displayed in event feed
   ✓ HITL panel slides up from bottom
   ✓ Countdown timer ticking
   ✓ Math panel appears after clicking APPROVE
   ✓ Math streams line by line (real binary search values)
   ✓ Panel fades out
   ✓ Satellites turn green
   ✓ "CONJUNCTION RESOLVED" text appears on globe
   ✓ MetricsBar: Resolved: 1, ΔV changes

9. TIME WARP
   ✓ Speed buttons visible (1× 10× 60× 300×)
   ✓ Default is 60× 
   ✓ Sim clock visible and updating
   ✓ At 60×: satellite dots visibly moving
   ✓ Speed change works without time jump

10. TOOLTIPS
    Hover over every technical term:
    ✓ "Pc" → explains collision probability
    ✓ "ΔV" → explains delta-V
    ✓ "Active Satellites" → explains CelesTrak source
    ✓ Badge labels → explain each agent

11. LANDING PAGE (/)
    ✓ Loads at localhost:5173/
    ✓ Starfield animating
    ✓ Stats count up on load
    ✓ "Launch SpaceATC →" navigates to /dashboard
    ✓ No 404 errors

═══════════════════════════════════════════════════════
PERFORMANCE AUDIT
═══════════════════════════════════════════════════════

12. FRAME RATE
    Open browser devtools → Performance → Record 10 seconds
    Target: 55+ FPS consistently
    
    If below 30 FPS:
    - Reduce satellite count to 100 max
    - Check InstancedMesh is being used (not individual meshes)
    - Check useFrame hook is not doing heavy computation
    - Move satellite position calculation outside useFrame (useMemo)

13. MEMORY LEAKS
    After running demo 3 times without page refresh:
    - DevTools → Memory → Take heap snapshot
    - Should not grow >50MB per run
    - Common leak: WebSocket event listeners not cleaned up
    Fix: return cleanup function from useEffect in useWebSocket.ts

═══════════════════════════════════════════════════════
FINAL DEMO RUN
═══════════════════════════════════════════════════════

14. Run the complete 45-second demo script from PRD.md Section 12
    EXACTLY as written. Time it.
    
    If any step fails, fix it immediately.
    Run it 3 times in a row. It must work all 3 times.
    
    After third successful run:
    → Take screenshots at each major moment
    → Start screen recording
    → Run it a fourth time on camera
    → This is your video submission

═══════════════════════════════════════════════════════
OUTPUT REQUIRED
═══════════════════════════════════════════════════════

Show me:
1. List of every bug found with file + line number
2. List of every fix applied
3. Final terminal output of uvicorn startup (no errors)
4. Final browser console screenshot (no red errors)
5. Confirmation that 3 consecutive demo runs succeeded
```

---

## MODEL ASSIGNMENT SUMMARY

| Prompt | Task | Model |
|---|---|---|
| 1 | Satellite dots + orbit trails + conjunction visual | **OPUS** |
| 2 | Time warp simulation speed | **SONNET** |
| 3 | Human-readable event feed | **SONNET** |
| 4 | HITL panel redesign | **OPUS** |
| 5 | Streaming math panel | **OPUS** |
| 6 | Metrics real math verification | **SONNET** |
| 7 | Hover tooltips | **SONNET** |
| 8 | Post-maneuver orbit visual | **SONNET** |
| 9 | Landing page | **GEMINI** |
| 10 | Universe bug prompt | **OPUS** |

**OPUS usage:** Prompts 1, 4, 5, 10 (4 Opus calls — use them wisely)
**SONNET usage:** Prompts 2, 3, 6, 7, 8 (lighter tasks)
**GEMINI usage:** Prompt 9 (landing page)

---

## TIME SCALE REFERENCE (for judges if asked)

At 60× simulation speed (default):
- 1 real second = 1 orbital minute  
- One full orbit (90 min) = 90 real seconds
- Demo conjunction at T+120s real = visible in 2s at 60×
- Scale shown in UI: "60× · 1 sec = 1 orbital minute"

At 1× (real time): satellites barely move. Demo impossible.
At 60×: satellites visibly orbit. Demo compelling.
At 600×: satellites move fast. One orbit in 9 seconds.

---

*SpaceATC | ClauseZero | FAR AWAY 2026 | Deadline: June 14 11:59 PM IST*
