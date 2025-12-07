// NATO 3-Colors Camouflage (approximation)
// Static layered blobs: Green base, Brown overlays, Black top overlays

#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;      // canvas size
uniform float u_scale;          // pattern scale
uniform float u_gridRotate;     // rotation in degrees
uniform float u_thresh1;        // coverage threshold for Black (top)
uniform float u_thresh2;        // coverage threshold for Brown (mid)
uniform float u_edgeCurve;      // 0..1: edge curvature/roundness control

// Palette: NATO-like tri-tone (user-specified)
// Black (#322422), Brown (#805739), Green (#506635)
const vec3 COL_DARK   = vec3( 28.0/255.0,  34.0/255.0,  46.0/255.0); // black (darkest)
const vec3 COL_MID    = vec3(96.0/255.0,  68.0/255.0,  57.0/255.0); // brown (mid)
const vec3 COL_LIGHT  = vec3( 65.0/255.0, 83.0/255.0,  59.0/255.0); // green (lightest)

mat2 rot(float a){
  float s = sin(a), c = cos(a);
  return mat2(c,-s,s,c);
}

// Hash -> Smooth value noise -> fbm with domain warp (rounded blobs)
float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  // quintic interpolation for extra smoothness -> rounder contours
  vec2 u = f*f*f*(f*(f*6.0 - 15.0) + 10.0);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p){
  float v = 0.0;
  float a = 0.6;
  // Band-limited: fewer octaves to avoid filamentary details
  for(int i=0;i<3;i++){
    v += a * noise(p);
    // domain warp to encourage rounded, curvy islands
    vec2 w = vec2(sin(p.y*0.8), cos(p.x*0.8)) * 0.28;
    p = (p + w) * 1.60 + vec2(2.2, -1.9);
    a *= 0.42;
  }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  // Apply rotation + scale (static; no time)
  uv = rot(radians(u_gridRotate)) * (uv * u_scale * 5.0);

  // Generate two independent blob fields for brown and black
  // Brown: larger blobs, lower frequency (rounded by warp).
  // Apply small-kernel averaging to further smooth/round contours.
  // Edge curvature control: 0..1, with extended effect beyond linear range
  float ecRaw = clamp(u_edgeCurve, 0.0, 1.0);
  float factor = 1.0 + 3.0 * ecRaw; // up to 4x
  float kScaleB = 0.50 + 0.12 * ecRaw; // 0.50..0.62
  float kScaleK = 0.98 + 0.16 * ecRaw; // 0.98..1.14
  float offsB = 0.010 * factor * 1.5;  // ~0.015..0.060
  float offsK = 0.010 * factor * 1.6;  // ~0.016..0.064
  float wB    = 0.018 * factor * 1.2;  // ~0.0216..0.0864
  float wK    = 0.022 * factor * 1.2;  // ~0.0264..0.1056

  vec2 buv = uv * (kScaleB * 0.95);
  float b0 = fbm(buv);
  float b1 = fbm(buv + vec2( 1.1*offsB,  0.7*offsB));
  float b2 = fbm(buv + vec2(-1.1*offsB, -0.7*offsB));
  float b3 = fbm(buv + vec2( 0.7*offsB, -1.1*offsB));
  float b4 = fbm(buv + vec2(-0.7*offsB,  1.1*offsB));
  float b5 = fbm(buv + vec2( 1.4*offsB, -0.4*offsB));
  float b6 = fbm(buv + vec2(-1.4*offsB,  0.4*offsB));
  float b7 = fbm(buv + vec2( 0.5*offsB,  1.3*offsB));
  float b8 = fbm(buv + vec2(-0.5*offsB, -1.3*offsB));
  float bField = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + b7 + b8) / 9.0;
  // Black: use band-limited, smoothed field to reduce jaggedness
  vec2 kuv = uv * (kScaleK * 0.92) + vec2(bField * 0.55, -bField * 0.42);
  // sample a larger kernel and average to further smooth black contours
  float k0 = fbm(kuv);
  float k1 = fbm(kuv + vec2( 1.0*offsK,  0.6*offsK));
  float k2 = fbm(kuv + vec2(-1.0*offsK, -0.6*offsK));
  float k3 = fbm(kuv + vec2( 0.6*offsK, -1.0*offsK));
  float k4 = fbm(kuv + vec2(-0.6*offsK,  1.0*offsK));
  float k5 = fbm(kuv + vec2( 1.3*offsK, -0.4*offsK));
  float k6 = fbm(kuv + vec2(-1.3*offsK,  0.4*offsK));
  float k7 = fbm(kuv + vec2( 0.5*offsK,  1.2*offsK));
  float k8 = fbm(kuv + vec2(-0.5*offsK, -1.2*offsK));
  float k9 = fbm(kuv + vec2( 1.6*offsK,  0.0));
  float k10= fbm(kuv + vec2(-1.6*offsK,  0.0));
  float kField = (k0 + k1 + k2 + k3 + k4 + k5 + k6 + k7 + k8 + k9 + k10) / 11.0;

  // Thresholds as coverage controls (higher -> less coverage)
  float tBlack = clamp(u_thresh1, 0.0, 1.0);
  float tBrown = clamp(u_thresh2, 0.0, 1.0);

  // Convert fields to masks; use narrow smoothstep for curved but crisp edges
  // Additional band-limit remap to suppress thread-like edges
  float bFieldBL = clamp(bField*0.90 + 0.05, 0.0, 1.0);
  float kFieldBL = clamp(kField*0.88 + 0.06, 0.0, 1.0);
  float brownMask = smoothstep(tBrown, tBrown + wB, bFieldBL);
  float blackMask = smoothstep(tBlack, tBlack + wK, kFieldBL);

  // Layering: start with green base, overlay brown, then black
  vec3 color = COL_LIGHT;
  color = mix(color, COL_MID, brownMask);
  color = mix(color, COL_DARK, blackMask);

  gl_FragColor = vec4(color, 1.0);
}
