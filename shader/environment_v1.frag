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

// Focus and blur control (0..1)
uniform float u_focus;    // 0 = front in focus, 1 = back in focus
uniform float u_maxBlur;  // normalized 0..1, scaled inside shader to pixels
uniform float u_debug;    // if >0.5, visualize layer alpha masks for debugging

// Luminance helper
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

// Compute a stylized mask from a layer color. The mask uses luminance and allows
// a threshold + softness to create a paper-cut look. We invert luminance so that
// darker pixels become more opaque by default (useful when foreground art is darker).
// Prefer alpha channel for mask when available; otherwise fall back to luminance-based mask
float layerMask(vec4 samp, float threshold, float softness){
	float a = samp.a;
	// If alpha contains transparency (some pixels < 1.0) we use it as mask.
	// If alpha is effectively fully opaque (>= 0.99) we assume the texture
	// does not provide a meaningful alpha mask and fall back to luminance.
	if(a < 0.99) {
		return a;
	}
	// otherwise fall back to inverted luminance method
	float L = lum(samp.rgb);
	float inv = 1.0 - L; // darker -> closer to 1
	return smoothstep(threshold - softness, threshold + softness, inv);
}

// simple 9-tap blur around uv; radius is in pixels
vec3 blur9(sampler2D tex, vec2 uv, float radius){
	if(radius <= 0.5) return texture2D(tex, uv).rgb;
	vec2 texel = 1.0 / u_resolution;
	vec3 c = vec3(0.0);
	// center heavier weight
	c += texture2D(tex, uv).rgb * 4.0;
	c += texture2D(tex, uv + vec2(texel.x,0.0) * radius).rgb;
	c += texture2D(tex, uv - vec2(texel.x,0.0) * radius).rgb;
	c += texture2D(tex, uv + vec2(0.0,texel.y) * radius).rgb;
	c += texture2D(tex, uv - vec2(0.0,texel.y) * radius).rgb;
	c += texture2D(tex, uv + vec2(texel.x,texel.y) * radius).rgb;
	c += texture2D(tex, uv + vec2(-texel.x,texel.y) * radius).rgb;
	c += texture2D(tex, uv + vec2(texel.x,-texel.y) * radius).rgb;
	c += texture2D(tex, uv + vec2(-texel.x,-texel.y) * radius).rgb;
	return c / 12.0;
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
	float offs4 = -0.08; // background

	// Compute normalized layer indices (0 = front, 4 = back)
	float idx0 = 0.0;
	float idx1 = 1.0;
	float idx2 = 2.0;
	float idx3 = 3.0;
	float idx4 = 4.0;

	// sample layers with blur amount depending on distance from focus
	// Map u_focus (0..1) to layer index space (0..4)
	float focusIdx = mix(0.0, 4.0, clamp(u_focus, 0.0, 1.0));
	float maxRadiusPixels = mix(0.0, 30.0, clamp(u_maxBlur, 0.0, 1.0));

	float d4 = abs(idx4 - focusIdx) / 4.0;
	float d3 = abs(idx3 - focusIdx) / 4.0;
	float d2 = abs(idx2 - focusIdx) / 4.0;
	float d1 = abs(idx1 - focusIdx) / 4.0;
	float d0 = abs(idx0 - focusIdx) / 4.0;

	float r0 = d0 * maxRadiusPixels;
	float r1 = d1 * maxRadiusPixels;
	float r2 = d2 * maxRadiusPixels;
	float r3 = d3 * maxRadiusPixels;
	float r4 = d4 * maxRadiusPixels;

	// Also sample raw (non-blurred) textures to obtain reliable alpha for masking
	vec4 s0_raw = texture2D(u_tex0, uv);
	vec4 s1_raw = texture2D(u_tex1, uv);
	vec4 s2_raw = texture2D(u_tex2, uv);
	vec4 s3_raw = texture2D(u_tex3, uv);
	vec4 s4_raw = texture2D(u_tex4, uv);

	vec3 c0 = blur9(u_tex0, uv, r0);
	vec3 c1 = blur9(u_tex1, uv, r1);
	vec3 c2 = blur9(u_tex2, uv, r2);
	vec3 c3 = blur9(u_tex3, uv, r3);
	vec3 c4 = blur9(u_tex4, uv, r4);

	// background starts as last texture
	vec3 outCol = c4;

	// Debug: visualize alpha masks (R=layer0, G=layer1, B=layer2)
	if(u_debug > 0.5) {
		vec3 dbg = vec3(s0_raw.a, s1_raw.a, s2_raw.a);
		gl_FragColor = vec4(dbg, 1.0);
		return;
	}

	// composite back-to-front (so front overlays on top)
	float a3 = layerMask(s3_raw, baseThreshold + offs3, baseSoftness);
	outCol = mix(outCol, c3, a3);

	float a2 = layerMask(s2_raw, baseThreshold + offs2, baseSoftness);
	outCol = mix(outCol, c2, a2);

	float a1 = layerMask(s1_raw, baseThreshold + offs1, baseSoftness);
	outCol = mix(outCol, c1, a1);

	float a0 = layerMask(s0_raw, baseThreshold + offs0, baseSoftness);
	outCol = mix(outCol, c0, a0);

	gl_FragColor = vec4(outCol, 1.0);
}

