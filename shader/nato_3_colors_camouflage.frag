// NATO 3-Colors Camouflage (approximation)
// Static pattern: hash → value noise → fbm, 3-tone thresholds

#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;      // canvas size
uniform float u_scale;          // pattern scale
uniform float u_gridRotate;     // rotation in degrees
uniform float u_thresh1;        // threshold for darkest
uniform float u_thresh2;        // threshold for mid

// Palette: NATO-like tri-tone (user-specified)
// Black (#322422), Brown (#805739), Green (#506635)
const vec3 COL_DARK   = vec3( 28.0/255.0,  34.0/255.0,  46.0/255.0); // black (darkest)
const vec3 COL_MID    = vec3(96.0/255.0,  68.0/255.0,  57.0/255.0); // brown (mid)
const vec3 COL_LIGHT  = vec3( 65.0/255.0, 83.0/255.0,  59.0/255.0); // green (lightest)

mat2 rot(float a){
  float s = sin(a), c = cos(a);
  return mat2(c,-s,s,c);
}

// Hash -> Value noise -> fbm
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

float fbm(vec2 p){
  float v = 0.0;
  float a = 0.5;
  for(int i=0;i<5;i++){
    v += a * vnoise(p);
    p = p*2.02 + vec2(3.1, -2.7);
    a *= 0.5;
  }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  // Apply rotation + scale (static; no time)
  uv = rot(radians(u_gridRotate)) * (uv * u_scale * 5.0);
  float n = fbm(uv);

  float t1 = clamp(u_thresh1, 0.0, 1.0);
  float t2 = clamp(u_thresh2, 0.0, 1.0);
  t2 = max(t2, t1);

  vec3 color;
  if(n < t1)      color = COL_DARK;  // darkest
  else if(n < t2) color = COL_MID;   // mid
  else            color = COL_LIGHT; // light

  gl_FragColor = vec4(color, 1.0);
}
