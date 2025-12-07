// NATO 3-Colors Camouflage (approximation)
// Procedural GLSL fragment shader using multi-scale digital noise
// Three-tone palette mapping via thresholds

#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;       // density/scale
uniform float u_gridRotate;  // rotation in degrees
uniform float u_thresh1;     // first threshold
uniform float u_thresh2;     // second threshold

// Palette: simple NATO-like tri-tone (adjust as needed)
const vec3 COL_DARK   = vec3( 40.0/255.0,  54.0/255.0,  35.0/255.0); // dark green
const vec3 COL_MID    = vec3(120.0/255.0,  96.0/255.0,  64.0/255.0); // brown/khaki
const vec3 COL_LIGHT  = vec3(196.0/255.0, 188.0/255.0, 170.0/255.0); // light tan

mat2 rot(float a){
  float s = sin(a), c = cos(a);
  return mat2(c,-s,s,c);
}

float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float digitalNoise(vec2 uv, float scale){
  vec2 grid = floor(uv * scale);
  return vnoise(grid * 0.37);
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  uv = rot(radians(u_gridRotate)) * (uv * u_scale * 10.0);

  float n = 0.0;
  n += digitalNoise(uv, 7.0);
  n += 0.6 * digitalNoise(uv + 9.0, 14.0);
  n += 0.3 * digitalNoise(uv - 17.0, 28.0);
  n /= 1.9;

  float t1 = clamp(u_thresh1, 0.0, 1.0);
  float t2 = clamp(u_thresh2, 0.0, 1.0);
  t2 = max(t2, t1);

  vec3 color;
  if(n < t1)      color = COL_DARK;
  else if(n < t2) color = COL_MID;
  else            color = COL_LIGHT;

  gl_FragColor = vec4(color, 1.0);
}// Taiwan DCCU Digital Camouflage (approximation)
// Procedural GLSL fragment shader generating multi-scale pixel blocks
// Colors and proportions tuned to resemble Taiwan DCCU (green-gray tones)

#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;      // canvas size in pixels
uniform float u_time;           // animation time (optional)
uniform vec2 u_mouseCustom;     // from app, not required for pattern
// Optional reference texture to match NWU Type I swatch
uniform sampler2D u_refTex;
uniform float u_useRef;         // 1.0 = use reference texture sampling

// Tunables
uniform float u_scale;          // overall scale of pattern (default ~1.0)
// uniform float u_noiseAmp;    // deprecated: removed from UI
uniform float u_edgeSoftness;   // not used heavily (digital sharp edges)
uniform float u_gridRotate;     // slight rotation to break repetition
uniform float u_cellBase;       // base cell size in pixels (preview space)
// Distribution thresholds (cumulative):
// n < u_thresh1 → COL_D; n < u_thresh2 → COL_B; n < u_thresh3 → COL_C; else → COL_A
uniform float u_thresh1;        // default ~0.25
uniform float u_thresh2;        // default ~0.45
uniform float u_thresh3;        // default ~0.70

// Taiwan DCCU palette (sRGB normalized)
// Updated RGBs: (139,151,96), (23,36,51), (89,118,99), (222,238,230)
// Mapping: A = light, B = mid, C = dark, D = deepest
const vec3 COL_A = vec3(222.0/255.0, 238.0/255.0, 230.0/255.0); // light
const vec3 COL_B = vec3( 89.0/255.0, 118.0/255.0,  99.0/255.0); // mid
const vec3 COL_C = vec3(139.0/255.0, 151.0/255.0,  96.0/255.0); // dark
const vec3 COL_D = vec3( 23.0/255.0,  36.0/255.0,  51.0/255.0); // deepest

// ---- Hash helpers ----
float hash11(float n){
  return fract(sin(n)*43758.5453123);
}
vec2 hash22(vec2 p){
  float n = sin(dot(p, vec2(41.3, 289.1)));
  return fract(vec2(262144.0*n, 32768.0*n));
}

// ---- Rotations ----
mat2 rot(float a){
  float s = sin(a), c = cos(a);
  return mat2(c,-s,s,c);
}

// ---- Hash ----
float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// ---- Value noise ----
float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

// ---- fBm ----
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<5;i++){
    s += a*vnoise(p);
    p = p*2.02 + vec2(3.1, -2.7);
    a *= 0.5;
  }
  return s;
}

// ---- Digital pixel-style noise (reference-inspired) ----
float digitalNoise(vec2 uv, float scale){
  vec2 grid = floor(uv * scale);
  return vnoise(grid * 0.37);
}
void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  // Apply gentle rotation + scale
  uv = (rot(radians(u_gridRotate)) * (uv * u_scale * 10.0));

  // Stack multi-scale digital noise layers (reference-inspired)
  float n = 0.0;
  n += digitalNoise(uv, 8.0);
  n += 0.5 * digitalNoise(uv + 10.0, 16.0);
  n += 0.25 * digitalNoise(uv - 20.0, 32.0);
  n /= 1.75;

  // Map noise value to Taiwan DCCU palette using adjustable thresholds
  vec3 color;
  float t1 = clamp(u_thresh1, 0.0, 1.0);
  float t2 = clamp(u_thresh2, 0.0, 1.0);
  float t3 = clamp(u_thresh3, 0.0, 1.0);
  // enforce cumulative ordering
  t2 = max(t2, t1);
  t3 = max(t3, t2);
  if(n < t1)        color = COL_D; // deepest tone
  else if(n < t2)   color = COL_B; // dark tone
  else if(n < t3)   color = COL_C; // mid tone
  else              color = COL_A; // light tone

  // Note: Disable micro brightness modulation to avoid palette shift.
  // Keeping exact output to provided swatch colors.

  gl_FragColor = vec4(color, 1.0);
}
