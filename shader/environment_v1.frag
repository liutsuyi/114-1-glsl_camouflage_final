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
uniform float u_time;

// Textures: u_tex0 is front-most, u_tex4 is background (last)
uniform sampler2D u_tex0;
uniform sampler2D u_tex1;
uniform sampler2D u_tex2;
uniform sampler2D u_tex3;
uniform sampler2D u_tex4;
uniform sampler2D u_tex5;

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

// Disk-like multi-sample blur (~16 samples) for more uniform, circular bokeh.
// radius is in pixels. This samples points on a circle and averages them.
vec3 blurDisk(sampler2D tex, vec2 uv, float radius){
	if(radius <= 0.5) return texture2D(tex, uv).rgb;
	vec2 t = 1.0 / u_resolution;
	// 16 sample offsets (angles around circle), scaled by radius
	vec2 o1  = vec2( 1.000,  0.000) * t * radius;
	vec2 o2  = vec2( 0.923,  0.383) * t * radius;
	vec2 o3  = vec2( 0.707,  0.707) * t * radius;
	vec2 o4  = vec2( 0.383,  0.923) * t * radius;
	vec2 o5  = vec2( 0.000,  1.000) * t * radius;
	vec2 o6  = vec2(-0.383,  0.923) * t * radius;
	vec2 o7  = vec2(-0.707,  0.707) * t * radius;
	vec2 o8  = vec2(-0.923,  0.383) * t * radius;
	vec2 o9  = vec2(-1.000,  0.000) * t * radius;
	vec2 o10 = vec2(-0.923, -0.383) * t * radius;
	vec2 o11 = vec2(-0.707, -0.707) * t * radius;
	vec2 o12 = vec2(-0.383, -0.923) * t * radius;
	vec2 o13 = vec2( 0.000, -1.000) * t * radius;
	vec2 o14 = vec2( 0.383, -0.923) * t * radius;
	vec2 o15 = vec2( 0.707, -0.707) * t * radius;
	vec2 o16 = vec2( 0.923, -0.383) * t * radius;

	// Accumulate premultiplied color and alpha to avoid white halos from
	// transparent texels that contain background color.
	vec3 accumCol = vec3(0.0);
	float accumA = 0.0;

	vec4 s = texture2D(tex, uv);
	accumCol += s.rgb * s.a;
	accumA += s.a;

	vec4 samples[16];
	samples[0] = texture2D(tex, uv + o1);
	samples[1] = texture2D(tex, uv + o2);
	samples[2] = texture2D(tex, uv + o3);
	samples[3] = texture2D(tex, uv + o4);
	samples[4] = texture2D(tex, uv + o5);
	samples[5] = texture2D(tex, uv + o6);
	samples[6] = texture2D(tex, uv + o7);
	samples[7] = texture2D(tex, uv + o8);
	samples[8] = texture2D(tex, uv + o9);
	samples[9] = texture2D(tex, uv + o10);
	samples[10] = texture2D(tex, uv + o11);
	samples[11] = texture2D(tex, uv + o12);
	samples[12] = texture2D(tex, uv + o13);
	samples[13] = texture2D(tex, uv + o14);
	samples[14] = texture2D(tex, uv + o15);
	samples[15] = texture2D(tex, uv + o16);

	for(int i = 0; i < 16; i++){
		vec4 si = samples[i];
		accumCol += si.rgb * si.a;
		accumA += si.a;
	}

	// If accumulated alpha is very small (fully transparent), fall back to
	// simple average of RGB samples to avoid division by zero.
	if(accumA > 0.001){
		return accumCol / accumA;
	}
	// fallback: average RGB (no meaningful alpha)
	vec3 avg = (texture2D(tex, uv).rgb + texture2D(tex, uv + o1).rgb + texture2D(tex, uv + o2).rgb + texture2D(tex, uv + o3).rgb + texture2D(tex, uv + o4).rgb + texture2D(tex, uv + o5).rgb + texture2D(tex, uv + o6).rgb + texture2D(tex, uv + o7).rgb + texture2D(tex, uv + o8).rgb + texture2D(tex, uv + o9).rgb + texture2D(tex, uv + o10).rgb + texture2D(tex, uv + o11).rgb + texture2D(tex, uv + o12).rgb + texture2D(tex, uv + o13).rgb + texture2D(tex, uv + o14).rgb + texture2D(tex, uv + o15).rgb + texture2D(tex, uv + o16).rgb) / 17.0;
	return avg;
}

void main(){
	vec2 uv = gl_FragCoord.xy / u_resolution.xy;

	// Mouse-driven controls removed. Use fixed threshold/softness suitable
	// for paper-cut style. If you want to expose these controls, we can
	// convert them to uniforms and add UI sliders.
	float baseThreshold = 0.50;
	float baseSoftness = 0.06;


	// per-layer offset so each layer can have slightly different cut
	float offs0 = 0.00; // front
	float offs1 = -0.02;
	float offs2 = -0.04;
	float offs3 = -0.06;
	float offs4 = -0.08;
	float offs5 = -0.10; // background (last)

	// Compute normalized layer indices (0 = front, 5 = back)
	float idx0 = 0.0;
	float idx1 = 1.0;
	float idx2 = 2.0;
	float idx3 = 3.0;
	float idx4 = 4.0;
	float idx5 = 5.0;

	// sample layers with blur amount depending on distance from focus
	// Map u_focus (0..1) to layer index space (0..5)
	float focusIdx = mix(0.0, 5.0, clamp(u_focus, 0.0, 1.0));
	float maxRadiusPixels = mix(0.0, 30.0, clamp(u_maxBlur, 0.0, 1.0));

	float d5 = abs(idx5 - focusIdx) / 5.0;
	float d4 = abs(idx4 - focusIdx) / 5.0;
	float d3 = abs(idx3 - focusIdx) / 5.0;
	float d2 = abs(idx2 - focusIdx) / 5.0;
	float d1 = abs(idx1 - focusIdx) / 5.0;
	float d0 = abs(idx0 - focusIdx) / 5.0;

	float r0 = d0 * maxRadiusPixels;
	float r1 = d1 * maxRadiusPixels;
	float r2 = d2 * maxRadiusPixels;
	float r3 = d3 * maxRadiusPixels;
	float r4 = d4 * maxRadiusPixels;
	float r5 = d5 * maxRadiusPixels;

	// Also sample raw (non-blurred) textures to obtain reliable alpha for masking
	vec4 s0_raw = texture2D(u_tex0, uv);
	vec4 s1_raw = texture2D(u_tex1, uv);
	vec4 s2_raw = texture2D(u_tex2, uv);
	vec4 s3_raw = texture2D(u_tex3, uv);
	vec4 s4_raw = texture2D(u_tex4, uv);
	vec4 s5_raw = texture2D(u_tex5, uv);
	vec3 c0 = blurDisk(u_tex0, uv, r0);
	vec3 c1 = blurDisk(u_tex1, uv, r1);
	vec3 c2 = blurDisk(u_tex2, uv, r2);
	vec3 c3 = blurDisk(u_tex3, uv, r3);
	vec3 c4 = blurDisk(u_tex4, uv, r4);
	vec3 c5 = blurDisk(u_tex5, uv, r5);

	// background starts as last texture
	vec3 outCol = c4;

	// Debug: visualize alpha masks (R=layer0, G=layer1, B=layer2)
	if(u_debug > 0.5) {
		vec3 dbg = vec3(s0_raw.a, s1_raw.a, s2_raw.a);
		gl_FragColor = vec4(dbg, 1.0);
		return;
	}

	// composite back-to-front (so front overlays on top): start from last (c5)
	float a4 = layerMask(s4_raw, baseThreshold + offs4, baseSoftness);
	outCol = mix(c5, c4, a4);

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

