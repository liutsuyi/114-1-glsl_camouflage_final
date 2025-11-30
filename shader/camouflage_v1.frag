// Author:CMH
//update:tsuyi
// Title:20220321_glsl GlassDistortion_v2(normal).qtz 

#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_time;
uniform sampler2D u_tex0; //import picture
//uniform sampler2D u_tex1;

// Cellular noise ("Worley noise") in 2D in GLSL.
// Copyright (c) Stefan Gustavson 2011-04-19. All rights reserved.
// This code is released under the conditions of the MIT license.
// See LICENSE file for details.



// Permutation polynomial: (34x^2 + x) mod 289
vec3 permute(vec3 x) {
  return mod((34.0 * x + 1.0) * x, 289.0);
}
#define K 0.142857142857 // 1/7
#define Ko 0.428571428571 // 3/7

vec2 cellularID(vec2 P) {

    // === 新增：由滑鼠 X 方向控制 jitter ===
    float mouseX = u_mouse.x / u_resolution.x;  
    float jit = mix(0.1, 1.6, mouseX); 
    // 左 → 斑塊邊界更整齊 / 右 → 更有機更自然
    // 你可以改範圍來控制效果強度

    float distFormula=0.0;
    vec2 Pi = mod(floor(P), 289.0);
    vec2 Pf = fract(P);
    vec3 oi = vec3(-1.0, 0.0, 1.0);
    vec3 of = vec3(-0.5, 0.5, 1.5);
    vec3 px = permute(Pi.x + oi);
    vec3 p = permute(px.x + Pi.y + oi); 
    vec3 ox = fract(p*K) - Ko;
    vec3 oy = mod(floor(p*K),7.0)*K - Ko;
    vec3 dx = Pf.x + 0.5 + jit*ox;   // ★ jitter 控制扭曲
    vec3 dy = Pf.y - of + jit*oy;   // ★ jitter 控制扭曲
    vec3 d1 = mix(dx * dx + dy * dy, abs(dx) + abs(dy), distFormula);

    p = permute(px.y + Pi.y + oi);
    ox = fract(p*K) - Ko;
    oy = mod(floor(p*K),7.0)*K - Ko;
    dx = Pf.x - 0.5 + jit*ox;
    dy = Pf.y - of + jit*oy;
    vec3 d2 = mix(dx * dx + dy * dy, abs(dx) + abs(dy), distFormula);

    p = permute(px.z + Pi.y + oi);
    ox = fract(p*K) - Ko;
    oy = mod(floor(p*K),7.0)*K - Ko;
    dx = Pf.x - 1.5 + jit*ox;
    dy = Pf.y - of + jit*oy;
    vec3 d3 = mix(dx * dx + dy * dy, abs(dx) + abs(dy), distFormula);
  
    float f1 = d1.x;
    vec2 ci = vec2(Pi.x - 1.0, Pi.y - 1.0);
    if (d1.y < f1) { f1 = d1.y; ci = vec2(Pi.x - 1.0, Pi.y); }
    if (d1.z < f1) { f1 = d1.z; ci = vec2(Pi.x - 1.0, Pi.y + 1.0); }
    if (d2.x < f1) { f1 = d2.x; ci = vec2(Pi.x      , Pi.y - 1.0); }
    if (d2.y < f1) { f1 = d2.y; ci = vec2(Pi.x      , Pi.y); }
    if (d2.z < f1) { f1 = d2.z; ci = vec2(Pi.x      , Pi.y + 1.0); }
    if (d3.x < f1) { f1 = d3.x; ci = vec2(Pi.x + 1.0, Pi.y - 1.0); }
    if (d3.y < f1) { f1 = d3.y; ci = vec2(Pi.x + 1.0, Pi.y); }
    if (d3.z < f1) { f1 = d3.z; ci = vec2(Pi.x + 1.0, Pi.y + 1.0); }

    return mod(ci, 289.0);
}




float mouseEffect(vec2 uv, vec2 mouse, float size)
{
    float dist=length(uv-mouse);
    return 1.2-smoothstep(size*1.9, size, dist);  //size
    //return pow(dist, 0.5);
}

void main() {
    vec2 st = gl_FragCoord.xy / u_resolution.xy;
    vec2 mouse = u_mouse / u_resolution;

    // 基本尺度由滑鼠控制
    float baseScale = mix(20.0, 200.0, mouse.y);

    // 定義三個層級 (大 → 中 → 小)
    float scaleBig   = baseScale * 0.6;
    float scaleMid   = baseScale * 1.0;
    float scaleSmall = baseScale * 2.0;

    // 先用中尺度採樣一次來判斷亮度（相當於找出該點「屬於哪種斑塊」）
    vec2 uvMid = cellularID(st * scaleMid) / scaleMid;
    vec3 cMid = texture2D(u_tex0, uvMid).rgb;
    float b = dot(cMid, vec3(0.299, 0.587, 0.114)); // 亮度

    vec3 result;

    // 依亮度決定採樣層級
    if (b < 0.33) {
        // 暗 → 大塊
        vec2 uv = cellularID(st * scaleBig) / scaleBig;
        result = texture2D(u_tex0, uv).rgb;
    }
    else if (b < 0.66) {
        // 中亮度 → 中塊
        result = cMid;
    }
    else {
        // 亮 → 小塊
        vec2 uv = cellularID(st * scaleSmall) / scaleSmall;
        result = texture2D(u_tex0, uv).rgb;
    }

    gl_FragColor = vec4(result, 1.0);
}