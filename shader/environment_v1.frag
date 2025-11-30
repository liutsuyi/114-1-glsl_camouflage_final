// Author: tsuyi
// Title: environment_v1.frag
// Purpose: Composite up to 5 textures (front -> back) into a paper-cutting style scene.
// Usage notes:
// - Provide five images in `index.html` via `data-textures="data/fg.png,data/layer2.png,data/layer3.png,data/layer4.png,data/bg.png"`
//   The order is FRONT -> ... -> BACK (u_tex0 is the first/foreground).
// - Mouse X controls mask threshold (left = tighter cut, right = more filled).
// - Mouse Y controls mask softness (bottom = sharp cut, top = softer blend).

#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_time;

// Textures: u_tex0 is front-most, u_tex4 is background (last)
uniform sampler2D u_tex0;
uniform sampler2D u_tex1;
uniform sampler2D u_tex2;
uniform sampler2D u_tex3;
uniform sampler2D u_tex4;

// Luminance helper
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

// Compute a stylized mask from a layer color. The mask uses luminance and allows
// a threshold + softness to create a paper-cut look. We invert luminance so that
// darker pixels become more opaque by default (useful when foreground art is darker).
float layerMask(vec3 col, float threshold, float softness){
	float L = lum(col);
	float inv = 1.0 - L; // darker -> closer to 1
	return smoothstep(threshold - softness, threshold + softness, inv);
}

void main(){
	vec2 uv = gl_FragCoord.xy / u_resolution.xy;

	// interactive controls via mouse
	float mx = clamp(u_mouse.x / u_resolution.x, 0.0, 1.0);
	float my = clamp(u_mouse.y / u_resolution.y, 0.0, 1.0);
	// base threshold and softness derived from mouse position
	float baseThreshold = mix(0.35, 0.7, mx); // left -> small threshold, right -> larger fill
	float baseSoftness = mix(0.02, 0.18, my);

	// per-layer offset so each layer can have slightly different cut
	float offs0 = 0.00; // front
	float offs1 = -0.02;
	float offs2 = -0.04;
	float offs3 = -0.06;
	float offs4 = -0.08; // background (usually kept filled)

	// sample layers (assume they all have same UV layout)
	vec3 c0 = texture2D(u_tex0, uv).rgb;
	vec3 c1 = texture2D(u_tex1, uv).rgb;
	vec3 c2 = texture2D(u_tex2, uv).rgb;
	vec3 c3 = texture2D(u_tex3, uv).rgb;
	vec3 c4 = texture2D(u_tex4, uv).rgb;

	// background starts as last texture
	vec3 outCol = c4;

	// composite back-to-front (so front overlays on top)
	float a3 = layerMask(c3, baseThreshold + offs3, baseSoftness);
	outCol = mix(outCol, c3, a3);

	float a2 = layerMask(c2, baseThreshold + offs2, baseSoftness);
	outCol = mix(outCol, c2, a2);

	float a1 = layerMask(c1, baseThreshold + offs1, baseSoftness);
	outCol = mix(outCol, c1, a1);

	float a0 = layerMask(c0, baseThreshold + offs0, baseSoftness);
	outCol = mix(outCol, c0, a0);

	gl_FragColor = vec4(outCol, 1.0);
}

