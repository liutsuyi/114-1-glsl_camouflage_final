// 作者: tsuyi
// 檔名: environment_v1.frag
// 說明: 將最多 6 張圖層（前景 -> 背景）以紙雕風格合成。
//
// 中文說明：
// 本 shader 將多張圖層由前景 (u_tex0) 到背景 (u_tex5) 以紙雕（paper-cut）風格合成。
// 透明判斷：
//  - 以貼圖的 alpha 通道作為主要透明判斷來源，避免以亮度誤判淺色為透明。
//  - 若貼圖沒有 alpha（alpha == 1.0），則視為完全不透明。
// 控制參數：
//  - `u_focus`: 景深焦點（0 = 前景清晰，1 = 背景清晰）
//  - `u_maxBlur`: 最大模糊強度（0..1，shader 會轉換為像素半徑）
//  - `u_debug`: 若 > 0.5 顯示偵錯視覺化
// 使用方式：在 `index.html` 的 `data-textures` 指定紋理路徑，順序為前到後 (u_tex0 ... u_tex5)。

#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;

// 貼圖說明：u_tex0 為最前方圖層，u_tex5 為最背後圖層
uniform sampler2D u_tex0;
uniform sampler2D u_tex1;
uniform sampler2D u_tex2;
uniform sampler2D u_tex3;
uniform sampler2D u_tex4;
uniform sampler2D u_tex5;

// 景深與模糊控制（範圍 0..1）
uniform float u_focus;    // 0 = front in focus, 1 = back in focus
uniform float u_maxBlur;  // normalized 0..1, scaled inside shader to pixels
uniform float u_debug;    // if >0.5, visualize layer alpha masks for debugging
// 新增狐狸貼圖與滑鼠 / 大小 / 層級 uniforms
uniform sampler2D u_fox;  // 狐狸貼圖（帶 alpha）
uniform sampler2D u_foxCloth; // 狐狸服裝貼圖（帶 alpha）
uniform sampler2D u_foxSit; // 狐狸坐下貼圖（帶 alpha）
uniform sampler2D u_foxSitCloth; // 狐狸坐下服裝貼圖（帶 alpha）
uniform vec2 u_foxResolution; // width,height of the fox texture in pixels
uniform vec2 u_foxSitResolution; // 坐下貼圖的寬高
uniform vec2 u_mouseCustom; // 自訂滑鼠座標（像素空間），避免 GlslCanvas 內建 u_mouse 介入
uniform float u_foxSize;  // 狐狸顯示寬度相對於畫布寬度 (可大於1.0)
uniform float u_foxLayer; // 狐狸所在圖層索引：0 = 最前景, 5 = 最背後
uniform float u_foxOverlay; // if >0.5 draw fox as overlay after all layers
uniform float u_foxFeather; // feather radius in pixels for soft edges
uniform float u_foxFlip; // 0.0 = normal, 1.0 = horizontally flipped
uniform float u_foxClothEnabled; // 0.0 = disabled, 1.0 = enabled
uniform float u_foxMode; // 0.0 = 站立, 1.0 = 坐下

// 亮度計算輔助（目前透明判斷主要使用 alpha，此函式保留以備擴充）
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

// layerMask: 使用貼圖的 alpha 值作為遮罩（0 = 透明, 1 = 不透明）。
// 保留 threshold/softness 參數以供未來擴充，但目前未影響判斷結果。
float layerMask(vec4 samp, float threshold, float softness){
	// 直接使用 alpha 值（PNG 的透明區域會有 alpha < 1.0）
	return samp.a;
}

// foxMask: 優先使用圖片的 alpha。若 alpha 非常小，會以亮度作為備援遮罩，
// 以避免某些貼圖在 alpha 為 0 時仍有可見 RGB 的狀況被忽略。
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

// 取樣輔助：從狐狸貼圖取樣並可選擇水平翻轉
vec4 sampleFox(vec2 local){
	// 坐下模式也沿用目前的翻轉值，確保方向一致
	float flipEff = clamp(u_foxFlip, 0.0, 1.0);
	// 使用緩和的插值（ease in/out）並在中段衰減強度，減少翻轉時的拉伸感
	float t = flipEff;
	// 三次平滑階梯（cubical smoothstep）
	float sE = t * t * (3.0 - 2.0 * t);
	// 在中段進一步衰減插值幅度，使過渡期間不會過度扭曲
	float eff = sE * (0.75 + 0.25 * sE);
	float x = mix(local.x, 1.0 - local.x, eff);
	vec2 s = vec2(x, local.y);
	// 避免在 x=0 或 x=1 精準取樣，這會造成明顯切線；稍微 clamp 到內部避免 seam
	s.x = clamp(s.x, 0.001, 0.999);
	// 依模式選擇對應貼圖
	vec4 texS = (u_foxMode <= 0.5) ? texture2D(u_fox, s) : texture2D(u_foxSit, s);
	return texS;
}

// return the UV after flip/clamp so other textures (e.g., clothing) can use same coords
vec2 getFoxUV(vec2 local){
	float flipEff = clamp(u_foxFlip, 0.0, 1.0);
	float t = flipEff;
	float sE = t * t * (3.0 - 2.0 * t);
	float eff = sE * (0.75 + 0.25 * sE);
	float x = mix(local.x, 1.0 - local.x, eff);
	vec2 uv = vec2(clamp(x, 0.001, 0.999), local.y);
	return uv;
}

// sample clothing at same transformed UV
vec4 sampleFoxCloth(vec2 local){
	if(u_foxClothEnabled <= 0.5) return vec4(0.0);
	vec2 uv = getFoxUV(local);
	// 依模式選擇服裝貼圖
	return (u_foxMode <= 0.5) ? texture2D(u_foxCloth, uv) : texture2D(u_foxSitCloth, uv);
}

// 羽化遮罩：以 3x3 內核在貼圖 local 座標上模糊 alpha（u_foxFeather 為像素半徑）
float foxMaskFeathered(vec2 local){
	// compute base mask from foxMaskAdjusted at center
	float base = foxMaskAdjusted(sampleFox(local));
	if(u_foxFeather <= 0.5) return base;
	// 將羽化的像素半徑轉換為 UV 空間的偏移（以貼圖最大邊長作為參考以近似各向同性）
	float maxDim = max(u_foxResolution.x, u_foxResolution.y);
	float radiusUV = u_foxFeather / maxDim;
	// 3x3 sample offsets
	vec2 offs[9];
	offs[0] = vec2(-1.0, -1.0) * radiusUV;
	offs[1] = vec2( 0.0, -1.0) * radiusUV;
	offs[2] = vec2( 1.0, -1.0) * radiusUV;
	offs[3] = vec2(-1.0,  0.0) * radiusUV;
	offs[4] = vec2( 0.0,  0.0) * radiusUV;
	offs[5] = vec2( 1.0,  0.0) * radiusUV;
	offs[6] = vec2(-1.0,  1.0) * radiusUV;
	offs[7] = vec2( 0.0,  1.0) * radiusUV;
	offs[8] = vec2( 1.0,  1.0) * radiusUV;
	float sum = 0.0;
	for(int i=0;i<9;i++){
		vec4 s = sampleFox(local + offs[i]);
		// use foxMaskAdjusted on each sample so premultiplied/brightness fallback is respected
		sum += foxMaskAdjusted(s);
	}
	float aBlur = sum / 9.0;
	// return the blurred mask (so color will be multiplied by this soft alpha)
	return aBlur;
}

// 計算狐狸在畫面上顯示的像素寬高（含水平 padding），回傳 vec2(width_eff, height)
vec2 foxPixelDims(){
	float foxPixelW = max(u_foxSize * u_resolution.x, 1.0);
	// 依模式使用不同貼圖解析度
	vec2 res = (u_foxMode <= 0.5) ? u_foxResolution : u_foxSitResolution;
	float aspect = (res.x > 0.0 && res.y > 0.0) ? (res.x / res.y) : 1.0;
	float foxPixelH = max(foxPixelW / aspect, 1.0);
	float padFactor = 0.12;
	float foxPixelW_eff = foxPixelW * (1.0 + padFactor);
	return vec2(foxPixelW_eff, foxPixelH);
}

// 以畫面像素為單位對狐狸貼圖進行模糊。
// 傳入 local（0..1）、pixelDims（顯示寬高像素）以及要模糊的半徑（像素），
// 會把像素偏移換算為 local 的 UV 偏移後進行多點取樣。
vec4 blurFox(vec2 local, vec2 pixelDims, float radiusPx){
	// 將模糊半徑縮小 15%（使用者要求：模糊強度降低 15%）
	radiusPx *= 0.85;
	// if radius small, still return a single-sample result,
	// but ensure clothing (if enabled) is composited per-pixel.
	if(radiusPx <= 0.5){
		vec4 s = sampleFox(local);
		if(u_foxClothEnabled > 0.5){
			vec4 cloth = sampleFoxCloth(local);
			// combined premultiplied color = cloth.rgb*cloth.a + fox.rgb*fox.a * (1 - cloth.a)
			vec3 combinedPrem = cloth.rgb * cloth.a + (s.rgb * s.a) * (1.0 - cloth.a);
			float combinedA = cloth.a + s.a * (1.0 - cloth.a);
			return vec4(combinedPrem, combinedA);
		} else {
			// return premultiplied form for consistency with the multi-sample path
			return vec4(s.rgb * s.a, s.a);
		}
	}
	// 以中心 + 12 個圓周方向共 13 點取樣（品質較好但成本中等）
	const int N = 13;
	vec2 dirs[13];
	dirs[0] = vec2( 0.0,    0.0);
	dirs[1] = vec2( 1.000,  0.000);
	dirs[2] = vec2( 0.866,  0.500);
	dirs[3] = vec2( 0.500,  0.866);
	dirs[4] = vec2( 0.000,  1.000);
	dirs[5] = vec2(-0.500,  0.866);
	dirs[6] = vec2(-0.866,  0.500);
	dirs[7] = vec2(-1.000,  0.000);
	dirs[8] = vec2(-0.866, -0.500);
	dirs[9] = vec2(-0.500, -0.866);
	dirs[10]= vec2( 0.000, -1.000);
	dirs[11]= vec2( 0.500, -0.866);
	dirs[12]= vec2( 0.866, -0.500);

	// 使用預乘（premultiplied）累加：累加 s.rgb * s.a 與 s.a，最後取平均
	vec3 accumCol = vec3(0.0);
	float accumA = 0.0;
	for(int i=0;i<N;i++){
		vec2 pxOff = dirs[i] * radiusPx;
		vec2 uvOff = vec2(pxOff.x / pixelDims.x, pxOff.y / pixelDims.y);
		vec4 s = sampleFox(local + uvOff);
		// 如果有服裝貼圖則先把服裝合成在狐狸上再累加 (premultiplied compositing)
		if(u_foxClothEnabled > 0.5){
			vec4 cloth = sampleFoxCloth(local + uvOff);
			// combined premultiplied color = cloth.rgb*cloth.a + fox.rgb*fox.a * (1 - cloth.a)
			vec3 combinedPrem = cloth.rgb * cloth.a + (s.rgb * s.a) * (1.0 - cloth.a);
			float combinedA = cloth.a + s.a * (1.0 - cloth.a);
			accumCol += combinedPrem;
			accumA += combinedA;
		} else {
			accumCol += s.rgb * s.a;
			accumA += s.a;
		}
	}
	float invN = 1.0 / float(N);
	float avgA = accumA * invN;
	vec3 premultAvg = accumCol * invN; // 預乘平均的 RGB
	// 回傳預乘顏色與平均 alpha（後續合成使用 premultiplied-over）
	return vec4(premultAvg, avgA);
}

// 計算狐狸貼圖的 local (0..1) 座標，使用像素空間的尺寸計算以避免寬高比錯誤
vec2 foxLocalFromFragCoord(vec2 fragCoord){
	// 使用像素空間計算：fragCoord 和 u_mouseCustom 都是以 drawingbuffer pixels 傳入
	// u_foxSize 表示狐狸寬度佔畫布寬度的比例（例如 0.2 = 20% 畫布寬度）
	float foxPixelW = max(u_foxSize * u_resolution.x, 1.0);
	// preserve texture aspect ratio: height = width * (texHeight/texWidth)
	vec2 res = (u_foxMode <= 0.5) ? u_foxResolution : u_foxSitResolution;
	float aspect = (res.x > 0.0 && res.y > 0.0) ? (res.x / res.y) : 1.0;
	float foxPixelH = max(foxPixelW / aspect, 1.0);
	// add a small horizontal padding to avoid visible clipping at texture edges
	// this slightly reduces displayed width so the fox won't be cut at extremes
	float padFactor = 0.12; // 6% extra horizontal padding
	float foxPixelW_eff = foxPixelW * (1.0 + padFactor);
	vec2 local = (fragCoord - u_mouseCustom) / vec2(foxPixelW_eff, foxPixelH) + vec2(0.5);
	return local;
}

// 圓盤採樣模糊（約 16 次採樣），用於對場景圖層做較圓滑的散景模糊。
// radius 以像素為單位，函式會取多個圓周樣本並加權平均。
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
				vec2 pd = foxPixelDims();
				vec4 foxS = blurFox(local, pd, r4);
				float fa = foxMaskFeathered(local);
				vec3 unprem = (foxS.a > 0.0001) ? (foxS.rgb / foxS.a) : foxS.rgb;
				vec3 srcPremult = unprem * fa;
				outCol = srcPremult + outCol * (1.0 - fa);
				outA = fa + outA * (1.0 - fa);
			}
	}

	float a3 = layerMask(s3_raw, baseThreshold + offs3, baseSoftness);
	outCol = c3 * a3 + outCol * (1.0 - a3);
	outA = a3 + outA * (1.0 - a3);
	if(u_foxLayer == 3.0){
				vec2 local = foxLocalFromFragCoord(gl_FragCoord.xy);
				if(local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0){
					vec2 pd = foxPixelDims();
					vec4 foxS = blurFox(local, pd, r3);
					float fa = foxMaskFeathered(local);
					vec3 unprem = (foxS.a > 0.0001) ? (foxS.rgb / foxS.a) : foxS.rgb;
					vec3 srcPremult = unprem * fa;
					outCol = srcPremult + outCol * (1.0 - fa);
					outA = fa + outA * (1.0 - fa);
				}
	}

	float a2 = layerMask(s2_raw, baseThreshold + offs2, baseSoftness);
	outCol = c2 * a2 + outCol * (1.0 - a2);
	outA = a2 + outA * (1.0 - a2);
	if(u_foxLayer == 2.0){
				vec2 local = foxLocalFromFragCoord(gl_FragCoord.xy);
				if(local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0){
					vec2 pd = foxPixelDims();
					vec4 foxS = blurFox(local, pd, r2);
					float fa = foxMaskFeathered(local);
					vec3 unprem = (foxS.a > 0.0001) ? (foxS.rgb / foxS.a) : foxS.rgb;
					vec3 srcPremult = unprem * fa;
					outCol = srcPremult + outCol * (1.0 - fa);
					outA = fa + outA * (1.0 - fa);
				}
	}

	float a1 = layerMask(s1_raw, baseThreshold + offs1, baseSoftness);
	outCol = c1 * a1 + outCol * (1.0 - a1);
	outA = a1 + outA * (1.0 - a1);
	if(u_foxLayer == 1.0){
				vec2 local = foxLocalFromFragCoord(gl_FragCoord.xy);
				if(local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0){
					vec2 pd = foxPixelDims();
					vec4 foxS = blurFox(local, pd, r1);
					float fa = foxMaskFeathered(local);
					vec3 unprem = (foxS.a > 0.0001) ? (foxS.rgb / foxS.a) : foxS.rgb;
					vec3 srcPremult = unprem * fa;
					outCol = srcPremult + outCol * (1.0 - fa);
					outA = fa + outA * (1.0 - fa);
				}
	}

	float a0 = layerMask(s0_raw, baseThreshold + offs0, baseSoftness);
	outCol = c0 * a0 + outCol * (1.0 - a0);
	outA = a0 + outA * (1.0 - a0);
	if(u_foxLayer == 0.0){
				vec2 local = foxLocalFromFragCoord(gl_FragCoord.xy);
				if(local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0){
					vec2 pd = foxPixelDims();
					vec4 foxS = blurFox(local, pd, r0);
					float fa = foxMaskFeathered(local);
					vec3 unprem = (foxS.a > 0.0001) ? (foxS.rgb / foxS.a) : foxS.rgb;
					vec3 srcPremult = unprem * fa;
					outCol = srcPremult + outCol * (1.0 - fa);
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
			// sample fox and clothing (no blur for overlay)
			vec4 foxS = sampleFox(local);
			vec4 cloth = sampleFoxCloth(local);
			if(u_foxClothEnabled > 0.5){
				// premultiplied composition of cloth over fox (per-pixel)
				vec3 combinedPrem = cloth.rgb * cloth.a + (foxS.rgb * foxS.a) * (1.0 - cloth.a);
				float combinedA = cloth.a + foxS.a * (1.0 - cloth.a);
				// unpremultiply to get color for mask multiplication later
				vec3 unprem = (combinedA > 0.0001) ? (combinedPrem / combinedA) : combinedPrem;
				float fa = foxMaskFeathered(local);
				vec3 srcPremult = unprem * fa;
				outCol = srcPremult + outCol * (1.0 - fa);
				outA = fa + outA * (1.0 - fa);
			} else {
				float fa = foxMaskFeathered(local);
				vec3 unprem = (foxS.a > 0.0001) ? (foxS.rgb / foxS.a) : foxS.rgb;
				vec3 srcPremult = unprem * fa;
				outCol = srcPremult + outCol * (1.0 - fa);
				outA = fa + outA * (1.0 - fa);
			}
		}
	}


	gl_FragColor = vec4(outCol, outA);
}

