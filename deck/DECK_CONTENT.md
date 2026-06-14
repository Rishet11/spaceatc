# SpaceATC — Deck Content & Design Guide

> **For:** Nilay (deck builder) + anyone generating visuals
> **Slides:** 11 total (9 content + title + team)
> **Tool:** Google Slides, Canva, or Figma — pick one, stay consistent
> **Aspect Ratio:** 16:9
>
> This file has EVERYTHING needed to build every slide:
> - Exact on-slide text (copy-paste ready)
> - Design / layout direction
> - Image generation prompts (for Midjourney, DALL-E, Gemini, etc.)
> - Speaker notes (what the presenter SAYS, not what's on the slide)

---

## 🎨 Global Design System

Use these consistently across ALL slides:

### Color Palette
```
Background (primary):    #0B0F1A  (deep space navy, almost black)
Background (alt):        #111827  (slightly lighter navy for cards)
Accent 1 (safe/success): #00E676  (bright green — used for "AFTER" states, approvals)
Accent 2 (danger/alert): #FF1744  (bright red — used for "BEFORE" states, conjunctions)
Accent 3 (highlight):    #448AFF  (electric blue — used for headings, links, UI accents)
Accent 4 (warning):      #FFAB00  (amber — used for "negotiating" state)
Text (primary):          #FFFFFF
Text (secondary):        #94A3B8  (muted blue-gray)
Card/panel bg:           #1E293B  (dark slate for cards/panels)
```

### Typography
```
Headings:    Inter Bold or Space Grotesk Bold (modern, techy)
Subheadings: Inter SemiBold
Body:        Inter Regular
Numbers:     Space Mono or JetBrains Mono (monospace for data/metrics)
```

### General Rules
- Max 6 lines of text per slide — if you have more, you have too much
- Numbers should be BIG (48pt+) — they're more convincing than words
- Use the dark background everywhere — it looks premium and space-themed
- No clip art. No stock photos of "businesspeople shaking hands"
- Subtle star field or grid pattern on backgrounds (very faint, 5-10% opacity)

---

## Slide 1 — Title

### On-Slide Text
```
[top-left, small, uppercase, letter-spaced, #448AFF]
FAR AWAY 2026  ·  TEAM CLAUSEZERO

[center, large, bold, white]
SpaceATC

[center, medium, #94A3B8]
Autonomous Satellite Collision Negotiation & Evasion

[bottom, small, #94A3B8]
Tracks: Space & Aerospace  ·  Agentic & Autonomous Systems
```

### Layout
- Center-aligned title with a subtle 3D globe visual behind it (50% opacity)
- The globe should have faint orbital lines/arcs on it
- SpaceATC logo if you have one, otherwise just the text in Space Grotesk Bold

### 🖼️ Image Generation Prompt
```
A dark, cinematic 3D render of Earth from low orbit, deep navy/black 
background with subtle stars. Thin glowing orbital paths (electric blue 
and white) arc around the globe. A few tiny bright dots (satellites) 
visible along the paths. No text. No UI elements. Photorealistic, 
high contrast, suitable as a presentation background at 50% opacity. 
16:9 aspect ratio.
```

### Speaker Notes
> "We're Team ClauseZero. We built SpaceATC — an autonomous system that negotiates satellite collision avoidance between competing operators, and gives satellites the reflex to dodge debris nobody tracks."

---

## Slide 2 — The Problem

### On-Slide Text
```
[top, small, uppercase, letter-spaced, #FF1744]
THE PROBLEM

[heading, bold, white]
Space is getting dangerously crowded.
And nobody is coordinating.

[two-column layout below]

LEFT COLUMN — card with red border/accent
┌─────────────────────────────────┐
│  THE PREDICTABLE THREAT         │
│                                  │
│  28,000 tracked objects          │
│  Alerts exist. No coordination.  │
│                                  │
│  144,000 maneuvers in 5 months  │
│  (Starlink, 2024–25)            │
└─────────────────────────────────┘

RIGHT COLUMN — card with red border/accent
┌─────────────────────────────────┐
│  THE INVISIBLE THREAT            │
│                                  │
│  1.2 million untracked fragments │
│  No TLE. No CDM. No warning.    │
│                                  │
│  Completely invisible to every   │
│  ground system on Earth          │
└─────────────────────────────────┘

[bottom, single line, white]
SpaceX's Stargaze (Jan 2026) tells operators "you will collide."
It does NOT tell them who moves, how much, or when.
```

### Layout
- Dark background with very subtle debris particles floating (almost like dust)
- Two side-by-side cards (dark slate bg, red top border)
- Numbers should be in large monospace font
- The Stargaze line at the bottom should be in a slightly different style (italic or quoted)

### 🖼️ Image Generation Prompt
```
Split-screen infographic concept on dark navy background. Left side: 
a network of tracked satellites with thin white orbital lines and 
warning triangle icons. Right side: a chaotic cloud of tiny debris 
fragments, some barely visible, with a single satellite in the path. 
The contrast between "ordered but uncoordinated" (left) and "invisible 
chaos" (right). Minimal, clean, data-visualization style. No text. 
16:9 aspect ratio.
```

### Speaker Notes
> "There are two problems here, not one. The first: 28,000 tracked objects generate collision alerts, but there's no protocol for who moves. Two operators get the same warning and independently decide what to do. Starlink alone executed 144,000 avoidance maneuvers in 5 months — one every 90 seconds."
>
> "The second problem is worse: 1.2 million debris fragments are too small for radar, too large to be harmless, and completely invisible to every ground-based system. No TLE exists for them. No CDM is ever generated."
>
> "SpaceX launched Stargaze in January 2026. It's incredible — 30 million observations a day. But it tells two operators 'you will collide.' It does NOT tell them who moves, by how much, or when. That handoff — that gap — is what we built SpaceATC to fill."

---

## Slide 3 — Our Solution

### On-Slide Text
```
[top, small, uppercase, letter-spaced, #00E676]
OUR SOLUTION

[heading, bold, white]
SpaceATC: Two layers of autonomous protection

[two-column layout]

LEFT — card with blue top accent (#448AFF)
┌─────────────────────────────────────┐
│  LAYER 1 — GROUND NEGOTIATION       │
│  For threats we can see coming      │
│                                      │
│  • Multi-agent bidding system        │
│  • Two operators bid on who moves    │
│  • Lowest cost wins                  │
│  • Human approves before execution   │
│  • < 60 seconds (vs ~45 min manual)  │
│                                      │
│  🟢  LIVE DEMO — Real CelesTrak data │
└─────────────────────────────────────┘

RIGHT — card with blue top accent (#448AFF)
┌─────────────────────────────────────┐
│  LAYER 2 — ORBITMIND REFLEX         │
│  For threats nobody tracks           │
│                                      │
│  • Camera-based CNN pose estimation  │
│  • Small LLM decides dodge strategy  │
│  • Validated JSON command output     │
│  • Classical safety check            │
│  • < 200ms, zero ground contact      │
│                                      │
│  🟡  SIMULATED — SPEED+ imagery     │
└─────────────────────────────────────┘

[bottom, centered, italic, #94A3B8, larger font]
"Coordination for what we can predict. Autonomy for what we can't."
```

### Layout
- Two equal-width cards on dark background
- Each card has a subtle glow effect (blue) on the top border
- The bottom tagline should stand out — maybe slightly larger, italic

### 🖼️ Image Generation Prompt
*(No image needed — this slide is purely typographic/card-based. Focus on clean layout.)*

### Speaker Notes
> "SpaceATC has two layers. Layer 1 is the ground negotiation system — when two tracked satellites are on a collision course, two AI operator agents each compute the minimum fuel cost to dodge, submit bids to a coordinator, and the lowest-cost option is presented to a human for approval. This runs in under 60 seconds on real CelesTrak satellite data. You'll see this live."
>
> "Layer 2 is the Reflex Layer — for the 1.2 million objects nobody tracks. A camera on the satellite detects debris, a CNN estimates its exact position and tumble rate, and a small onboard LLM decides how to dodge, outputting a validated JSON command. All under 200 milliseconds, no ground contact needed. This part is simulated for the demo using the SPEED+ benchmark dataset."
>
> "Together: coordination for what we can predict, autonomy for what we can't."

---

## Slide 4 — How It Works

### On-Slide Text
```
[top, small, uppercase, letter-spaced, #448AFF]
HOW IT WORKS

[LEFT HALF — Layer 1 horizontal flow]
LAYER 1 — GROUND NEGOTIATION

[flow diagram with arrows, left to right]
CelesTrak TLE Data
    → SGP4 Propagation
    → ⚠️ Conjunction Detected
    → 🤖 Agent A Bids  |  🤖 Agent B Bids
    → 🏆 Winner Selected (lowest cost)
    → 👤 Human Approves
    → ✅ Maneuver Executed

[RIGHT HALF or BELOW — Layer 2 horizontal flow]  
LAYER 2 — ORBITMIND REFLEX

[flow diagram with arrows, left to right]
📷 Camera Frame
    → YOLO + MobileNetV3 (30ms)
    → 6DOF Pose via solvePnP
    → 🧠 LLM + Mission Playbook (150ms)
    → {"intent": "EVADE", "axis": "Y", "delta_v_cm_s": 12}
    → ✅ Safety Check → Dodge

[bottom note, small, #94A3B8]
AI does judgment only. All physics is deterministic. LLM output is schema-validated JSON.
```

### Layout
- This slide should be a VISUAL FLOW DIAGRAM, not bullet text
- Use rounded-rectangle nodes with arrows between them
- Color-code: blue nodes for data/compute, red for alert, amber for negotiation, green for resolution
- The JSON snippet should be displayed in a monospace code-style box

### 🖼️ Image Generation Prompt
*(No AI-generated image needed. Build this as a flow diagram in your slide tool. Use the node colors from the palette.)*

### Design Reference
```
Node style:  Rounded rectangle, #1E293B fill, 1px border in accent color
Arrow style: Thin, white or blue, with small arrowhead
Icon style:  Simple emoji or minimal line icons inside nodes
```

### Speaker Notes
> "Let me walk through both pipelines. Layer 1: we pull real satellite orbital data from CelesTrak, propagate orbits using SGP4, and screen for dangerous close approaches. When one is found, two operator agents — each representing a different satellite — independently compute the minimum delta-V needed to resolve the conjunction. They submit bids. The lowest-cost bid wins. That proposal goes to a human for approval. Only then is the maneuver executed."
>
> "Layer 2: a camera captures a frame. YOLO detects the object, MobileNetV3 regresses 11 structural keypoints, and OpenCV's solvePnP solves the exact 6-degree-of-freedom pose — all in 30 milliseconds. Then a small quantized LLM checks the mission playbook and outputs a structured JSON dodge command. A classical, non-AI safety check validates that the command is physically sane before it's executed."
>
> "The important thing: the AI never generates physics numbers. All the math — sgp4, PnP, optimization — is deterministic. The AI does judgment: interpreting a situation against rules. And its output is grammar-constrained JSON. If it doesn't match the schema, the command is rejected and the system fails safe."

---

## Slide 5 — LIVE DEMO

### On-Slide Text
```
[top, small, uppercase, letter-spaced, #00E676]
LIVE DEMO

[heading, bold, white]
From risk to resolution in 45 seconds.

[horizontal timeline bar with labeled markers]
0:00          0:05          0:10          0:20          0:22          0:25          0:33
Inject        Globe zooms   ⚠️ Conjunction  Bids received  Winner       HITL panel    Approved —
conjunction   to event      detected       from both      selected     appears       resolved ✅
pair                                       agents

[BELOW TIMELINE — two side-by-side result cards]

LEFT CARD — red border
┌────────────────────────────┐
│  BEFORE                     │
│  Conjunction Detected       │
│                              │
│  1.2 × 10⁻³               │  ← BIG, red, monospace
│  Collision Probability       │
│                              │
│  Miss Distance: 0.3 km      │
│  Relative Velocity: 7.2 km/s│
└────────────────────────────┘

→  (arrow between cards)

RIGHT CARD — green border
┌────────────────────────────┐
│  AFTER                      │
│  Safe Orbit Confirmed       │
│                              │
│  3.1 × 10⁻⁷               │  ← BIG, green, monospace
│  Collision Probability       │
│                              │
│  ΔV Used: 0.087 m/s         │
│  Maneuver approved by human  │
│  Pc reduced 3,900×           │
└────────────────────────────┘

[below the cards, small text, #94A3B8]
Act 2: OrbitMind Reflex demo — SPEED+ imagery, CNN overlay, JSON command, auto-dodge animation
```

### Layout
- This matches the design from the image you already created — USE THAT as the base
- Timeline bar at top with colored markers (green for safe steps, red for alert, blue for negotiation)
- Before/After cards are the centerpiece — big Pc numbers in monospace
- Keep the Act 2 reference as a small note — the live demo IS the star

### 🖼️ Image Generation Prompt
*(Use the demo slide image you already have. It's already well-designed. Just ensure it matches the color palette above.)*

### Speaker Notes
> "Let me show you. I'm going to inject a conjunction between two demo satellites right now."
>
> [DO THE DEMO — narrate each step as it happens on screen]
>
> "And that's it. From detection to resolution in under 45 seconds. The collision probability dropped from 1.2 times 10 to the minus 3 to 3.1 times 10 to the minus 7 — a 3,900x reduction — with a delta-V of just 0.087 meters per second. That's a nudge so small you couldn't feel it if you were standing on the satellite."
>
> [THEN SHOW ACT 2 — Reflex Layer demo]
>
> "Now let me show the Reflex Layer. This is simulated using the SPEED+ benchmark dataset..."

---

## Slide 6 — Results

### On-Slide Text
```
[top, small, uppercase, letter-spaced, #00E676]
RESULTS

[heading, bold, white]
The numbers.

[large metrics grid — 2 rows × 3 columns, each in a card]

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  3,900×           │  │  0.087 m/s       │  │  < 60 sec        │
│  Pc reduction     │  │  Delta-V used     │  │  Total pipeline  │
│  (1.2e-3 → 3.1e-7)│  │  (a tiny nudge)   │  │  (vs ~45 min)    │
└──────────────────┘  └──────────────────┘  └──────────────────┘

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  < 200 ms        │  │  0 ground contact │  │  150+ satellites  │
│  Reflex response  │  │  Onboard autonomy │  │  Real CelesTrak  │
│  (Layer 2)        │  │  needed (Layer 2)  │  │  data displayed  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

### Layout
- 6 metric cards in a 3×2 grid
- Each card: dark slate background, single BIG number (48pt+, monospace, white), small label below (14pt, #94A3B8)
- Top row = Layer 1 results, bottom row = Layer 2 results (subtle row labels optional)
- Numbers should dominate — they sell themselves

### 🖼️ Image Generation Prompt
*(No AI image needed. This is a pure data/typography slide. Build in your slide tool.)*

### Speaker Notes
> "Here are the results. Collision probability reduced by 3,900 times. The delta-V cost? 0.087 meters per second — that's less than the drag correction a satellite does every orbit anyway. Total time from detection to approved maneuver: under 60 seconds, replacing a 45-minute manual coordination process."
>
> "For the Reflex Layer: under 200 milliseconds from camera frame to dodge command, with zero ground contact required. And the globe you saw is rendering over 150 real Starlink satellites from live CelesTrak data."

---

## Slide 7 — What We Actually Built

### On-Slide Text
```
[top, small, uppercase, letter-spaced, #448AFF]
ENGINEERING DEPTH

[heading, bold, white]
What we actually built.

[four horizontal cards/rows, each with an icon and text]

🌍 REAL ORBITAL MATH
SGP4 propagation on live CelesTrak TLEs. Conjunction detection with
scipy optimization finding exact Time of Closest Approach. Not mock data.

🤖 GENUINE MULTI-AGENT NEGOTIATION
LangGraph state graph with interrupt/resume for HITL. Two independent operator
agents computing different bids based on fuel state and maneuver history.
Contract-Net Protocol — not a scripted sequence.

🧠 AI THAT ISN'T A WRAPPER
All physics (sgp4, PnP, scipy) is deterministic. LLM does judgment only.
Output is grammar-constrained JSON. Schema mismatch = command rejected = fail safe.

👁️ TWO-STAGE PERCEPTION (OrbitMind Reflex)
YOLO detects → MobileNetV3 regresses 11 keypoints → solvePnP resolves 6DOF pose.
CNN measures. LLM decides. Neither does the other's job.

[bottom, small tech list, monospace, #94A3B8]
sgp4 · LangGraph · FastAPI · React · Three.js · YOLO · MobileNetV3 · 
OpenCV · llama.cpp · FAISS · satellite.js · Zustand · Pydantic
```

### Layout
- Four stacked horizontal cards, each with a subtle left-border accent (alternating blue/green)
- Emoji or simple icon on the left, text on the right
- The tech list at the bottom is small and understated — not the focus
- This slide should feel DENSE but organized — it's the "we actually built this" proof

### 🖼️ Image Generation Prompt
*(No AI image needed. Pure content slide. If you want a subtle background element:)*
```
Very subtle, low-opacity (10%) wireframe of a satellite structure on 
dark navy background. Technical blueprint/schematic style. Barely 
visible — just enough to give texture. No text. 16:9.
```

### Speaker Notes
> "Let me talk about what's actually under the hood, because FAR AWAY is about building, not pitching."
>
> "First: real orbital math. We're pulling live TLE data from CelesTrak and propagating with SGP4 — the same algorithm the US Space Force uses. Conjunction detection uses scipy's optimization to find the exact second of closest approach across a 24-hour search window."
>
> "Second: this is genuine multi-agent negotiation, not a scripted demo. Two independent LangGraph agents each compute their own delta-V bid based on their own fuel state and maneuver history. The coordinator picks the winner. We use LangGraph's interrupt mechanism for human-in-the-loop — the graph literally pauses and waits for the human to click approve."
>
> "Third — and this is important — the AI is NOT a wrapper. All the physics, all the geometry, all the optimization is deterministic code. The AI does one thing: judgment. Interpreting a situation against rules. And its output is forced into a JSON schema. If the LLM produces anything that doesn't match, the command is rejected and the system defaults to 'hold position.' The LLM never touches a number."
>
> "And Layer 2: we deliberately split perception from reasoning. The CNN measures — position, keypoints, pose. The LLM decides — should we dodge, which direction, how much. Neither does the other's job. That separation is the actual engineering decision."

---

## Slide 8 — The Dashboard

### On-Slide Text
```
[top, small, uppercase, letter-spaced, #448AFF]
DESIGN & USER EXPERIENCE

[heading, bold, white]
The dashboard.

[MAIN AREA — 2-3 ACTUAL SCREENSHOTS from the working app, arranged nicely]

Screenshot 1 (largest, center/left):
→ The 3D globe with satellite dots, orbital trails, and red conjunction zone

Screenshot 2 (right side):
→ The HITL approval panel (ManeuverCard) showing before/after Pc, approve/veto buttons

Screenshot 3 (bottom or inset):
→ The Event Feed with agent decision log entries

[small caption below, #94A3B8]
Not a mockup — screenshots from the working application.
Real Starlink satellites. Real orbital positions. Real-time WebSocket updates.
```

### Layout
- This slide is ALL about the screenshots — make them large and crisp
- Arrange in an asymmetric layout: one large screenshot (globe) + two smaller ones (HITL panel + event feed)
- Add a very subtle drop shadow to each screenshot
- The caption "Not a mockup" is important — judges need to know this is real

### 🖼️ How to Get the Screenshots
```
1. Start the backend:  uvicorn backend.main:app --reload
2. Start the frontend: cd frontend && npm run dev
3. Open in browser, inject a demo conjunction
4. Screenshot the globe view (with satellites visible)
5. Screenshot the HITL panel (when it appears after conjunction)
6. Screenshot the Event Feed (with agent log entries)
7. Use a tool like CleanShot or Cmd+Shift+4 to capture clean crops
```

### 🖼️ Image Generation Prompt (ONLY if app screenshots aren't available)
```
A dark-themed space operations dashboard UI mockup. Left: a 3D globe 
showing Earth with glowing dots (satellites) and thin orbital path lines. 
A red pulsing zone marks a conjunction. Right panel: a card showing 
"MANEUVER PROPOSAL" with before/after collision probability numbers 
(red 1.2×10⁻³ → green 3.1×10⁻⁷), an "APPROVE" button in green, and 
a "VETO" button in red. Bottom: a scrolling event feed log with 
timestamps. Dark navy/slate color scheme. Modern, clean, premium feel. 
16:9 aspect ratio.
```

### Speaker Notes
> "Here's the actual dashboard. This is not a mockup — these are screenshots from the working application."
>
> "On the left: a 3D globe rendering over 150 real Starlink satellites from CelesTrak, updating in real time via WebSocket. When a conjunction is detected, the zone pulses red and the camera auto-zooms."
>
> "On the right: the HITL panel that appears when a winning bid is selected. You can see the before and after collision probability, the delta-V cost, and the approve and veto buttons. The presenter clicks approve, the maneuver executes, and the orbit trail visibly shifts."
>
> "And the event feed here — that's a real-time log of every agent decision. You can see the TLE ingestion agent, the conjunction detector, both operator agents bidding, and the coordinator selecting the winner."

---

## Slide 9 — Why This Matters

### On-Slide Text
```
[top, small, uppercase, letter-spaced, #FF1744]
WHY THIS MATTERS

[heading, bold, white]
Not a hypothetical. This is happening right now.

[three impactful statements, vertically stacked, with icons]

⏱️  Starlink executes a collision-avoidance maneuver every 90 seconds.

💀  Kessler Syndrome: one chain reaction permanently destroys 
    entire orbital shells. Not science fiction — active research topic.

🇯🇵  JAXA and 12,000+ Japanese-manufactured components are
    actively at risk in LEO.

[bottom, single line, bold, #FFAB00]
$11.1 billion in projected satellite losses from uncoordinated conjunctions. — WEF, 2025
```

### Layout
- Three statement blocks, generously spaced, each with a large emoji/icon on the left
- The WEF citation at the bottom in amber — this is the anchor number
- No charts, no graphs — just impactful statements that land
- Optional: very subtle background image of Kessler debris simulation (10% opacity)

### 🖼️ Image Generation Prompt (optional background)
```
A visualization of Kessler Syndrome: Earth surrounded by an 
increasingly dense shell of debris fragments, starting sparse and 
becoming a thick cloud. Dark, ominous, cinematic lighting. The debris 
should look chaotic and dangerous. Very dark overall — suitable as a 
10% opacity background behind white text. No text. 16:9 aspect ratio.
```

### Speaker Notes
> "This is not a hypothetical. Starlink is executing a collision-avoidance maneuver every 90 seconds right now. That's a real operational burden with no coordination protocol."
>
> "Kessler Syndrome — the cascading chain reaction where one collision creates debris that causes more collisions — is not science fiction. It's an active research topic. If it triggers in a critical orbital shell, that altitude is permanently unusable. For everyone. Forever."
>
> "And this matters here: JAXA operates critical assets in these orbits, and over 12,000 Japanese-manufactured components are at risk in low Earth orbit. The $11.1 billion figure comes from the World Economic Forum — that's the projected loss from uncoordinated conjunctions alone."

---

## Slide 10 — What's Next

### On-Slide Text
```
[top, small, uppercase, letter-spaced, #448AFF]
FUTURE SCOPE

[heading, bold, white]
What we built. What's next. What we're honest about.

[three columns]

COLUMN 1 — ✅ BUILT
• Working two-layer prototype
• Live CelesTrak data (Layer 1)
• Simulated perception (Layer 2)
• 3D globe dashboard
• Multi-agent negotiation pipeline
• HITL approve/veto flow

COLUMN 2 — 🔜 NEXT
• RL-based negotiation
  (agents learn better bidding)
• Multi-operator trust consortium
  (open protocol, like DNS)
• LeoLabs tracking integration
• Edge deployment validation
  (ARM64, <6GB footprint)

COLUMN 3 — 🟡 HONEST LIMITATIONS
• Reflex Layer is a laptop
  simulation, not on-device
• Multi-body conjunctions
  (3+ satellites) not in v1
• Production Reflex requires
  camera-equipped satellites
• Governance model is conceptual
```

### Layout
- Three equal columns with headers (green checkmark, blue arrow, amber dot)
- Column 1 should feel solid/complete, Column 3 should feel transparent/honest
- Clean card backgrounds for each column

### 🖼️ Image Generation Prompt
*(No image needed. Pure content slide.)*

### Speaker Notes
> "What we built: a working two-layer prototype. Layer 1 runs on live CelesTrak data with real satellite names. Layer 2 is simulated on the SPEED+ benchmark dataset. The dashboard, the negotiation pipeline, the HITL flow — all working."
>
> "Where this goes: reinforcement learning for the operator agents, so they learn better bidding strategies over time. A multi-operator trust consortium — think of it like DNS, a neutral protocol not controlled by any single operator. And edge deployment of the Reflex Layer on actual satellite hardware."
>
> "And we want to be honest about what this isn't, yet. The Reflex Layer is a laptop simulation — we present the on-device architecture as feasibility analysis, not production. Multi-body conjunctions — three or more satellites at once — are out of scope for version one. And production Reflex deployment would require camera-equipped satellites, which most current satellites don't have."

---

## Slide 11 — Team

### On-Slide Text
```
[top, small, uppercase, letter-spaced, #00E676]
TEAM CLAUSEZERO

[heading, bold, white]
Built in 6 days.

[team grid — 2×2 or 1×4, each person in a card with photo + role]

┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  [photo]     │  │  [photo]     │  │  [photo]     │  │  [photo]     │
│  RISHET      │  │  RAGHAV      │  │  PARV        │  │  NILAY       │
│  Tech Lead   │  │  Orbital     │  │  Research +  │  │  Deck +      │
│  Backend,    │  │  Math,       │  │  Agents,     │  │  Presentation│
│  API,        │  │  Conjunction │  │  Frontend    │  │              │
│  LangGraph   │  │  Detection   │  │              │  │              │
└─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘

[bottom center, larger]
🔗 GitHub Repo     🔗 Live Demo

[closing tagline, italic, #94A3B8, 20pt]
"SpaceATC gives satellites days to plan and milliseconds to react."
```

### Layout
- Team photos if available (circle crop, consistent size)
- If no photos, use initials in colored circles (each person gets a different accent color)
- GitHub and Demo links should be clickable and prominent
- The closing tagline is the last thing judges see — make it memorable

### 🖼️ Image Generation Prompt (for team photo backgrounds, optional)
```
Four circular avatar placeholder frames on a dark navy background, 
arranged in a horizontal row. Each frame has a subtle glowing border 
in a different color (blue, green, amber, red). Below each frame, 
space for a name and role. Clean, modern, minimal. 16:9 aspect ratio.
```

### Speaker Notes
> "We're Team ClauseZero. Four people, six days. Rishet on the backend pipeline and LangGraph integration. Raghav on the orbital math — conjunction detection and delta-V calculation. Parv on research, agent prompts, and the frontend. And Nilay on the deck and presentation."
>
> "The GitHub repo and a live demo link are here. Everything we showed today is real, running, and documented."
>
> "SpaceATC gives satellites days to plan and milliseconds to react. Thank you."

---

## Q&A Reference (NOT a slide — presenter cheat sheet)

Print this or keep it on a phone during Q&A:

| Question | 10-second answer |
|----------|-----------------|
| "Is this an LLM wrapper?" | No — physics is deterministic (sgp4, PnP, scipy). AI does judgment only. Output is schema-validated JSON. Fails safe. |
| "Doesn't Kayhan already do this?" | Kayhan automates pre-agreed deals for ~50 paying subscribers. We handle operators with NO prior agreement + untracked debris. |
| "Won't dodging change the orbit?" | 0.087 m/s = ~300m shift at closest approach. Station-keeping corrects it next orbit. Like stepping sideways for a puddle. |
| "Does Reflex run on a real satellite?" | Demo = laptop simulation. Architecture targets ARM64, <6GB. Framed as feasibility analysis. |
| "Same bid from both agents?" | Tiebreaker: higher fuel reserve maneuvers. Secondary: lower mission-value satellite moves. |
| "3+ satellite conjunctions?" | Out of scope for v1. Even ESA treats this as a harder research problem. |
| "Who governs this platform?" | Open consortium, like DNS. Neutral protocol, not controlled by any one operator. |
| "What about military satellites?" | Out of scope — they have separate, protected coordination channels. We target commercial operators. |
