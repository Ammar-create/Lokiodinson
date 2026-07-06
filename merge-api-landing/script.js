/* ═══════════════════════════════════════════════════════════════════
   MERGE API — abyssal orchestration
   raw WebGL water-flood scene engine + ray-convergence loader
   ═══════════════════════════════════════════════════════════════════ */
(() => {
"use strict";

/* ───────────────────────── configuration ───────────────────────── */

const SCENES = [
  { // 00 · surface
    src: "https://lokiodinson.sirv.com/image-1783324858199.png.jpg",
    palette: ["#0a2a3c", "#0f4d5c", "#02060a"],
  },
  { // 01 · descent
    src: "https://lokiodinson.sirv.com/image-1783324861209.png.jpg",
    palette: ["#04202e", "#136273", "#010508"],
  },
  { // 02 · currents
    src: "https://lokiodinson.sirv.com/file_00000000b6c072079ab9fbac95866f8e.png",
    palette: ["#062433", "#1d8a8a", "#020a10"],
  },
  { // 03 · depths
    src: "https://lokiodinson.sirv.com/image-1783324864266.png.jpg",
    palette: ["#031722", "#0d5566", "#010407"],
  },
  { // 04 · emergence
    src: "https://lokiodinson.sirv.com/image-1783324936956.png.jpg",
    palette: ["#0b3140", "#2aa5a0", "#02070c"],
  },
];

const TRANSITION_MS   = 2400;   // full flood + drain
const INTRO_MS        = 2600;   // loader → scene 0 flood
const INPUT_COOLDOWN  = 320;    // ms after a transition before next input
const WHEEL_THRESHOLD = 46;
const SWIPE_THRESHOLD = 58;

const prefersReduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const isMobile = matchMedia("(max-width: 720px)").matches;

/* ───────────────────────── tiny helpers ───────────────────────── */

const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp01 = v => Math.min(1, Math.max(0, v));
const easeInOut = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ═══════════════════════════════════════════════════════════════════
   WEBGL — the ocean
   One fullscreen quad. uProgress 0→1 drives a water body that RISES
   past the top of the viewport (full submersion, foam, bubbles,
   caustics, chromatic refraction), swaps worlds at the crest, then
   drains downward to reveal the next scene.
   ═══════════════════════════════════════════════════════════════════ */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main(){
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;

varying vec2 vUv;

uniform sampler2D uTex0;      /* outgoing world  */
uniform sampler2D uTex1;      /* incoming world  */
uniform vec2  uRes;
uniform vec2  uImg0;
uniform vec2  uImg1;
uniform vec2  uMouse;
uniform float uTime;
uniform float uProgress;      /* 0 → 1 flood/drain      */
uniform float uQuality;       /* bubble layers (1..3)   */
uniform float uAmbient;       /* idle ripple intensity  */
uniform float uReduced;       /* 1 = crossfade only     */

/* ---------- noise kit ---------- */
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i),                 hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 4; i++){
    v += a * noise(p);
    p = p * 2.03 + vec2(17.31, 9.17);
    a *= 0.5;
  }
  return v;
}

/* ---------- cover-fit uv ---------- */
vec2 coverUV(vec2 uv, vec2 screen, vec2 image){
  float sr = screen.x / max(screen.y, 1.0);
  float ir = image.x  / max(image.y, 1.0);
  vec2 scale = (sr > ir) ? vec2(1.0, ir / sr) : vec2(sr / ir, 1.0);
  return (uv - 0.5) * scale + 0.5;
}

float easeIO(float t){
  return t < 0.5 ? 4.0*t*t*t : 1.0 - pow(-2.0*t + 2.0, 3.0) / 2.0;
}

/* ---------- rising bubbles (procedural, 3 parallax layers) ---------- */
float bubbles(vec2 uv, float t, float churn){
  float acc = 0.0;
  float aspect = uRes.x / max(uRes.y, 1.0);
  for(int i = 0; i < 3; i++){
    float fi = float(i);
    if(fi >= uQuality) break;
    float sc = 6.0 + fi * 7.0;
    vec2 p = uv * vec2(aspect, 1.0) * sc;
    p.y -= t * (0.9 + fi * 0.85) * (1.0 + churn * 2.2);   /* rise, faster mid-flood */
    p.x += sin(p.y * 0.7 + fi * 4.0) * 0.22;              /* wobble */
    vec2 id = floor(p);
    vec2 f  = fract(p) - 0.5;
    float h = hash(id + fi * 61.7);
    float on = step(0.62, h);                             /* sparse cells */
    vec2 c = (vec2(hash(id + 3.1), hash(id + 9.7)) - 0.5) * 0.45;
    float r = mix(0.05, 0.2, fract(h * 9.73));
    float d = length(f - c);
    float shell = smoothstep(r, r * 0.82, d) - smoothstep(r * 0.82, r * 0.30, d) * 0.72;
    float glint = smoothstep(r * 0.5, 0.0, length(f - c + vec2(r * 0.33, -r * 0.33)));
    acc += on * (max(shell, 0.0) * 0.55 + glint * 0.8) * (0.55 + 0.45 * fract(h * 5.19));
  }
  return acc;
}

void main(){
  vec2 uv = vUv;
  float p = clamp(uProgress, 0.0, 1.0);

  vec2 cuv0 = coverUV(uv, uRes, uImg0);
  vec2 cuv1 = coverUV(uv, uRes, uImg1);

  /* ── reduced motion: dignified crossfade, nothing else ── */
  if(uReduced > 0.5){
    vec3 a = texture2D(uTex0, cuv0).rgb;
    vec3 b = texture2D(uTex1, cuv1).rgb;
    vec3 col = mix(a, b, easeIO(p));
    float vig = smoothstep(1.3, 0.42, length(uv - 0.5) * 1.42);
    col *= mix(0.66, 1.0, vig);
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  /* ── water level: -0.35 → +1.45 → -0.35 (fully past both edges) ── */
  float ph   = p < 0.5 ? p * 2.0 : (1.0 - p) * 2.0;   /* 0→1→0 */
  float lvl  = mix(-0.35, 1.45, easeIO(ph));
  float move = smoothstep(0.02, 0.25, ph);            /* wave energy while moving */

  float wob =
      sin(uv.x * 9.0  + uTime * 2.6) * 0.020
    + sin(uv.x * 21.0 - uTime * 4.2) * 0.009
    + (fbm(vec2(uv.x * 3.2, uTime * 0.7)) - 0.5) * 0.11;
  float surf  = lvl + wob * move;
  float depth = surf - uv.y;                          /* > 0 ⇒ underwater */

  /* which world lives in the air — swap hidden at full submersion */
  bool second = p >= 0.5;
  vec2  airUv  = second ? cuv1 : cuv0;

  /* ── AIR: crisp scene + faint ambient drift + mouse ripple ── */
  vec2 amb = (vec2(
      fbm(uv * 3.0 + uTime * 0.05),
      fbm(uv * 3.0 - uTime * 0.04 + 5.0)) - 0.5) * 0.004 * uAmbient;
  vec2 mo = uv - uMouse;
  float md = length(mo);
  amb += (md > 0.0001 ? mo / md : vec2(0.0)) * exp(-md * 7.0) * 0.006 * uAmbient;
  /* heat-haze shimmer just above the advancing surface */
  amb.y += exp(-abs(depth) * 26.0) * (fbm(vec2(uv.x * 30.0, uTime * 3.0)) - 0.5) * 0.02 * move;

  vec3 air = second
    ? texture2D(uTex1, airUv + amb).rgb
    : texture2D(uTex0, airUv + amb).rgb;

  vec3 col = air;

  if(depth > 0.0){
    /* ── WATER BODY ── */
    float dm = clamp(depth * 2.6, 0.0, 1.0);          /* depth mask */

    vec2 flow = vec2(
      fbm(uv * 5.0 + vec2(0.0, uTime * 0.9)),
      fbm(uv * 5.0 + vec2(4.7, uTime * 1.15))) - 0.5;

    vec2 ruv = airUv + flow * (0.022 + 0.06 * dm);

    vec3 wat;
    if(second){
      wat.r = texture2D(uTex1, ruv + flow * 0.014).r;
      wat.g = texture2D(uTex1, ruv).g;
      wat.b = texture2D(uTex1, ruv - flow * 0.014).b;
    } else {
      wat.r = texture2D(uTex0, ruv + flow * 0.014).r;
      wat.g = texture2D(uTex0, ruv).g;
      wat.b = texture2D(uTex0, ruv - flow * 0.014).b;
    }

    /* volumetric tint — shallow teal into abyssal ink */
    vec3 shallow = vec3(0.10, 0.42, 0.46);
    vec3 deepC   = vec3(0.012, 0.085, 0.125);
    wat = mix(wat, mix(shallow, deepC, clamp(depth * 1.5, 0.0, 1.0)), 0.5 + 0.28 * dm);

    /* caustic webbing */
    float ca = fbm(uv * 7.0 + vec2(uTime * 0.85, -uTime * 0.6));
    ca = pow(smoothstep(0.52, 0.95, ca), 2.0);
    wat += vec3(0.35, 0.9, 0.95) * ca * 0.32 * (1.0 - dm * 0.55);

    /* god rays sinking from the surface */
    float ray = fbm(vec2(uv.x * 6.0 - uTime * 0.16, uv.y * 0.4));
    wat += vec3(0.18, 0.5, 0.55)
         * smoothstep(0.58, 0.95, ray)
         * (1.0 - clamp(depth * 2.1, 0.0, 1.0)) * 0.4;

    /* bubbles — dense while the flood is in motion */
    float churn = smoothstep(0.05, 0.6, ph) * move;
    float bub = bubbles(uv, uTime, churn) * smoothstep(0.0, 0.04, depth);
    wat += vec3(0.72, 0.96, 1.0) * bub * (0.25 + churn * 0.95);

    col = wat;

    /* luminous whiteout at full submersion — masks the world swap */
    float fullness = smoothstep(0.72, 1.0, ph);
    col += vec3(0.10, 0.38, 0.42) * fullness;
    col = mix(col, vec3(0.62, 0.95, 0.97), fullness * fullness * 0.35);
  }

  /* ── FOAM CREST ── */
  float fo   = fbm(vec2(uv.x * 16.0, uTime * 2.1));
  float band = 1.0 - smoothstep(0.0, 0.05 * (1.0 + fo), abs(depth));
  float foamAmt = band * (0.3 + 0.7 * smoothstep(0.35, 0.9, fo + band * 0.3)) * move;
  col = mix(col, vec3(0.88, 1.0, 1.0), foamAmt * 0.85);
  col += vec3(0.35, 0.9, 0.9) * pow(band, 3.0) * 0.55 * move;   /* biolume edge glow */

  /* spray dots above the crest */
  float above = -depth;
  if(above > 0.0 && above < 0.06 && move > 0.2){
    float sp = step(0.985, hash(floor(uv * uRes * 0.5) + floor(uTime * 8.0)));
    col += vec3(0.8, 1.0, 1.0) * sp * (1.0 - above / 0.06) * move;
  }

  /* ── grade: vignette + grain ── */
  float vig = smoothstep(1.3, 0.42, length(uv - 0.5) * 1.42);
  col *= mix(0.66, 1.0, vig);
  col += (hash(uv * uRes + fract(uTime) * 61.7) - 0.5) * 0.035;

  gl_FragColor = vec4(col, 1.0);
}`;

/* ───────────────────────── engine ───────────────────────── */

function createOcean(canvas){
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" })
          || canvas.getContext("experimental-webgl");
  if(!gl) return null;

  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
      console.error(gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = sh(gl.VERTEX_SHADER, VERT);
  const fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if(!vs || !fs) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog, gl.LINK_STATUS)){
    console.error(gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  ["uTex0","uTex1","uRes","uImg0","uImg1","uMouse","uTime",
   "uProgress","uQuality","uAmbient","uReduced"]
    .forEach(n => U[n] = gl.getUniformLocation(prog, n));

  const makeTexture = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                  new Uint8Array([3, 8, 12, 255]));
    return { tex: t, w: 2, h: 3 };
  };

  const slots = [makeTexture(), makeTexture()];   // 0 = outgoing, 1 = incoming

  const upload = (slot, source, w, h) => {
    gl.bindTexture(gl.TEXTURE_2D, slots[slot].tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    slots[slot].w = w;
    slots[slot].h = h;
  };

  const state = {
    progress: 0,
    ambient: 1,
    mouse: [0.5, 0.5],
    mouseTarget: [0.5, 0.5],
  };

  const dpr = Math.min(devicePixelRatio || 1, isMobile ? 1.25 : 1.6);
  const resize = () => {
    const w = Math.round(innerWidth * dpr);
    const h = Math.round(innerHeight * dpr);
    if(canvas.width !== w || canvas.height !== h){
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  };
  resize();
  addEventListener("resize", resize);

  const quality = isMobile ? 2 : 3;
  const t0 = performance.now();

  const render = () => {
    resize();
    state.mouse[0] += (state.mouseTarget[0] - state.mouse[0]) * 0.06;
    state.mouse[1] += (state.mouseTarget[1] - state.mouse[1]) * 0.06;

    gl.uniform1i(U.uTex0, 0);
    gl.uniform1i(U.uTex1, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, slots[0].tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, slots[1].tex);

    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform2f(U.uImg0, slots[0].w, slots[0].h);
    gl.uniform2f(U.uImg1, slots[1].w, slots[1].h);
    gl.uniform2f(U.uMouse, state.mouse[0], 1 - state.mouse[1]);
    gl.uniform1f(U.uTime, (performance.now() - t0) / 1000);
    gl.uniform1f(U.uProgress, state.progress);
    gl.uniform1f(U.uQuality, quality);
    gl.uniform1f(U.uAmbient, state.ambient);
    gl.uniform1f(U.uReduced, prefersReduced ? 1 : 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(render);
  };
  requestAnimationFrame(render);

  addEventListener("pointermove", e => {
    state.mouseTarget[0] = e.clientX / innerWidth;
    state.mouseTarget[1] = e.clientY / innerHeight;
  }, { passive: true });

  return { gl, state, upload };
}

/* ───────────────────────── textures ───────────────────────── */

/* procedural fallback: painted abyss gradient + biolume blobs */
function paintFallback(palette, seedText){
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 640;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, palette[0]);
  g.addColorStop(.55, palette[2]);
  g.addColorStop(1, palette[2]);
  x.fillStyle = g;
  x.fillRect(0, 0, c.width, c.height);

  let seed = 0;
  for(const ch of seedText) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
  const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;

  x.globalCompositeOperation = "lighter";
  for(let i = 0; i < 26; i++){
    const bx = rand() * c.width, by = rand() * c.height, r = 30 + rand() * 240;
    const rg = x.createRadialGradient(bx, by, 0, bx, by, r);
    rg.addColorStop(0, palette[1] + (i % 3 ? "26" : "40"));
    rg.addColorStop(1, "transparent");
    x.fillStyle = rg;
    x.beginPath(); x.arc(bx, by, r, 0, 7); x.fill();
  }
  /* fine sediment */
  x.globalAlpha = .5;
  for(let i = 0; i < 900; i++){
    x.fillStyle = rand() > .5 ? "#7dd8cf" : "#eafffb";
    x.globalAlpha = rand() * .16;
    x.fillRect(rand() * c.width, rand() * c.height, 1.3, 1.3);
  }
  return c;
}

function loadSceneTextures(ocean, onEach){
  const entries = SCENES.map((s, i) => {
    const entry = { source: paintFallback(s.palette, s.src + i), w: 1024, h: 640, ready: false };
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      entry.source = img;
      entry.w = img.naturalWidth;
      entry.h = img.naturalHeight;
      entry.ready = true;
      onEach(i);
    };
    img.onerror = () => { entry.ready = true; onEach(i); };   // keep fallback
    img.src = s.src;
    return entry;
  });
  return entries;
}

/* ═══════════════════════════════════════════════════════════════════
   LOADER — rays converge into an orchestrated fan, collapse to one
   beam, then the ocean floods the screen and reveals scene 00.
   Many models → one voice, drawn in light.
   ═══════════════════════════════════════════════════════════════════ */

function runLoader(onFlood, onGone, assetProgress){
  const el = $("#loader");
  const canvas = $("#loader-canvas");
  const pctEl = $("#loader-pct");
  const roleEl = $("#loader-role");
  const ctx = canvas.getContext("2d");

  const ROLES = [
    "waking the architect…",
    "briefing the implementer…",
    "summoning the critic…",
    "fetching current info…",
    "seating the judge…",
    "merging five minds…",
  ];
  let roleIdx = 0;
  const roleTimer = setInterval(() => {
    roleEl.classList.add("is-swap");
    setTimeout(() => {
      roleIdx = (roleIdx + 1) % ROLES.length;
      roleEl.textContent = ROLES[roleIdx];
      roleEl.classList.remove("is-swap");
    }, 300);
  }, 900);

  const N = prefersReduced ? 0 : (isMobile ? 34 : 56);
  const rays = Array.from({ length: N }, (_, i) => ({
    base: (i / Math.max(N - 1, 1) - 0.5) * 2,     // -1..1 order in the fan
    speed: 0.4 + Math.abs(Math.sin(i * 12.9898)) * 0.9,
    phase: (i * 2.399) % (Math.PI * 2),
    amp: 0.35 + Math.abs(Math.sin(i * 78.233)) * 0.65,
    hue: 168 + (i % 7) * 5,
  }));

  const MIN_MS = prefersReduced ? 900 : 3000;
  const start = performance.now();
  let shown = 0;
  let floodFired = false;
  let raf = 0;

  const draw = (now) => {
    const t = (now - start) / 1000;
    const timeP  = clamp01((now - start) / MIN_MS);
    const target = Math.min(timeP, 0.15 + assetProgress() * 0.85);
    shown += (target - shown) * 0.09;
    if(target >= 0.999) shown = Math.min(1, shown + 0.004);  // guarantee arrival
    const p = clamp01(shown);
    pctEl.textContent = String(Math.floor(p * 100)).padStart(2, "0");

    const w = canvas.width  = innerWidth  * Math.min(devicePixelRatio || 1, 1.5);
    const h = canvas.height = innerHeight * Math.min(devicePixelRatio || 1, 1.5);

    ctx.fillStyle = "#02060a";
    ctx.fillRect(0, 0, w, h);

    if(N){
      /* choreography: wander → ordered fan → single beam */
      const conv  = easeInOut(clamp01((p - 0.15) / 0.6));   // scattered → fan
      const unify = easeInOut(clamp01((p - 0.82) / 0.18));  // fan → one ray
      const ox = -w * 0.06, oy = h * 0.5;
      const len = Math.hypot(w, h) * 1.2;

      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";

      for(const r of rays){
        const wander = Math.sin(t * r.speed + r.phase) * r.amp * 0.9
                     + Math.sin(t * r.speed * 0.37 + r.phase * 2.0) * r.amp * 0.4;
        const fan = r.base * 0.34;                       // orchestrated pattern
        let ang = wander * (1 - conv) + fan * conv;
        ang *= (1 - unify);                              // collapse to a single beam
        const ex = ox + Math.cos(ang) * len;
        const ey = oy + Math.sin(ang) * len;
        const g = ctx.createLinearGradient(ox, oy, ex, ey);
        const a = (0.05 + conv * 0.06 + unify * 0.12) * (0.5 + r.amp * 0.5);
        g.addColorStop(0, `hsla(${r.hue}, 90%, 72%, ${a * 1.6})`);
        g.addColorStop(.4, `hsla(${r.hue}, 85%, 62%, ${a})`);
        g.addColorStop(1, "transparent");
        ctx.strokeStyle = g;
        ctx.lineWidth = (0.7 + conv * 0.8 + unify * 2.4) * (w / 1400);
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }

      /* the one voice — core beam bloom */
      if(unify > 0){
        const g = ctx.createLinearGradient(ox, oy, w, oy);
        g.addColorStop(0, `rgba(234,255,251,${0.5 * unify})`);
        g.addColorStop(.6, `rgba(94,242,221,${0.25 * unify})`);
        g.addColorStop(1, "transparent");
        ctx.strokeStyle = g;
        ctx.lineWidth = (2 + unify * 5) * (w / 1400);
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(w, oy); ctx.stroke();
      }

      /* origin glow */
      const og = ctx.createRadialGradient(ox, oy, 0, ox, oy, w * 0.22);
      og.addColorStop(0, `rgba(94,242,221,${0.25 + conv * 0.2})`);
      og.addColorStop(1, "transparent");
      ctx.fillStyle = og;
      ctx.fillRect(0, 0, w, h);

      /* water preview — a breathing line low in the frame */
      ctx.globalCompositeOperation = "source-over";
      const wy = h * (0.94 - p * 0.05);
      ctx.beginPath();
      ctx.moveTo(0, h);
      for(let x = 0; x <= w; x += 12){
        ctx.lineTo(x, wy + Math.sin(x * 0.012 + t * 2.4) * 5 + Math.sin(x * 0.03 - t * 3.1) * 3);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = "rgba(14, 60, 72, .55)";
      ctx.fill();
    }

    if(p >= 0.995 && !floodFired){
      floodFired = true;
      clearInterval(roleTimer);
      roleEl.textContent = "one voice.";
      onFlood(() => {                    // called by engine at full submersion
        el.classList.add("is-done");
        cancelAnimationFrame(raf);
        setTimeout(onGone, 950);
      });
    }
    if(!floodFired || !el.classList.contains("is-done")) raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
}

/* ═══════════════════════════════════════════════════════════════════
   SCENE DIRECTOR — flood, swap, drain
   ═══════════════════════════════════════════════════════════════════ */

function main(){
  const canvas = $("#gl");
  const ocean = createOcean(canvas);
  const scenes = $$(".scene");
  const pagBtns = $$(".paginator button");
  const navLinks = $$("[data-goto]");
  const hudIndex = $("#hud-index");
  const hudFill = $("#hud-fill");

  document.documentElement.style.setProperty("--n-scenes", SCENES.length);

  /* WebGL unavailable → static graceful mode */
  if(!ocean){
    document.body.classList.add("no-gl", "is-ready");
    scenes.forEach((s, i) => {
      s.style.backgroundImage = `linear-gradient(rgba(2,6,10,.55), rgba(2,6,10,.75)), url(${SCENES[i].src})`;
      s.style.backgroundSize = "cover";
      s.style.backgroundPosition = "center";
    });
    $("#loader").classList.add("is-done");
  }

  let loadedCount = 0;
  const bootAt = performance.now();
  const slotScene = [null, null];   // which scene index each GL slot holds
  const entries = ocean
    ? loadSceneTextures(ocean, (i) => {
        loadedCount++;
        /* a slot already displays this scene → refresh it with the real image */
        slotScene.forEach((sc, slot) => { if(sc === i) setSlot(slot, i); });
      })
    : [];
  /* never soft-lock the loader: after 9s, proceed on painted fallbacks */
  const assetProgress = () => !ocean ? 1
    : Math.max(loadedCount / SCENES.length, performance.now() - bootAt > 9000 ? 1 : 0);

  const setSlot = (slot, sceneIdx) => {
    const e = entries[sceneIdx];
    slotScene[slot] = sceneIdx;
    ocean.upload(slot, e.source, e.w, e.h);
  };

  let current = 0;
  let locked = true;              // locked until intro completes
  let rafAnim = 0;

  const setActiveUI = (idx) => {
    document.body.dataset.scene = idx;
    document.body.classList.toggle("at-end", idx === SCENES.length - 1);
    pagBtns.forEach((b, i) => b.classList.toggle("is-active", i === idx));
    $$(".head-nav a, .mobile-menu nav a").forEach(a =>
      a.classList.toggle("is-active", +a.dataset.goto === idx));
    hudIndex.textContent = String(idx).padStart(2, "0");
    hudFill.style.width = `${(idx / (SCENES.length - 1)) * 100}%`;
  };

  const showScene = (idx) => {
    scenes.forEach((s, i) => {
      s.classList.toggle("is-active", i === idx);
      s.classList.remove("is-leaving");
      if(i === idx) s.querySelector(".scene-inner").scrollTop = 0;
    });
    setActiveUI(idx);
  };

  const animateProgress = (ms, onCrest, onDone) => {
    const start = performance.now();
    let crested = false;
    cancelAnimationFrame(rafAnim);
    const step = (now) => {
      const t = clamp01((now - start) / ms);
      ocean.state.progress = t;
      if(!crested && t >= 0.5){ crested = true; onCrest && onCrest(); }
      if(t < 1){ rafAnim = requestAnimationFrame(step); }
      else onDone && onDone();
    };
    rafAnim = requestAnimationFrame(step);
  };

  const goTo = (target) => {
    if(!ocean){ current = target; showScene(target); return; }
    if(locked || target === current || target < 0 || target >= SCENES.length) return;
    locked = true;

    setSlot(1, target);                                   // incoming world
    scenes[current].classList.remove("is-active");
    scenes[current].classList.add("is-leaving");
    scenes[current].querySelector(".scene-inner").style.pointerEvents = "none";

    const ms = prefersReduced ? 900 : TRANSITION_MS;
    animateProgress(ms,
      () => {                                             // crest: fully submerged
        scenes[current].classList.remove("is-leaving");
        scenes[current].querySelector(".scene-inner").style.pointerEvents = "";
        current = target;
        showScene(current);
      },
      () => {                                             // drained
        setSlot(0, current);
        ocean.state.progress = 0;
        setTimeout(() => { locked = false; }, INPUT_COOLDOWN);
      });
  };

  /* ── intro: void → scene 00 flood, driven by the loader ── */
  const runIntro = () => {
    setSlot(1, 0);                                        // incoming = hero
    runLoader(
      (hideLoader) => {                                   // rays converged → flood
        const ms = prefersReduced ? 900 : INTRO_MS;
        animateProgress(ms,
          () => {                                         // crest
            hideLoader();
            document.body.classList.add("is-ready");
            showScene(0);
          },
          () => {
            setSlot(0, 0);
            ocean.state.progress = 0;
            setTimeout(() => { locked = false; }, INPUT_COOLDOWN);
          });
      },
      () => {},                                           // loader removed
      assetProgress
    );
  };

  if(ocean) runIntro();
  else showScene(0);

  /* ═══════════════ input — wheel / touch / keys / clicks ═══════════════ */

  const activeInner = () => scenes[current] && scenes[current].querySelector(".scene-inner");

  const innerCanScroll = (dir) => {
    const el = activeInner();
    if(!el || el.scrollHeight - el.clientHeight < 6) return false;
    return dir > 0
      ? el.scrollTop + el.clientHeight < el.scrollHeight - 2
      : el.scrollTop > 2;
  };

  let wheelAcc = 0;
  let wheelTimer = 0;
  addEventListener("wheel", (e) => {
    if(document.body.classList.contains("menu-open")) return;
    const dir = Math.sign(e.deltaY);
    if(innerCanScroll(dir)) return;                       // let tall content scroll
    e.preventDefault();
    if(locked) return;
    wheelAcc += e.deltaY;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelAcc = 0; }, 180);
    if(Math.abs(wheelAcc) > WHEEL_THRESHOLD){
      goTo(current + (wheelAcc > 0 ? 1 : -1));
      wheelAcc = 0;
    }
  }, { passive: false });

  let touchY = null, touchX = null;
  addEventListener("touchstart", (e) => {
    touchY = e.touches[0].clientY;
    touchX = e.touches[0].clientX;
  }, { passive: true });
  addEventListener("touchend", (e) => {
    if(touchY === null || document.body.classList.contains("menu-open")) return;
    const dy = touchY - e.changedTouches[0].clientY;
    const dx = touchX - e.changedTouches[0].clientX;
    touchY = touchX = null;
    if(Math.abs(dy) < SWIPE_THRESHOLD || Math.abs(dy) < Math.abs(dx)) return;
    const dir = dy > 0 ? 1 : -1;
    if(innerCanScroll(dir) || locked) return;
    goTo(current + dir);
  }, { passive: true });

  addEventListener("keydown", (e) => {
    if(e.target.matches("input, textarea")) return;
    if(e.key === "Escape") closeMenu();
    if(document.body.classList.contains("menu-open")) return;
    const nav = {
      ArrowDown: 1, PageDown: 1, " ": 1,
      ArrowUp: -1, PageUp: -1,
    }[e.key];
    if(nav !== undefined && !innerCanScroll(nav)){
      e.preventDefault();
      goTo(current + nav);
    }
    if(e.key === "Home"){ e.preventDefault(); goTo(0); }
    if(e.key === "End"){ e.preventDefault(); goTo(SCENES.length - 1); }
  });

  navLinks.forEach(a => a.addEventListener("click", (e) => {
    e.preventDefault();
    closeMenu();
    goTo(+a.dataset.goto);
  }));

  /* ═══════════════ menu ═══════════════ */

  const burger = $("#burger");
  const menu = $("#mobile-menu");
  const closeMenu = () => {
    document.body.classList.remove("menu-open");
    burger.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-hidden", "true");
  };
  burger.addEventListener("click", () => {
    const open = document.body.classList.toggle("menu-open");
    burger.setAttribute("aria-expanded", String(open));
    menu.setAttribute("aria-hidden", String(!open));
  });

  /* ═══════════════ signup (demo) ═══════════════ */

  const form = $("#signup");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#email");
    const note = $("#signup-note");
    if(!input.checkValidity()){
      note.textContent = "That address won’t survive the depths — try again.";
      input.focus();
      return;
    }
    const btn = form.querySelector("button");
    btn.disabled = true;
    btn.querySelector("span").textContent = "Submerging…";
    setTimeout(() => {
      form.classList.add("is-sent");
      note.textContent = `✓ You’re in the tide, ${input.value}. Key incoming.`;
      btn.querySelector("span").textContent = "Requested";
      input.value = "";
    }, 900);
  });

  /* deep link via hash */
  const hashIdx = { "#surface":0, "#descent":1, "#currents":2, "#depths":3, "#emergence":4 }[location.hash];
  if(hashIdx) setTimeout(() => goTo(hashIdx), prefersReduced ? 1200 : 4200);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}

})();
