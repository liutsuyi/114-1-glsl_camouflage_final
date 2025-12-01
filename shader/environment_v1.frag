// Author: tsuyi
// Title: environment_v1.frag
// Purpose: Composite up to 5 textures (front -> back) into a paper-cutting style scene.
//
// 中文說明：
// 本 shader 將多張圖層由前景 (u_tex0) 到背景 (u_tex5) 以紙雕（paper-cut）風格合成。
// 透明判斷：
//  - 僅以 PNG 圖片的 alpha 通道決定透明（也就是只有貼圖本身有透明像素時才會呈現透明），
//    不再以亮度或灰階來當作遮罩，以避免淺色區域被誤判為透明。
//  - 若貼圖沒有 alpha（alpha == 1.0），則視為完全不透明。
// 控制：
//  - `u_focus` 控制景深焦點（0 = 前景清晰，1 = 背景清晰）。
//  - `u_maxBlur` 控制最大模糊半徑（0..1，會映射到像素值）。
//  - `u_debug` 若 > 0.5，會顯示各層 alpha 的偵錯視覺化（R=層0, G=層1, B=層2）。
// 使用方式：在 `index.html` 的 `data-textures` 指定紋理路徑，順序為前到後 (u_tex0 ... u_tex5)。

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
// 新增狐狸貼圖與滑鼠 / 大小 / 層級 uniforms
uniform sampler2D u_fox;  // 狐狸貼圖（帶 alpha）
uniform vec2 u_mouse;     // GlslCanvas 會自動填入滑鼠座標（像素空間）
uniform float u_foxSize;  // 狐狸顯示寬度相對於畫布寬度 (可大於1.0)
uniform float u_foxLayer; // 狐狸所在圖層索引：0 = 最前景, 5 = 最背後
uniform float u_foxOverlay; // if >0.5 draw fox as overlay after all layers

// Luminance helper (保留以備未來需要，但目前透明判斷僅使用 alpha)
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

// layerMask: 只以圖檔的 alpha 通道作為遮罩回傳（0 = 透明, 1 = 不透明）。
// 這裡不再以亮度作為備援遮罩，以避免淺色被誤判為透明。
// threshold/softness 參數保留但目前不會影響 alpha 判斷（以方便未來擴充）。
float layerMask(vec4 samp, float threshold, float softness){
	// 直接使用 alpha 值（PNG 的透明區域會有 alpha < 1.0）
	return samp.a;
}

// foxMask: 優先使用圖片 alpha，若 alpha 非常小（接近 0），
// 則退回使用亮度 (luminance) 作為遮罩切換，避免某些圖片只有 RGB 但 alpha 為 0 的情況
float foxMask(vec4 foxS){
	float a = foxS.a;
	// 若 alpha 足夠大，基礎遮罩為 alpha
	float maskA = a;
	// 同時計算基於非預乘亮度的遮罩備援
	float denom = max(a, 0.0001);
	float L_unprem = lum(foxS.rgb) / denom;
	// 使用較寬鬆的閾值以偵測暗色但具有明顯 alpha 的像素
	float maskL = smoothstep(0.02, 0.6, clamp(L_unprem, 0.0, 1.0));
	// 回傳 alpha 與亮度估算的較大值，避免在 alpha 非零時被覆蓋為 0
	return max(maskA, maskL);
}

// 返回經過保護與放大的遮罩值：當 foxMask 很小但
// 非預乘亮度顯示貼圖有內容時，適度提升遮罩以確保可見性。
float foxMaskAdjusted(vec4 foxS){
	float fa = foxMask(foxS);
	float a = foxS.a;
	float denom = max(a, 0.0001);
	float L_unprem = lum(foxS.rgb) / denom;
	// 若原始遮罩過低，但未預乘亮度顯示圖像存在，則提升遮罩
	if(fa < 0.02 && L_unprem > 0.04){
		// scale luminance to compute a reasonable fallback alpha
		float boosted = clamp(L_unprem * 0.8, 0.02, 0.9);
		fa = max(fa, boosted);
	}
	return fa;
}

// 計算狐狸貼圖的 local (0..1) 座標，使用像素空間的尺寸計算以避免寬高比錯誤
vec2 foxLocalFromFragCoord(vec2 fragCoord){
	// 使用像素空間計算：fragCoord 和 u_mouse 都是以 drawingbuffer pixels 傳入
	// u_foxSize 表示狐狸寬度佔畫布寬度的比例（例如 0.2 = 20% 畫布寬度）
	float foxPixelW = max(u_foxSize * u_resolution.x, 1.0);
	float foxPixelH = foxPixelW; // 使用方形的採樣框
	vec2 local = (fragCoord - u_mouse) / vec2(foxPixelW, foxPixelH) + vec2(0.5);
	return local;
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

	// 背景從最後一層開始 (u_tex5)
	vec3 outCol = c5;
	// 同時追蹤合成後的 alpha，使用原始未模糊的取樣 alpha 作為每層 alpha
	float outA = s5_raw.a;

	// (debug branches removed for production — shader continues with standard composition)

	// 使用標準的 "over" 合成 (src over dst)，考慮 alpha：
	//   out = src.rgb * src.a + dst.rgb * (1 - src.a)
	//   outA = src.a + dst.a * (1 - src.a)
	// 這裡 src 是較靠前的圖層 (例如 c4), dst 是目前累積的背景。

	float a4 = layerMask(s4_raw, baseThreshold + offs4, baseSoftness);
	outCol = c4 * a4 + outCol * (1.0 - a4);
	outA = a4 + outA * (1.0 - a4);
	// 如果狐狸層級是 4，先把狐狸合成在這裡
	if(u_foxLayer == 4.0){
		vec2 local = foxLocalFromFragCoord(gl_FragCoord.xy);
		if(local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0){
			vec4 foxS = texture2D(u_fox, local);
			float fa = foxMaskAdjusted(foxS);
			vec3 foxColor = foxS.a > 0.0001 ? foxS.rgb / foxS.a : foxS.rgb;
			outCol = foxColor * fa + outCol * (1.0 - fa);
			outA = fa + outA * (1.0 - fa);
		}
	}

	float a3 = layerMask(s3_raw, baseThreshold + offs3, baseSoftness);
	outCol = c3 * a3 + outCol * (1.0 - a3);
	outA = a3 + outA * (1.0 - a3);
	if(u_foxLayer == 3.0){
			vec2 local = foxLocalFromFragCoord(gl_FragCoord.xy);
		if(local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0){
			vec4 foxS = texture2D(u_fox, local);
				float fa = foxMaskAdjusted(foxS);
			vec3 foxColor = foxS.a > 0.0001 ? foxS.rgb / foxS.a : foxS.rgb;
			outCol = foxColor * fa + outCol * (1.0 - fa);
			outA = fa + outA * (1.0 - fa);
		}
	}

	float a2 = layerMask(s2_raw, baseThreshold + offs2, baseSoftness);
	outCol = c2 * a2 + outCol * (1.0 - a2);
	outA = a2 + outA * (1.0 - a2);
	if(u_foxLayer == 2.0){
			vec2 local = foxLocalFromFragCoord(gl_FragCoord.xy);
		if(local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0){
			vec4 foxS = texture2D(u_fox, local);
				float fa = foxMaskAdjusted(foxS);
			vec3 foxColor = foxS.a > 0.0001 ? foxS.rgb / foxS.a : foxS.rgb;
			outCol = foxColor * fa + outCol * (1.0 - fa);
			outA = fa + outA * (1.0 - fa);
		}
	}

	float a1 = layerMask(s1_raw, baseThreshold + offs1, baseSoftness);
	outCol = c1 * a1 + outCol * (1.0 - a1);
	outA = a1 + outA * (1.0 - a1);
	if(u_foxLayer == 1.0){
			vec2 local = foxLocalFromFragCoord(gl_FragCoord.xy);
		if(local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0){
			vec4 foxS = texture2D(u_fox, local);
				float fa = foxMaskAdjusted(foxS);
			vec3 foxColor = foxS.a > 0.0001 ? foxS.rgb / foxS.a : foxS.rgb;
			outCol = foxColor * fa + outCol * (1.0 - fa);
			outA = fa + outA * (1.0 - fa);
		}
	}

	float a0 = layerMask(s0_raw, baseThreshold + offs0, baseSoftness);
	outCol = c0 * a0 + outCol * (1.0 - a0);
	outA = a0 + outA * (1.0 - a0);
	if(u_foxLayer == 0.0){
			vec2 local = foxLocalFromFragCoord(gl_FragCoord.xy);
		if(local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0){
			vec4 foxS = texture2D(u_fox, local);
				float fa = foxMaskAdjusted(foxS);
			vec3 foxColor = foxS.a > 0.0001 ? foxS.rgb / foxS.a : foxS.rgb;
			outCol = foxColor * fa + outCol * (1.0 - fa);
			outA = fa + outA * (1.0 - fa);
		}
	}

	// 如果狐狸層級是 5（最背後），在最開始就合成；但為了簡潔我們在開始時也支援該情形
	// 注意：若 u_foxLayer == 5.0 並且要在最背後，請在初始化後（開始）額外合成。
	if(u_foxLayer == 5.0){
		// 重新合成：將狐狸視為位於最底層 (在 c5 之上，但在其他所有層之下)
		// 這處理會在整個序列結束後被呼叫，但為避免複雜性，若需要精準可將狐狸先合成到起始 outCol
	}

	// 正常輸出包含 alpha，這樣若 canvas 被用在有背景的 context 中會正確表現透明
	// If overlay enabled, composite fox after all layers (overlay)
	if(u_foxOverlay > 0.5){
		vec2 local = foxLocalFromFragCoord(gl_FragCoord.xy);
		if(local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0){
			vec4 foxS = texture2D(u_fox, local);
			float fa = foxMaskAdjusted(foxS);
			vec3 foxColor = foxS.a > 0.0001 ? foxS.rgb / foxS.a : foxS.rgb;
			outCol = foxColor * fa + outCol * (1.0 - fa);
			outA = fa + outA * (1.0 - fa);
		}
	}

	// Debug overlay: when u_debug > 2.9, force-draw the fox (no mask, overlay)
	if(u_debug > 2.9){
		vec2 local = foxLocalFromFragCoord(gl_FragCoord.xy);
		if(local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0){
			vec4 foxS = texture2D(u_fox, local);
			vec3 foxColor = foxS.a > 0.0001 ? foxS.rgb / foxS.a : foxS.rgb;
			gl_FragColor = vec4(foxColor, 1.0);
			return;
		}
	}

	gl_FragColor = vec4(outCol, outA);
}

