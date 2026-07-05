// webgl.js — Failure× "ink-in-water" WebGL layer (Three.js)
// Three sub-scenes share one shader family:
//   1. #fluid        — fixed full-screen background (scroll + mouse reactive)
//   2. #mediaCanvas  — calm looping poster inside the media section
//   3. #trailerCanvas— the "weld" trailer, started/stopped by the modal
//
// Every layer degrades gracefully: if Three fails to import, WebGL is
// unsupported, or the user prefers reduced motion, we render at most one
// static frame (or nothing) and the CSS gradient scrim carries the look.

let THREE;
try {
  THREE = await import('three');
} catch (err) {
  console.warn('[failure] Three.js unavailable — falling back to CSS background.', err);
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = window.matchMedia('(max-width: 860px)').matches;

/* ------------------------------------------------------------------ */
/* Shared GLSL                                                          */
/* ------------------------------------------------------------------ */

const VERT = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Ashima 2D simplex noise + fbm with domain warping.
const NOISE = /* glsl */`
  vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec2 mod289(vec2 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }
  float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0))
                            + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for(int i=0;i<5;i++){ v += a * snoise(p); p *= 2.02; a *= 0.5; }
    return v;
  }
`;

/* ------------------------------------------------------------------ */
/* Background fluid shader                                              */
/* ------------------------------------------------------------------ */

const FLUID_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform vec2  uRes;
  uniform float uTime;
  uniform float uScroll;   // 0..1 page progress
  uniform vec2  uMouse;    // 0..1 pointer
  uniform float uMouseAmt; // decaying ripple strength
  ${NOISE}

  void main(){
    vec2 uv = vUv;
    float aspect = uRes.x / max(uRes.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

    // gentle drift + scroll pulls the current downward as you descend
    float t = uTime * 0.045;
    p.y += uScroll * 0.55;

    // mouse ripple: warp UVs radially around the pointer ("through water")
    vec2 m = vec2((uMouse.x - 0.5) * aspect, uMouse.y - 0.5);
    float md = distance(p, m);
    float ripple = sin(md * 22.0 - uTime * 3.0) * exp(-md * 5.0) * uMouseAmt;
    p += normalize(p - m + 1e-4) * ripple * 0.06;

    // domain-warped fbm -> flowing ink tendrils
    vec2 q = vec2(fbm(p*1.6 + vec2(0.0, t)),
                  fbm(p*1.6 + vec2(5.2, -t*1.3)));
    vec2 r = vec2(fbm(p*1.6 + 3.0*q + vec2(1.7, 9.2) + t*0.6),
                  fbm(p*1.6 + 3.0*q + vec2(8.3, 2.8) - t*0.5));
    float f = fbm(p*1.6 + 2.4*r);
    f = f * 0.5 + 0.5;

    // base ink -> lighter tendrils
    vec3 ink   = vec3(0.031, 0.039, 0.051);
    vec3 mid   = vec3(0.086, 0.102, 0.121);
    vec3 col = mix(ink, mid, smoothstep(0.35, 0.85, f));

    // faint chroma in the depths (plum / peacock / signal glints)
    float c = fbm(r*2.0 + t);
    col += vec3(0.11,0.05,0.14) * smoothstep(0.55,0.95,c) * 0.30;          // plum
    col += vec3(0.02,0.10,0.14) * smoothstep(0.60,1.0, f) * 0.22;          // peacock
    col += vec3(0.14,0.03,0.02) * smoothstep(0.82,1.0, length(r)) * 0.18;  // signal

    // glowing liquid reveal edge — a band that rides scroll (the torn edge)
    float thresh = mix(0.30, 0.78, fract(uScroll*1.3));
    float edge = 1.0 - smoothstep(0.0, 0.045, abs(f - thresh));
    col += vec3(0.90,0.72,0.34) * edge * 0.16;

    // mouse highlight bloom
    col += vec3(0.90,0.72,0.34) * exp(-md*4.0) * uMouseAmt * 0.12;

    // vignette so DOM content sits in calmer water
    float vig = smoothstep(1.15, 0.25, length(vec2((uv.x-0.5)*aspect, uv.y-0.5)));
    col *= mix(0.72, 1.05, vig);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const TRAILER_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform vec2  uRes;
  uniform float uTime;
  ${NOISE}

  void main(){
    vec2 uv = vUv;
    float aspect = uRes.x / max(uRes.y,1.0);
    vec2 p = vec2((uv.x-0.5)*aspect, uv.y-0.5);
    float t = uTime * 0.18;

    // four parent "currents" converging toward the weld at center
    float acc = 0.0;
    for(int i=0;i<4;i++){
      float fi = float(i);
      float y = -0.32 + fi*0.21;
      vec2 src = vec2(-aspect*0.5, y);
      vec2 dir = normalize(vec2(0.0,0.0) - src);
      float along = dot(p - src, dir);
      float perp  = length((p - src) - dir*along);
      float flow  = sin(along*10.0 - t*6.0 + fi*1.7);
      acc += smoothstep(0.06, 0.0, perp) * (0.5+0.5*flow) * smoothstep(0.0,0.4,along);
    }

    // weld core pulse at center
    float core = exp(-length(p)*7.0) * (0.7 + 0.3*sin(t*8.0));

    // turbulence overlay
    float f = fbm(p*3.0 + vec2(t, -t)) * 0.5 + 0.5;

    vec3 col = vec3(0.031,0.039,0.051);
    col = mix(col, vec3(0.09,0.10,0.12), f*0.6);
    col += vec3(0.90,0.72,0.34) * acc * 0.8;       // straw currents
    col += vec3(1.0,0.95,0.85)  * core;            // white-hot weld
    col += vec3(0.66,0.28,0.17) * acc * 0.25;      // bronze edge

    gl_FragColor = vec4(col, 1.0);
  }
`;

/* ------------------------------------------------------------------ */
/* ShaderScene — a single full-canvas shader quad                      */
/* ------------------------------------------------------------------ */

class ShaderScene {
  constructor(canvas, frag, { extraUniforms = {}, loop = true } = {}) {
    this.canvas = canvas;
    this.loop = loop;
    this.running = false;
    this.raf = 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.5));

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.clock = new THREE.Clock();

    this.uniforms = Object.assign({
      uTime: { value: 0 },
      uRes:  { value: new THREE.Vector2(1, 1) },
    }, extraUniforms);

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: frag, uniforms: this.uniforms, depthTest: false, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.scene.add(this.mesh);

    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize, { passive: true });
  }

  resize() {
    const w = this.canvas.clientWidth || this.canvas.offsetWidth || window.innerWidth;
    const h = this.canvas.clientHeight || this.canvas.offsetHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.uniforms.uRes.value.set(w, h);
    this.renderOnce();
  }

  renderOnce() {
    this.uniforms.uTime.value = this.clock.getElapsedTime();
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    if (this.running || reduceMotion || !this.loop) { this.renderOnce(); return; }
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.renderOnce();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.renderer.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Wire up the three canvases                                           */
/* ------------------------------------------------------------------ */

const fluidCanvas   = document.getElementById('fluid');
const mediaCanvas   = document.getElementById('mediaCanvas');
const trailerCanvas = document.getElementById('trailerCanvas');

function noWebGL() {
  // Hide the (blank) background canvas so the CSS scrim shows cleanly.
  if (fluidCanvas) fluidCanvas.style.display = 'none';
}

if (!THREE) {
  noWebGL();
} else {
  let fluid = null, media = null, trailer = null;

  /* ---- background fluid ---- */
  if (fluidCanvas) {
    try {
      fluid = new ShaderScene(fluidCanvas, FLUID_FRAG, {
        extraUniforms: {
          uScroll:   { value: 0 },
          uMouse:    { value: new THREE.Vector2(0.5, 0.5) },
          uMouseAmt: { value: 0 },
        },
      });

      // pointer ripple: lerp toward target, strength decays each frame
      const target = new THREE.Vector2(0.5, 0.5);
      let amt = 0;
      const onMove = (x, y) => {
        target.set(x / window.innerWidth, 1 - y / window.innerHeight);
        amt = 1;
      };
      window.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY), { passive: true });
      window.addEventListener('touchmove', (e) => {
        if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: true });

      const u = fluid.uniforms;
      const origRender = fluid.renderOnce.bind(fluid);
      fluid.renderOnce = () => {
        u.uMouse.value.lerp(target, 0.08);
        amt *= 0.94;
        u.uMouseAmt.value = amt;
        origRender();
      };

      // scroll progress feed (also polled here so it works without GSAP)
      const setScroll = (v) => { u.uScroll.value = v; if (!fluid.running) fluid.renderOnce(); };
      const pollScroll = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setScroll(max > 0 ? window.scrollY / max : 0);
      };
      window.addEventListener('scroll', pollScroll, { passive: true });
      pollScroll();

      // expose for app.js / GSAP
      window.__fluid = { setScroll, scene: fluid };

      // pause when tab hidden
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) fluid.stop(); else fluid.start();
      });

      fluid.start();
    } catch (err) {
      console.warn('[failure] fluid init failed', err);
      noWebGL();
    }
  }

  /* ---- media poster (only animates while on screen) ---- */
  if (mediaCanvas) {
    try {
      media = new ShaderScene(mediaCanvas, TRAILER_FRAG);
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => en.isIntersecting ? media.start() : media.stop());
      }, { threshold: 0.05 });
      io.observe(mediaCanvas);
    } catch (err) { console.warn('[failure] media canvas failed', err); }
  }

  /* ---- trailer (driven by the modal) ---- */
  window.__trailer = {
    start() {
      if (!trailerCanvas) return;
      try {
        if (!trailer) trailer = new ShaderScene(trailerCanvas, TRAILER_FRAG);
        trailer.resize();
        trailer.start();
      } catch (err) { console.warn('[failure] trailer failed', err); }
    },
    stop() { if (trailer) trailer.stop(); },
  };
}
