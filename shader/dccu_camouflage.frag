// Taiwanese Army DCCU Camouflage (approximation)
// Procedural GLSL fragment shader generating multi-scale blotches
// Colors and proportions tuned to resemble DCCU woodland scheme

precision highp float;

uniform vec2 u_resolution;      // canvas size in pixels
uniform float u_time;           // animation time (optional)
uniform vec2 u_mouseCustom;     // from app, not required for pattern

// Tunables
uniform float u_scale;          // overall scale of pattern (default ~1.0)
uniform float u_noiseAmp;       // noise amplitude for edge jitter
uniform float u_edgeSoftness;   // feather for patch edges (pixels)
uniform float u_gridRotate;     // slight rotation to break repetition

// DCCU palette (approx values in sRGB)
const vec3 COL_LIGHT_GREEN = vec3(0.42, 0.56, 0.38); // light olive green
const vec3 COL_DARK_GREEN  = vec3(0.17, 0.28, 0.20); // dark forest green
const vec3 COL_BROWN       = vec3(0.36, 0.26, 0.20); // earth brown
const vec3 COL_BLACK       = vec3(0.07, 0.07, 0.07); // near black

// Hash helpers
float hash11(float n){
  return fract(sin(n)*43758.5453123);
}
vec2 hash22(vec2 p){
  float n = sin(dot(p, vec2(41.3, 289.1)));
  return fract(vec2(262144.0*n, 32768.0*n));
}

// Rotations
mat2 rot(float a){
  float s = sin(a), c = cos(a);
  return mat2(c,-s,s,c);
}

// Value noise
float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = hash11(dot(i, vec2(1.0,57.0)));
  float b = hash11(dot(i+vec2(1.,0.), vec2(1.0,57.0)));
  float c = hash11(dot(i+vec2(0.,1.), vec2(1.0,57.0)));
  float d = hash11(dot(i+vec2(1.,1.), vec2(1.0,57.0)));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

// fBm
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<5;i++){
    s += a*vnoise(p);
    p = p*2.02 + vec2(3.1, -2.7);
    a *= 0.5;
  }
  return s;
}

// Blotch field: combine multiple scales with jitter
float blotchField(vec2 p){
  float f1 = fbm(p*0.6);
  float f2 = fbm(p*1.2 + 11.3);
  float f3 = fbm(p*2.4 - 7.1);
  return (0.55*f1 + 0.3*f2 + 0.15*f3);
}

// Voronoi-like patch domains to get discrete islands
float cellDist(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float md = 1.0;
  for(int y=-1;y<=1;y++){
    for(int x=-1;x<=1;x++){
      vec2 o = vec2(float(x), float(y));
      vec2 r = hash22(i+o) - 0.5;
      vec2 pt = o + r;
      float d = length(f-pt);
      md = min(md, d);
    }
  }
  return md;
}

// Patch selector: map layered fields to discrete palette indices
int chooseLayer(vec2 p){
  float domain = cellDist(p*0.8);
  float field  = blotchField(p);
  float jitter = vnoise(p*3.1);
  float v = 0.55*field + 0.25*jitter + 0.2*domain;
  // Threshold bands typical of DCCU ratio
  if(v < 0.30) return 0;            // dark green
  else if(v < 0.55) return 1;       // light green
  else if(v < 0.78) return 2;       // brown
  else return 3;                    // black
}

// Soft edge mask to create organic transitions
float edgeMask(vec2 p){
  float e = blotchField(p*1.7);
  return smoothstep(0.35, 0.65, e);
}

vec3 palette(int idx){
  if(idx==0) return COL_DARK_GREEN;
  if(idx==1) return COL_LIGHT_GREEN;
  if(idx==2) return COL_BROWN;
  return COL_BLACK;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  // Normalize to square for pattern uniformity
  vec2 p = (gl_FragCoord.xy / max(u_resolution.x, u_resolution.y));
  // Apply overall scale and gentle rotation to avoid directional bias
  float sc = (u_scale <= 0.0) ? 1.0 : u_scale;
  p *= 12.0 * sc; // base tiling density
  p = rot(radians(u_gridRotate))*p;

  // Edge noise to jitter boundaries
  float n = fbm(p*2.7);
  p += u_noiseAmp * (n-0.5);

  int idx = chooseLayer(p);
  vec3 col = palette(idx);

  // Soft transitions between patches
  float m = edgeMask(p);
  // Blend with neighboring color by shifting domain
  int idx2 = chooseLayer(p + vec2(0.35, -0.22));
  vec3 col2 = palette(idx2);
  col = mix(col, col2, m*0.35);

  // Optional micro speckle to emulate textile printing variation
  float speck = vnoise(p*9.0);
  col *= mix(0.98, 1.02, speck);

  // Output
  gl_FragColor = vec4(col, 1.0);
}
