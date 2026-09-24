// Persona 3 Reload style pause-screen scene, starring the character in character-data.js.
//
// Everything except the character's own pixels is generated here: the water,
// surface caustics, drifting bubbles, the pink shards, the intro plunge, and the
// rig that sways the hair, floats the body, blinks, and follows the cursor.
//
// Mouse: the eyes follow the cursor, moving it stirs a current that pushes the
//        hair and bubbles, clicking sends a ripple, poking the face makes them blink.
// Keys:  Space pause, R replay intro, F fullscreen.
// URL:   ?intro=0 skips the intro, ?motion=0.5 scales the motion, ?interactive=0
//        ignores the mouse. Lively and Wallpaper Engine expose the same settings.
(() => {
  "use strict";

  const ART_W = 1672;
  const ART_H = 941;
  const params = new URLSearchParams(location.search);
  let MOTION = clampNum(parseFloat(params.get("motion") ?? "1"), 0, 2, 1);
  let PLAY_INTRO = params.get("intro") !== "0";
  let INTERACTIVE = params.get("interactive") !== "0";

  // ---------------------------------------------------------------------------
  // Rig, in artwork pixels (origin top-left of the 1672x941 artwork).

  // Parts that must never bend. Red: head, crown and neck. Green: robe.
  const HEAD_SHAPE = [[240, 500], [280, 462], [340, 442], [410, 442], [460, 458], [495, 490], [512, 540], [515, 600], [508, 660], [495, 700], [482, 745], [440, 790], [410, 842], [355, 842], [320, 830], [290, 795], [255, 775], [228, 745], [224, 690], [228, 600], [232, 540]];
  const ROBE_SHAPE = [[405, -40], [820, -40], [745, 60], [695, 170], [662, 290], [658, 505], [560, 512], [505, 510], [465, 472], [420, 447], [385, 405], [368, 330], [362, 258], [392, 150]];
  const FACE = [350, 600];
  const CHEST = [540, 330];

  // Eye lids, traced from the artwork. "top" is the lower lid (upside-down head),
  // "margin" the edge of the heavy upper lid, "band" the underside of its lashes.
  const EYES = [
    {
      outer: [258.8, 580], inner: [303, 594],
      top: [[258.8, 580], [262.5, 576], [271.3, 574.5], [280, 577], [290, 580.5], [298.8, 585.5], [303, 591], [303, 594]],
      margin: [[258.8, 580], [260, 588], [266, 592], [271.3, 597.5], [277.5, 600], [283.8, 601.9], [290, 603.1], [296.3, 603.1], [301.3, 597.5], [303, 594]],
      band: [[252, 600], [255, 606.3], [265, 608.8], [277.5, 612.5], [290, 615], [300, 615.6], [306, 613]],
    },
    {
      outer: [385.5, 628], inner: [445, 645],
      top: [[385.5, 628], [388.1, 624.4], [392.5, 621.3], [400, 620], [407.5, 620.6], [415, 623.1], [421.3, 626.3], [427.5, 630], [435, 635], [442.5, 641.3], [445, 645]],
      margin: [[385.5, 628], [390, 638.1], [398.8, 641.3], [407.5, 642.5], [415, 642.5], [421.3, 646.9], [430, 648.8], [437.5, 647.5], [443.8, 645], [445, 645]],
      band: [[367.5, 633.8], [380, 642.5], [392.5, 648.8], [405, 655], [417.5, 658.8], [430, 660], [442.5, 657.5], [452.5, 653.1]],
    },
  ];

  // Water, sampled from the Persona 3 Reload pause screen from top to bottom.
  const WATER = [
    [6, 247, 250], [11, 233, 254], [17, 213, 253], [14, 179, 252], [10, 148, 252], [11, 132, 238], [8, 118, 223],
    [7, 103, 210], [1, 93, 201], [0, 81, 196], [0, 73, 191], [0, 64, 189], [0, 57, 188], [0, 49, 185], [0, 43, 184],
    [1, 36, 184], [1, 28, 181], [0, 21, 180], [1, 13, 176], [0, 7, 175], [0, 3, 172],
  ];

  const MAX_BUBBLES = 32;

  // ---------------------------------------------------------------------------
  const VERT = `#version 300 es
  in vec2 aPos;
  void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FRAG = `#version 300 es
  precision highp float;
  out vec4 fragColor;

  uniform vec2 uRes;
  uniform vec3 uView;          // art origin on screen (px), screen px per art px
  uniform float uTime;         // idle clock, seconds
  uniform float uIntro;        // seconds since the intro began
  uniform float uWindowX;      // centre of the bright surface window, art px
  uniform float uMotion;
  uniform float uSharp;        // 1: bicubic character sampling
  uniform sampler2D uChar;     // character, premultiplied
  uniform sampler2D uMask;     // R: head, G: robe
  uniform sampler2D uWater;    // water gradient
  uniform sampler2D uFlow;     // cursor current, screen px per second
  uniform vec3 uBody;          // float offset x, y (art px), roll (rad)
  uniform vec4 uEnter;         // intro camera: scale, roll, offset x, y
  uniform float uHeadTurn;     // head attention, radians
  uniform vec2 uParallax;      // art px the water pattern shifts
  uniform float uCharAlpha;
  uniform vec4 uEye[2];        // origin xy, axis angle, half width
  uniform float uEyeTop[22];
  uniform float uEyeMargin[22];
  uniform float uEyeTau[22];
  uniform vec2 uBlink;
  uniform vec2 uGaze;          // iris offset, art px
  uniform vec4 uBlob[12];      // x, y, radius, seed
  uniform float uBlobA[12];
  uniform vec4 uShard[8];      // x, y, size, angle
  uniform vec4 uShardC[8];     // rgb, alpha
  uniform vec4 uBubble[${MAX_BUBBLES}];    // x, y, radius, alpha
  uniform vec4 uRipple[4];     // x, y, age, strength

  const vec2 ART = vec2(${ART_W}.0, ${ART_H}.0);
  const vec2 HEAD = vec2(360.0, 620.0);
  const vec2 PIVOT = vec2(420.0, 520.0);
  const vec2 NECK = vec2(445.0, 470.0);

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
               mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
    return v;
  }
  vec2 rotateAround(vec2 p, vec2 c, float a) {
    float ca = cos(a), sa = sin(a);
    vec2 r = p - c;
    return c + vec2(ca * r.x - sa * r.y, sa * r.x + ca * r.y);
  }
  vec2 clampLen(vec2 v, float m) {
    float l = length(v);
    return l > m ? v * (m / l) : v;
  }

  // Cursor current at an artwork position, in art px per second.
  vec2 flowAt(vec2 a) {
    vec2 sp = a * uView.z + uView.xy;
    return texture(uFlow, sp / uRes).rg / uView.z;
  }

  // ---- water ---------------------------------------------------------------
  vec3 waterBase(float y) {
    float t = clamp(y / ART.y, 0.0, 1.0);
    return texture(uWater, vec2(t * (20.0 / 21.0) + 0.5 / 21.0, 0.5)).rgb;
  }

  // Flat cel caustics: many small, horizontally stretched shards that crowd
  // toward the surface and gather in an inverted triangle under the light.
  float surfaceField(vec2 a, float dd, float t, float scale) {
    // Rows compress toward the surface, as the underside of waves would.
    vec2 uv = vec2(a.x / (30.0 * scale), pow(dd, 0.8) * 52.0 / scale);
    vec2 warp = vec2(noise(uv * vec2(0.3, 0.55) + vec2(t * 0.75, -t * 0.9)),
                     noise(uv * vec2(0.3, 0.55) + vec2(4.7 - t * 0.6, 2.1 + t * 0.8)));
    // Thin horizontal slivers that shimmer quickly, as in the original.
    float n = fbm(uv * vec2(0.34, 1.15) + warp * vec2(1.5, 0.45) + vec2(t * 0.2, -t * 0.55));
    return n + (noise(a / 3.2 + t * 1.6) - 0.5) * 0.035;   // ragged edges
  }

  vec3 caustics(vec3 col, vec2 a, float t, float px) {
    float dd = a.y / ART.y;
    if (dd > 0.4 || dd < 0.0) return col;     // above the surface only during the intro dive
    float aa = px * 0.006;

    // Edge of the bright window: a darker, broken band that sags under the
    // light and rises toward the sides, like a wide smile.
    float dx = a.x - uWindowX;
    float edgeY = 0.05 + 0.12 * exp(-dx * dx / (430.0 * 430.0)) + 0.014 * sin(a.x / 95.0 + t * 0.5) + 0.01 * sin(a.x / 37.0 - t * 0.8);
    float edgeN = surfaceField(a + vec2(311.0, 0.0), dd, t * 0.8, 1.6);
    float edge = smoothstep(0.035, 0.0, abs(dd - edgeY) - 0.03 * edgeN);
    float dark = edge * smoothstep(0.45 - aa, 0.45 + aa, edgeN);

    // The window itself: an inverted triangle, widest at the surface.
    // Density and colour measured from the Persona 3 Reload pause screen.
    float halfW = 260.0 * max(0.0, 1.0 - dd / 0.35) + 40.0;
    float win = clamp(1.0 - abs(dx) / halfW, 0.0, 1.0);
    win = smoothstep(0.0, 0.5, win) * smoothstep(0.35, 0.2, dd);
    float side = smoothstep(0.08, 0.0, dd) * 0.16;        // a few pieces along the surface

    float n = surfaceField(a, dd, t, 1.0);
    float cover = max(win, side);
    float thr = 0.66 - 0.26 * cover;
    float piece = smoothstep(thr - aa, thr + aa, n) * step(0.02, cover);

    col.g -= dark * 0.14;
    col.b -= dark * 0.02;
    col = mix(col, vec3(0.27, min(1.0, col.g + 0.29), 1.0), piece);
    return col;
  }

  vec3 blobs(vec3 col, vec2 a, float t, float px) {
    for (int i = 0; i < 12; i++) {
      float alpha = uBlobA[i];
      if (alpha <= 0.001) continue;
      vec4 b = uBlob[i];
      vec2 q = a - b.xy;
      if (dot(q, q) > b.z * b.z * 4.0) continue;
      float seed = b.w;
      float ang = atan(q.y, q.x);
      float r = b.z * (1.0 + 0.16 * sin(ang * 2.0 + seed * 6.28 + t * 0.7) + 0.09 * sin(ang * 3.0 - t * 0.9 + seed * 3.1));
      float body = length(q) - r;
      // A second lobe, mostly above or below, gives the stacked "8" shapes of the original.
      float side = fract(seed * 13.7) > 0.5 ? 1.0 : -1.0;
      vec2 lobeC = vec2(0.35 * cos(seed * 9.0), side * (1.05 + 0.2 * sin(t * 0.6 + seed * 5.0))) * b.z;
      float lobe = length(q - lobeC) - b.z * (0.55 + 0.12 * sin(t * 0.8 + seed * 4.0)) * step(0.35, fract(seed * 3.3));
      float dist = min(body, lobe);
      float edge = max(px * 1.4, b.z * 0.08);
      float m = 1.0 - smoothstep(-edge, edge, dist);
      if (fract(seed * 7.13) > 0.6) {
        vec2 hc = vec2(cos(seed * 5.0), sin(seed * 5.0)) * b.z * 0.3;
        float hole = 1.0 - smoothstep(-edge, edge, length(q - hc) - b.z * 0.26);
        m *= 1.0 - hole * 0.45;
      }
      vec3 tint = mix(col, vec3(0.24, 0.62, 1.0), 0.38);
      col = mix(col, tint, m * alpha);
    }
    return col;
  }

  // Click ripples: a wave that bends the water as it spreads, drawn as two crisp
  // flat rings (the second trailing the first).
  vec2 rippleBend(vec2 a, float px, inout float glow, inout float line) {
    vec2 bend = vec2(0.0);
    for (int i = 0; i < 4; i++) {
      vec4 r = uRipple[i];
      if (r.w <= 0.001) continue;
      vec2 q = a - r.xy;
      float d = length(q);
      float fade = exp(-r.z * 1.5) * r.w;
      float ang = atan(q.y, q.x);
      float radius = 20.0 + 380.0 * (1.0 - exp(-r.z * 2.2)) + (1.8 * sin(ang * 5.0 + r.z * 3.0) + 1.1 * sin(ang * 9.0 - r.z * 4.0)) * min(r.z * 4.0, 1.0);
      float wave = exp(-pow((d - radius) / 30.0, 2.0)) * fade;
      bend += q / max(d, 1.0) * wave * 18.0;
      glow += wave;
      float w = max(px * 1.3, 2.2 * fade);
      line += (1.0 - smoothstep(w - px, w + px, abs(d - radius))) * fade;
      float radius2 = radius * 0.62;
      line += (1.0 - smoothstep(w * 0.7 - px, w * 0.7 + px, abs(d - radius2))) * fade * 0.55 * step(0.08, r.z);
    }
    return bend;
  }

  // ---- character -----------------------------------------------------------
  vec4 sampleSharp(vec2 uv) {
    vec2 size = ART;
    vec2 sp = uv * size;
    vec2 t1 = floor(sp - 0.5) + 0.5;
    vec2 f = sp - t1;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 t0 = (t1 - 1.0) / size, t3 = (t1 + 2.0) / size, t12 = (t1 + w2 / w12) / size;
    vec4 r = texture(uChar, vec2(t0.x, t0.y)) * w0.x * w0.y
           + texture(uChar, vec2(t12.x, t0.y)) * w12.x * w0.y
           + texture(uChar, vec2(t3.x, t0.y)) * w3.x * w0.y
           + texture(uChar, vec2(t0.x, t12.y)) * w0.x * w12.y
           + texture(uChar, vec2(t12.x, t12.y)) * w12.x * w12.y
           + texture(uChar, vec2(t3.x, t12.y)) * w3.x * w12.y
           + texture(uChar, vec2(t0.x, t3.y)) * w0.x * w3.y
           + texture(uChar, vec2(t12.x, t3.y)) * w12.x * w3.y
           + texture(uChar, vec2(t3.x, t3.y)) * w3.x * w3.y;
    r = clamp(r, 0.0, 1.0);
    r.rgb = min(r.rgb, vec3(r.a));
    return r;
  }

  float eyeLookup(int which, int e, float s) {
    float fi = clamp((s + 1.0) * 5.0, 0.0, 10.0);
    int i0 = min(int(floor(fi)), 9);
    float f = fi - float(i0);
    int b = e * 11;
    if (which == 0) return mix(uEyeTop[b + i0], uEyeTop[b + i0 + 1], f);
    if (which == 1) return mix(uEyeMargin[b + i0], uEyeMargin[b + i0 + 1], f);
    return mix(uEyeTau[b + i0], uEyeTau[b + i0 + 1], f);
  }

  // Eye in its own frame: s runs corner to corner (-1..1), v runs toward the lower lid.
  vec2 eyeLocal(vec2 p, int e) {
    vec4 fr = uEye[e];
    vec2 u = vec2(cos(fr.z), sin(fr.z));
    vec2 q = p - fr.xy;
    return vec2(dot(q, u) / fr.w, dot(q, vec2(u.y, -u.x)));
  }

  // Returns the artwork position to show at p.
  // Blink: the real upper-lash band slides over the eye while the lid skin behind
  // it stretches to follow, the way an eyelid does. Gaze: the eyeball turns under
  // the lids; its middle slides, its edges stay pinned to the lid lines.
  vec2 eyeMap(vec2 p, int e, float closure) {
    vec2 sv = eyeLocal(p, e);
    float s = sv.x, v = sv.y;
    if (abs(s) >= 1.0 || v > 16.0 || v < -60.0) return p;
    float top = eyeLookup(0, e, s);
    float rawMar = eyeLookup(1, e, s);
    float mar = rawMar - 1.3;                    // just inside the dark lashes
    float tau = eyeLookup(2, e, s) * 1.15 - 1.3;
    float taper = sqrt(max(0.0, 1.0 - s * s));
    float delta = max(0.0, (top + 0.6 * taper) - mar) * closure;
    float lid = mar + delta;
    vec2 n = vec2(sin(uEye[e].z), -cos(uEye[e].z));

    // Ease from the lid back to the eyeball over about a pixel, so the moving
    // lid edge stays smooth instead of stair-stepped.
    if (v >= lid && v < lid + 1.2 && delta > 0.0) return p - n * delta * (1.0 - (v - lid) / 1.2);
    if (v < lid) {
      if (v >= lid - tau) return p - n * delta;
      float skinTop = mar - tau, skinBase = skinTop - 14.0;
      if (v >= skinBase) {
        float src = skinBase + (v - skinBase) * (skinTop - skinBase) / (skinTop + delta - skinBase);
        return p + n * (src - v);
      }
      return p;
    }

    float inside = smoothstep(0.9, 3.8, top - v) * smoothstep(0.4, 2.2, v - rawMar) * smoothstep(1.0, 0.45, abs(s));
    return p - uGaze * inside;
  }

  vec4 character(vec2 a, float t) {
    // Intro: the camera pulls back from close on the head as the character settles.
    vec2 p = rotateAround(HEAD + (a - uEnter.zw - HEAD) / uEnter.x, HEAD, -uEnter.y);
    // Undo the body float to find where this pixel sits on the artwork.
    p = rotateAround(p - uBody.xy, PIVOT, -uBody.z);

    // Head attention: the head (and the roots of the hair) turn a touch toward the cursor.
    vec2 m0 = texture(uMask, p / ART).rg;
    float r0 = length(p - HEAD);
    float headW = max(m0.r, (1.0 - m0.g) * (1.0 - smoothstep(150.0, 320.0, r0)));
    p = rotateAround(p, NECK, -uHeadTurn * headW);

    vec2 m = texture(uMask, p / ART).rg;
    float rigid = max(m.r, m.g);
    vec2 dh = p - HEAD;
    float r = length(dh);
    vec2 radial = dh / max(r, 1.0);
    vec2 perp = vec2(-radial.y, radial.x);
    float w = (1.0 - rigid) * smoothstep(120.0, 470.0, r) * uMotion;
    float ph = dot(p, vec2(0.0062, -0.0041));
    // Slow sway travelling from the scalp to the tips, a quicker ripple on top,
    // and a little lazy noise so no two locks move in lockstep.
    float wave = 15.0 * sin(t * 1.05 - r * 0.0105 + ph)
               + 3.4 * sin(t * 2.35 - r * 0.027 + ph * 1.7 + 1.3);
    vec2 drift = vec2(noise(p / 190.0 + vec2(t * 0.11, 0.0)), noise(p / 190.0 + vec2(7.7, t * 0.1))) - 0.5;
    vec2 disp = w * (perp * wave + radial * 2.6 * sin(t * 0.8 - r * 0.009 + ph * 0.7) + drift * 9.0);
    float fabric = m.g * smoothstep(330.0, 10.0, p.y) * uMotion;
    disp += vec2(1.0, 0.22) * fabric * 4.2 * sin(t * 0.9 - p.y * 0.013 + p.x * 0.004);
    // The cursor's current pushes loose hair (and a little of the robe's hem).
    vec2 current = flowAt(p);
    disp += clampLen(current * 0.05, 38.0) * (w + fabric * 0.25);
    vec2 src = p - disp;

    src = eyeMap(src, 0, uBlink.x);
    src = eyeMap(src, 1, uBlink.y);

    vec2 uv = src / ART;
    vec4 col = uSharp > 0.5 ? sampleSharp(uv) : texture(uChar, uv);
    // Nothing exists below the artwork (only visible while it slides in).
    col *= smoothstep(ART.y + 26.0, ART.y, src.y);
    return col * uCharAlpha;
  }

  // ---- particles -----------------------------------------------------------
  // Pink glass fragments chipping off the character's silhouette.
  vec3 shards(vec3 col, vec2 a, float px) {
    for (int i = 0; i < 8; i++) {
      vec4 cc = uShardC[i];
      if (cc.a <= 0.001) continue;
      vec4 sh = uShard[i];
      vec2 q = a - sh.xy;
      if (dot(q, q) > sh.z * sh.z * 4.0) continue;
      float ca = cos(sh.w), sa = sin(sh.w);
      q = vec2(ca * q.x + sa * q.y, -sa * q.x + ca * q.y) / sh.z;
      // An irregular four-sided chip: corners at jittered angles and radii.
      float dist = -1e5;
      vec2 v[4];
      for (int k = 0; k < 4; k++) {
        vec2 h = hash22(vec2(float(i) * 4.0 + float(k), 7.7));
        float ang = (float(k) + (h.x - 0.5) * 0.7) * 1.5708;
        v[k] = vec2(cos(ang), sin(ang)) * mix(0.45, 1.05, h.y) * vec2(1.0, 0.62);
      }
      for (int k = 0; k < 4; k++) {
        vec2 e = v[(k + 1) % 4] - v[k];
        vec2 nrm = normalize(vec2(e.y, -e.x));
        dist = max(dist, dot(q - v[k], nrm));
      }
      dist *= sh.z;
      float m = 1.0 - smoothstep(-px, px, dist);
      col = mix(col, cc.rgb, m * cc.a);
    }
    return col;
  }

  vec3 bubbles(vec3 col, vec2 a, float px) {
    for (int i = 0; i < ${MAX_BUBBLES}; i++) {
      vec4 b = uBubble[i];
      if (b.w <= 0.001) continue;
      float d = length(a - b.xy) - b.z;
      if (d > 3.0 * px + 2.0) continue;
      float fill = 1.0 - smoothstep(-px, px, d);
      float rim = 1.0 - smoothstep(0.0, px * 1.2 + b.z * 0.12, abs(d + b.z * 0.18));
      col = mix(col, mix(col, vec3(0.75, 0.97, 1.0), 0.35), fill * b.w);
      col = mix(col, vec3(0.86, 1.0, 1.0), rim * b.w * 0.85);
    }
    return col;
  }

  // ---- intro plunge ----------------------------------------------------------
  // Ring bubbles on a jittered grid, one layer per size.
  float ringLayer(vec2 q, float cells, float density, float rMin, float rMax, float seed, float pxc) {
    vec2 bp = q * cells;
    vec2 id = floor(bp);
    vec2 h = hash22(id + seed);
    if (h.x > density) return 0.0;
    vec2 c = id + 0.25 + 0.5 * hash22(id + seed + 7.3);
    float rad = mix(rMin, rMax, h.y);
    float d = length(bp - c) - rad;
    float rim = 1.0 - smoothstep(0.0, pxc * cells * 1.4 + 0.02, abs(d + rad * 0.12));
    float fill = (1.0 - smoothstep(-pxc * cells, pxc * cells, d)) * 0.28;
    return max(rim, fill);
  }

  // White, then a plunge through the surface: a ragged funnel of water tears
  // open through the foam, foam columns rush upward, and rings of air scatter.
  vec3 introPlunge(vec3 col, vec2 sp, float ti) {
    if (ti > 2.6) return col;
    vec3 white = vec3(0.992, 0.996, 0.996);
    if (ti < 0.5) return white;
    float aspect = uRes.x / uRes.y;
    vec2 uv = sp / uRes;
    vec2 q = vec2((uv.x - 0.5) * aspect, 1.0 - uv.y);     // q.y: height above the bottom
    float t = ti - 0.5;
    float k = smoothstep(0.0, 0.85, t);
    float rise = t * 2.6 - t * t * 0.5;                    // everything rushes upward

    // The funnel: narrow and low at first, then wide open.
    float ragged = fbm(vec2(q.x * 2.6, q.y * 1.7 - rise * 1.3)) - 0.5;
    float width = mix(0.05, 1.5, k) * mix(1.15 - q.y * 1.1, 1.0, k * k) + ragged * mix(0.3, 0.45, k);
    float openW = width - abs(q.x + ragged * 0.2);
    float px = 1.0 / uRes.y;
    float open = smoothstep(-px * 2.0, px * 2.0, openW);
    float rim = smoothstep(-0.045, 0.0, openW) * (1.0 - open);

    // Foam: pale cyan with brighter lumps, and a blue-tinted rim toward the water.
    float lump = fbm(vec2(q.x * 5.0, q.y * 3.0 - rise * 2.0));
    vec3 foam = mix(vec3(0.8, 0.965, 1.0), white, smoothstep(0.5, 0.53, lump));
    foam = mix(foam, vec3(0.55, 0.86, 1.0), rim * 0.8);

    // Foam columns streaming up through the open water, thinning as they go.
    float colN = fbm(vec2(q.x * 6.5 + 3.0, q.y * 0.7 - rise * 1.9));
    float thin = mix(0.56, 0.74, smoothstep(0.35, 1.5, t));
    float column = smoothstep(thin, thin + 0.012, colN) * (1.0 - smoothstep(1.1, 1.9, t));
    float columnCore = smoothstep(thin + 0.07, thin + 0.08, colN) * (1.0 - smoothstep(0.9, 1.6, t));

    col = mix(col, vec3(0.72, 0.95, 1.0), column * 0.92);
    col = mix(col, vec3(0.9, 1.0, 1.0), columnCore * 0.8);
    col = mix(col, foam, 1.0 - open);

    // Rings of air flung upward, in two sizes.
    vec2 rq = vec2(q.x, q.y - rise * 0.55);
    float rings = max(ringLayer(rq, 9.0, 0.28, 0.1, 0.34, 0.0, px), ringLayer(rq, 22.0, 0.22, 0.12, 0.32, 5.0, px));
    rings *= smoothstep(0.05, 0.25, t) * (1.0 - smoothstep(1.0, 1.9, t));
    col = mix(col, vec3(0.8, 0.97, 1.0), rings * 0.85);
    return col;
  }

  void main() {
    vec2 sp = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
    vec2 a = (sp - uView.xy) / uView.z;
    float px = 1.0 / uView.z;                 // one screen pixel in art px
    float t = uTime;

    // Water: the current and ripples bend the light; the camera settles during the intro.
    float glow = 0.0, ringLine = 0.0;
    vec2 bend = rippleBend(a, px, glow, ringLine);
    vec2 current = flowAt(a);
    float dive = uIntro < 3.0 ? (1.0 - smoothstep(0.55, 2.0, uIntro)) * 330.0 : 0.0;
    vec2 wa = a - bend - clampLen(current * 0.06, 60.0) + uParallax - vec2(0.0, dive);
    vec3 col = waterBase(wa.y);
    col = caustics(col, wa, t, px);
    col = blobs(col, a - bend * 0.5, t, px);
    // A faint sheen where the water is moving fastest, and on ripple crests.
    float sheen = smoothstep(250.0, 1400.0, length(current)) * 0.1 + glow * 0.16;
    col = mix(col, vec3(0.5, 0.95, 1.0), clamp(sheen, 0.0, 0.3) * smoothstep(0.95, 0.2, a.y / ART.y + 0.2));
    col = mix(col, vec3(0.62, 0.98, 1.0), clamp(ringLine, 0.0, 1.0) * 0.7);

    vec4 ch = character(a, t);
    col = col * (1.0 - ch.a) + ch.rgb;

    col = shards(col, a, px);
    col = bubbles(col, a, px);
    col = introPlunge(col, sp, uIntro);
    fragColor = vec4(col, 1.0);
  }`;

  // ---------------------------------------------------------------------------
  const canvas = document.getElementById("scene");
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: "high-performance" });
  if (!gl) {
    document.documentElement.classList.add("no-webgl");
    return;
  }

  const program = buildProgram(VERT, FRAG);
  const loc = {};
  for (const name of ["uRes", "uView", "uTime", "uIntro", "uWindowX", "uMotion", "uSharp", "uChar", "uMask", "uWater", "uFlow", "uBody", "uEnter", "uHeadTurn", "uParallax", "uCharAlpha", "uEye", "uEyeTop", "uEyeMargin", "uEyeTau", "uBlink", "uGaze", "uBlob", "uBlobA", "uShard", "uShardC", "uBubble", "uRipple"]) {
    loc[name] = gl.getUniformLocation(program, name);
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const waterTex = makeTexture(gl.LINEAR, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, WATER.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(WATER.flatMap(([r, g, b]) => [r, g, b, 255])));

  const maskTex = makeTexture(gl.LINEAR, gl.LINEAR);
  const mask = buildMask();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, mask.width, mask.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, mask.data);

  // The cursor current lives on a coarse screen-space grid.
  const FLOW_W = 64, FLOW_H = 36;
  const flow = { x: new Float32Array(FLOW_W * FLOW_H), y: new Float32Array(FLOW_W * FLOW_H), nx: new Float32Array(FLOW_W * FLOW_H), ny: new Float32Array(FLOW_W * FLOW_H), packed: new Float32Array(FLOW_W * FLOW_H * 2) };
  const flowTex = makeTexture(gl.LINEAR, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, FLOW_W, FLOW_H, 0, gl.RG, gl.FLOAT, flow.packed);

  const charTex = makeTexture(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
  let charReady = false;
  const art = new Image();
  art.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, charTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, art);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    charReady = true;
    start();
  };
  art.src = window.PERSONA_CHARACTER.src;

  const eyeUniforms = buildEyes();
  const eyeMid = [(EYES[0].outer[0] + EYES[1].inner[0]) / 2, (EYES[0].outer[1] + EYES[1].inner[1]) / 2];
  const eyeAngle = eyeUniforms.frames[2];

  // ---------------------------------------------------------------------------
  // Animation state.
  const rand = mulberry32(0x5eed);
  let idle = 0;              // idle clock, seconds
  const INTRO_START = -0.2;     // the original holds on white a moment before the plunge
  let intro = PLAY_INTRO ? INTRO_START : 99;
  let paused = false;
  let last = 0;
  let view = { ox: 0, oy: 0, scale: 1, artRight: ART_W };
  let started = false;
  let forcedBlink = null;

  const blink = { at: 2.6, double: false };
  const blobs = Array.from({ length: 9 }, (_, i) => spawnBlob(true, i));
  const shards = Array.from({ length: 8 }, (_, i) => spawnShard(i));
  const bubbles = Array.from({ length: MAX_BUBBLES }, () => ({ alive: false }));
  const ripples = Array.from({ length: 4 }, () => ({ age: 99, strength: 0, x: 0, y: 0 }));
  let nextBubble = 1.5;

  // Cursor, gaze and attention.
  const pointer = { x: 0, y: 0, lastMove: -99, inside: false, moves: [], trailClock: 0 };
  const gaze = { x: 0, y: 0, tx: 0, ty: 0, next: 0, wanderUntil: 0, wander: [0, 0], nextWander: 6 };
  const head = { angle: 0, vel: 0, target: 0 };
  const push = { x: 0, y: 0 };
  const parallax = { x: 0, y: 0 };

  const blobData = new Float32Array(48), blobAlpha = new Float32Array(12);
  const shardData = new Float32Array(32), shardColor = new Float32Array(32);
  const bubbleData = new Float32Array(MAX_BUBBLES * 4);
  const rippleData = new Float32Array(16);

  function spawnBlob(initial, i) {
    const x = 700 + rand() * (Math.max(view.artRight, ART_W) - 650);
    return {
      x, baseX: x,
      y: initial ? 180 + rand() * 820 : ART_H + 60 + rand() * 120,
      r: 9 + rand() * 12,
      seed: rand(),
      speed: 12 + rand() * 10,
      sway: 6 + rand() * 12,
      phase: rand() * 6.28,
      life: initial ? rand() : 0,
      id: i,
    };
  }

  function spawnShard(i) {
    // Small clusters of pink glass on the character's silhouette, as in the original.
    const clusters = [[[676, 292], 3], [[606, 548], 3], [[150, 858], 2]];
    let c = 0, n = i;
    while (n >= clusters[c][1]) { n -= clusters[c][1]; c++; }
    const [[cx, cy]] = clusters[c];
    const spread = [[-26, -18], [22, 4], [-4, 30]][n];
    const x = cx + spread[0] + (rand() - 0.5) * 12, y = cy + spread[1] + (rand() - 0.5) * 12;
    return {
      x, y, baseX: x, baseY: y,
      size: 8 + rand() * 10,
      angle: rand() * 6.28, spin: (rand() - 0.5) * 0.35,
      color: c === 2 ? [0.7, 0.5, 1.0] : [0.9, 0.52, 0.88],
      alpha: 0, peak: 0.88 + rand() * 0.1,
      phase: c * 2.1 + n * 0.5, period: 9 + c * 2.5,
      dx: 0, dy: 0,
    };
  }

  function addBubble(x, y, r, vy, delay = 0) {
    const b = bubbles.find((q) => !q.alive);
    if (!b) return;
    Object.assign(b, { alive: true, x, y, r, vy, vx: 0, phase: rand() * 6.28, age: -delay });
  }

  function update(dt) {
    idle += dt;
    intro += dt;
    stepFlow(dt);

    for (const b of blobs) {
      const [fx, fy] = flowAtArt(b.x, b.y);
      b.baseX += fx * dt * 0.35;
      b.y += (fy * 0.35 - b.speed) * dt;
      b.x = b.baseX + Math.sin(idle * 0.35 + b.phase) * b.sway;
      b.life += dt * 0.08;
      if (b.y < 90 - b.r || b.baseX < 560 || b.baseX > view.artRight + 80) Object.assign(b, spawnBlob(false, b.id));
    }
    for (const s of shards) {
      const [fx, fy] = flowAtArt(s.x, s.y);
      s.dx = (s.dx + fx * dt * 0.3) * Math.exp(-dt * 0.6);
      s.dy = (s.dy + fy * dt * 0.3) * Math.exp(-dt * 0.6);
      s.angle += (s.spin + (fx - fy) * 0.0006) * dt;
      s.x = s.baseX + s.dx + Math.sin(idle * 0.23 + s.phase) * 9;
      s.y = s.baseY + s.dy + Math.cos(idle * 0.19 + s.phase) * 7 - Math.sin(idle * 0.09 + s.phase) * 5;
      s.alpha = s.peak * smoothstep01(Math.sin((idle / s.period) * Math.PI * 2 + s.phase) * 2.2 + 0.4);
    }

    nextBubble -= dt;
    if (nextBubble <= 0) {
      // A few small bubbles escape from the hair over open water.
      const origins = [[610, 700], [690, 820], [720, 330], [560, 560], [760, 150]];
      const [ox, oy] = origins[Math.floor(rand() * origins.length)];
      const count = 2 + Math.floor(rand() * 3);
      for (let n = 0; n < count; n++) addBubble(ox + (rand() - 0.5) * 40, oy + n * 14, 2.2 + rand() * 3.2, 24 + rand() * 20, n * 0.25);
      nextBubble = 2.2 + rand() * 3.5;
    }
    for (const b of bubbles) {
      if (!b.alive) continue;
      b.age += dt;
      if (b.age < 0) continue;
      const [fx, fy] = flowAtArt(b.x, b.y);
      b.vx += (fx * 0.7 - b.vx) * Math.min(1, dt * 3);
      b.x += (b.vx + Math.sin(idle * 3 + b.phase) * 8) * dt;
      b.y += (fy * 0.5 - b.vy) * dt;
      if (b.y < -20 || b.age > 14) b.alive = false;
    }
    for (const r of ripples) r.age += dt;

    updateAttention(dt);
  }

  // ---- cursor ---------------------------------------------------------------
  function toArt(sx, sy) { return [(sx - view.ox) / view.scale, (sy - view.oy) / view.scale]; }

  function flowAtArt(ax, ay) {
    const sx = ax * view.scale + view.ox, sy = ay * view.scale + view.oy;
    const [vx, vy] = sampleFlow(sx, sy);
    return [vx / view.scale, vy / view.scale];
  }

  function sampleFlow(sx, sy) {
    const gx = Math.min(FLOW_W - 1.001, Math.max(0, sx / canvas.width * FLOW_W - 0.5));
    const gy = Math.min(FLOW_H - 1.001, Math.max(0, sy / canvas.height * FLOW_H - 0.5));
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    const k = j * FLOW_W + i;
    const lerp2 = (a) => (a[k] * (1 - fx) + a[k + 1] * fx) * (1 - fy) + (a[k + FLOW_W] * (1 - fx) + a[k + FLOW_W + 1] * fx) * fy;
    return [lerp2(flow.x), lerp2(flow.y)];
  }

  function splat(sx, sy, vx, vy, radiusCells, amount) {
    const cx = sx / canvas.width * FLOW_W - 0.5, cy = sy / canvas.height * FLOW_H - 0.5;
    const r = Math.ceil(radiusCells * 2.5);
    for (let j = Math.max(0, Math.floor(cy) - r); j <= Math.min(FLOW_H - 1, Math.ceil(cy) + r); j++) {
      for (let i = Math.max(0, Math.floor(cx) - r); i <= Math.min(FLOW_W - 1, Math.ceil(cx) + r); i++) {
        const f = Math.exp(-((i - cx) ** 2 + (j - cy) ** 2) / (radiusCells * radiusCells)) * amount;
        const k = j * FLOW_W + i;
        const tx = typeof vx === "function" ? vx(i - cx, j - cy) : vx, ty = typeof vy === "function" ? vy(i - cx, j - cy) : vy;
        flow.x[k] += (tx - flow.x[k]) * f;
        flow.y[k] += (ty - flow.y[k]) * f;
      }
    }
  }

  function stepFlow(dt) {
    if (dt <= 0) return;
    const cw = canvas.width / FLOW_W, ch = canvas.height / FLOW_H;
    // Stir: stamp the pointer's velocity along its path this frame.
    for (const m of pointer.moves) {
      const steps = Math.max(1, Math.ceil(Math.hypot(m.x1 - m.x0, m.y1 - m.y0) / (cw * 0.7)));
      for (let s = 0; s <= steps; s++) splat(m.x0 + (m.x1 - m.x0) * s / steps, m.y0 + (m.y1 - m.y0) * s / steps, m.vx, m.vy, 2.1, 0.32 / Math.sqrt(steps));
    }
    pointer.moves.length = 0;

    // Carry the current along itself, soften it, and let it die down.
    const decay = Math.exp(-dt / 1.25);
    for (let j = 0; j < FLOW_H; j++) {
      for (let i = 0; i < FLOW_W; i++) {
        const k = j * FLOW_W + i;
        const bx = Math.min(FLOW_W - 1.001, Math.max(0, i - flow.x[k] * dt / cw));
        const by = Math.min(FLOW_H - 1.001, Math.max(0, j - flow.y[k] * dt / ch));
        const i0 = Math.floor(bx), j0 = Math.floor(by), fx = bx - i0, fy = by - j0, q = j0 * FLOW_W + i0;
        flow.nx[k] = ((flow.x[q] * (1 - fx) + flow.x[q + 1] * fx) * (1 - fy) + (flow.x[q + FLOW_W] * (1 - fx) + flow.x[q + FLOW_W + 1] * fx) * fy);
        flow.ny[k] = ((flow.y[q] * (1 - fx) + flow.y[q + 1] * fx) * (1 - fy) + (flow.y[q + FLOW_W] * (1 - fx) + flow.y[q + FLOW_W + 1] * fx) * fy);
      }
    }
    for (let j = 0; j < FLOW_H; j++) {
      for (let i = 0; i < FLOW_W; i++) {
        const k = j * FLOW_W + i;
        const l = i > 0 ? k - 1 : k, r = i < FLOW_W - 1 ? k + 1 : k, u = j > 0 ? k - FLOW_W : k, d = j < FLOW_H - 1 ? k + FLOW_W : k;
        flow.x[k] = (flow.nx[k] * 0.6 + (flow.nx[l] + flow.nx[r] + flow.nx[u] + flow.nx[d]) * 0.1) * decay;
        flow.y[k] = (flow.ny[k] * 0.6 + (flow.ny[l] + flow.ny[r] + flow.ny[u] + flow.ny[d]) * 0.1) * decay;
        flow.packed[k * 2] = flow.x[k];
        flow.packed[k * 2 + 1] = flow.y[k];
      }
    }
  }

  function updateAttention(dt) {
    const active = INTERACTIVE && pointer.inside && idle - pointer.lastMove < 5;

    // Gaze moves in quick little jumps, like real eyes, not a smooth slide.
    if (idle >= gaze.next) {
      let target = [0, 0];
      if (active) {
        const [ax, ay] = toArt(pointer.x, pointer.y);
        target = gazeToward(ax - eyeMid[0], ay - eyeMid[1]);
      } else if (idle < gaze.wanderUntil) {
        target = gaze.wander;
      } else if (idle > gaze.nextWander) {
        // Left alone, they glance around now and then.
        const ang = rand() * Math.PI * 2;
        gaze.wander = gazeToward(Math.cos(ang) * 400, Math.sin(ang) * 260);
        gaze.wanderUntil = idle + 1.1 + rand() * 1.8;
        gaze.nextWander = gaze.wanderUntil + 5 + rand() * 8;
        target = gaze.wander;
      }
      if (Math.hypot(target[0] - gaze.tx, target[1] - gaze.ty) > 0.7 || (target[0] === 0 && target[1] === 0)) {
        gaze.tx = target[0]; gaze.ty = target[1];
      }
      gaze.next = idle + 0.1 + rand() * 0.16;
    }
    const k = 1 - Math.exp(-dt * 22);
    gaze.x += (gaze.tx - gaze.x) * k;
    gaze.y += (gaze.ty - gaze.y) * k;

    // The head follows the eyes, slower and only slightly.
    const along = gaze.x * Math.cos(eyeAngle) + gaze.y * Math.sin(eyeAngle);
    head.target = active ? -along * 0.0045 : 0;
    const stiffness = 14, damping = 6.5;
    head.vel += ((head.target - head.angle) * stiffness - head.vel * damping) * dt;
    head.angle += head.vel * dt;

    // The current nudges the whole body a little.
    const [fx, fy] = flowAtArt(CHEST[0], CHEST[1]);
    const kp = 1 - Math.exp(-dt * 1.5);
    push.x += (clampLen(fx * 0.012, fy * 0.012, 9)[0] - push.x) * kp;
    push.y += (clampLen(fx * 0.012, fy * 0.012, 9)[1] - push.y) * kp;

    // Gentle parallax toward the cursor.
    const tx = active ? (pointer.x / canvas.width - 0.5) * 2 : 0, ty = active ? (pointer.y / canvas.height - 0.5) * 2 : 0;
    const kpar = 1 - Math.exp(-dt * 1.2);
    parallax.x += (tx - parallax.x) * kpar;
    parallax.y += (ty - parallax.y) * kpar;
  }

  // Iris offset for a look toward (dx, dy) art px, kept inside a half-lidded eye.
  function gazeToward(dx, dy) {
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return [0, 0];
    const ux = Math.cos(eyeAngle), uy = Math.sin(eyeAngle);
    const reach = 1 - Math.exp(-dist / 260);
    const along = (dx * ux + dy * uy) / dist * reach * 6.0;
    const across = (dx * uy - dy * ux) / dist * reach * 1.3;
    return [ux * along + uy * across, uy * along - ux * across];
  }

  function onPointerMove(e) {
    if (!INTERACTIVE) return;
    const k = canvas.width / innerWidth;
    const x = e.clientX * k, y = e.clientY * k;
    const now = performance.now() / 1000;
    if (pointer.inside && pointer.t) {
      const dtp = Math.max(1 / 240, now - pointer.t);
      const [vx, vy] = clampLen((x - pointer.x) / dtp, (y - pointer.y) / dtp, 5000);
      pointer.moves.push({ x0: pointer.x, y0: pointer.y, x1: x, y1: y, vx, vy });
      // Fast strokes leave a little trail of bubbles.
      const speed = Math.hypot(vx, vy) / view.scale;
      pointer.trailClock += speed * dtp;
      if (speed > 500 && pointer.trailClock > 90) {
        pointer.trailClock = 0;
        const [ax, ay] = toArt(x, y);
        addBubble(ax + (rand() - 0.5) * 12, ay + (rand() - 0.5) * 12, 1.8 + rand() * 3.2, 30 + rand() * 30);
      }
    }
    pointer.x = x; pointer.y = y; pointer.t = now;
    pointer.inside = true;
    pointer.lastMove = idle;
  }

  function onPointerDown(e) {
    if (!INTERACTIVE) return;
    onPointerMove(e);
    const [ax, ay] = toArt(pointer.x, pointer.y);
    const r = ripples.reduce((a, b) => (b.age > a.age ? b : a));
    Object.assign(r, { x: ax, y: ay, age: 0, strength: 1 });
    // Push the water outward from the click, and let a few bubbles escape.
    splat(pointer.x, pointer.y, (dx, dy) => (dx / (Math.hypot(dx, dy) + 0.5)) * 900, (dx, dy) => (dy / (Math.hypot(dx, dy) + 0.5)) * 900, 3.2, 0.55);
    for (let n = 0; n < 12; n++) addBubble(ax + (rand() - 0.5) * 50, ay + (rand() - 0.5) * 34, 2.5 + rand() * 7.5, 45 + rand() * 70, n * 0.035);
    // Poke the face and they blink (and flinch, just a little).
    if (Math.hypot(ax - FACE[0], ay - FACE[1]) < 120) {
      blink.at = idle; blink.double = rand() < 0.4;
      head.vel += (ax < FACE[0] ? 1 : -1) * 0.05;
    }
  }

  function blinkAmount(t) {
    if (t > blink.at + 1.2) {
      blink.double = rand() < 0.22;
      blink.at = t + 3.2 + rand() * 4.5;
    }
    const one = (d) => {
      if (d < 0 || d > 0.44) return 0;
      if (d < 0.1) return easeInQuad(d / 0.1);
      if (d < 0.15) return 1;
      return 1 - easeOutCubic((d - 0.15) / 0.29);
    };
    const d = t - blink.at;
    return Math.max(one(d), blink.double ? one(d - 0.5) : 0);
  }

  // ---- render ----------------------------------------------------------------
  function render() {
    const W = canvas.width, H = canvas.height;
    gl.viewport(0, 0, W, H);
    gl.useProgram(program);
    gl.bindVertexArray(vao);

    const t = idle;
    const bodyX = 3.0 * Math.sin(t * 0.37) + 1.5 * Math.sin(t * 0.83 + 2.0) + push.x - parallax.x * 7;
    const bodyY = 6.5 * Math.sin(t * 0.52 + 1.0) + 1.8 * Math.sin(t * 1.1) + push.y - parallax.y * 4;
    const roll = 0.0045 * Math.sin(t * 0.29 + 0.4);
    // Intro camera: starts close and tilted, pulls back to rest. Scaling about
    // the head keeps every edge of the artwork off screen the whole way.
    const settle = PLAY_INTRO ? 1 - easeOutCubic(clamp01((intro - 0.9) / 1.35)) : 0;
    const enterScale = 1 + 0.55 * settle;
    const charAlpha = PLAY_INTRO ? clamp01((intro - 0.9) / 0.12) : 1;
    const shut = forcedBlink ?? blinkAmount(t);

    gl.uniform2f(loc.uRes, W, H);
    gl.uniform3f(loc.uView, view.ox, view.oy, view.scale);
    gl.uniform1f(loc.uTime, t);
    gl.uniform1f(loc.uIntro, intro);
    gl.uniform1f(loc.uWindowX, 1230 + Math.max(0, view.artRight - ART_W) * 0.55);
    gl.uniform1f(loc.uMotion, MOTION);
    gl.uniform1f(loc.uSharp, view.scale > 1.02 ? 1 : 0);
    gl.uniform3f(loc.uBody, bodyX * MOTION, bodyY * MOTION, roll * MOTION);
    gl.uniform4f(loc.uEnter, enterScale, -0.12 * settle, -60 * settle, -(enterScale - 1) * 250);
    gl.uniform1f(loc.uHeadTurn, head.angle);
    gl.uniform2f(loc.uParallax, -parallax.x * 3, -parallax.y * 2);
    gl.uniform1f(loc.uCharAlpha, charAlpha);
    gl.uniform2f(loc.uBlink, shut, clamp01(shut * 1.04));
    gl.uniform2f(loc.uGaze, gaze.x, gaze.y);
    gl.uniform4fv(loc.uEye, eyeUniforms.frames);
    gl.uniform1fv(loc.uEyeTop, eyeUniforms.top);
    gl.uniform1fv(loc.uEyeMargin, eyeUniforms.margin);
    gl.uniform1fv(loc.uEyeTau, eyeUniforms.tau);

    blobs.forEach((b, i) => {
      blobData.set([b.x, b.y, b.r, b.seed], i * 4);
      const fadeIn = clamp01(b.life * 4);
      const nearTop = clamp01((b.y - 110) / 160);
      blobAlpha[i] = fadeIn * nearTop * (PLAY_INTRO ? clamp01((intro - 1.4) / 1.0) : 1);
    });
    gl.uniform4fv(loc.uBlob, blobData);
    gl.uniform1fv(loc.uBlobA, blobAlpha);

    const shardIn = PLAY_INTRO ? clamp01((intro - 1.6) / 1.2) : 1;
    shards.forEach((s, i) => {
      shardData.set([s.x + bodyX * MOTION, s.y + bodyY * MOTION, s.size, s.angle], i * 4);
      shardColor.set([...s.color, s.alpha * shardIn], i * 4);
    });
    gl.uniform4fv(loc.uShard, shardData);
    gl.uniform4fv(loc.uShardC, shardColor);

    bubbles.forEach((b, i) => {
      const a = b.alive && b.age >= 0 ? clamp01(b.age * 3) * clamp01(b.y / 120) : 0;
      bubbleData.set([b.x || 0, b.y || 0, b.r || 0, a], i * 4);
    });
    gl.uniform4fv(loc.uBubble, bubbleData);

    ripples.forEach((r, i) => rippleData.set([r.x, r.y, r.age, r.age < 3 ? r.strength : 0], i * 4));
    gl.uniform4fv(loc.uRipple, rippleData);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, charTex); gl.uniform1i(loc.uChar, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(loc.uMask, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, waterTex); gl.uniform1i(loc.uWater, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, flowTex); gl.uniform1i(loc.uFlow, 3);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FLOW_W, FLOW_H, gl.RG, gl.FLOAT, flow.packed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    if (!paused) update(dt);
    render();
  }

  function start() {
    if (started || !charReady) return;
    started = true;
    resize();
    requestAnimationFrame(frame);
  }

  // Fit the artwork's height to the screen. Wider screens get more live water on
  // the right; narrower ones keep the character in view. A slight overscan
  // means the float never shows an edge.
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
    const budget = 2560 * 1440;
    if (W * H > budget) { const k = Math.sqrt(budget / (W * H)); W = Math.round(W * k); H = Math.round(H * k); }
    canvas.width = W; canvas.height = H;

    let scale = H / ART_H;
    let ox = 0;
    if (ART_W * scale > W) ox = Math.min(0, Math.max(W - ART_W * scale, W * 0.5 - 430 * scale));
    let oy = 0;
    const over = 1.035, cx = W * 0.3, cy = H * 0.5;
    ox = cx - (cx - ox) * over; oy = cy - (cy - oy) * over; scale *= over;
    view = { ox, oy, scale, artRight: (W - ox) / scale };
  }

  // ---------------------------------------------------------------------------
  function buildMask() {
    const k = 0.5, w = Math.round(ART_W * k), h = Math.round(ART_H * k);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "lighter";
    const fill = (shape, color) => {
      g.fillStyle = color;
      g.beginPath();
      shape.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
      g.closePath(); g.fill();
    };
    fill(HEAD_SHAPE, "#f00");
    fill(ROBE_SHAPE, "#0f0");
    const img = g.getImageData(0, 0, w, h);
    boxBlur(img.data, w, h, 4); boxBlur(img.data, w, h, 4); boxBlur(img.data, w, h, 3);
    return { width: w, height: h, data: new Uint8Array(img.data.buffer) };
  }

  function boxBlur(d, w, h, r) {
    const tmp = new Float32Array(w * h * 2);
    for (let ch = 0; ch < 2; ch++) {
      for (let y = 0; y < h; y++) {
        let acc = 0;
        for (let x = -r; x <= r; x++) acc += d[(y * w + Math.min(w - 1, Math.max(0, x))) * 4 + ch];
        for (let x = 0; x < w; x++) {
          tmp[(y * w + x) * 2 + ch] = acc / (2 * r + 1);
          acc += d[(y * w + Math.min(w - 1, x + r + 1)) * 4 + ch] - d[(y * w + Math.max(0, x - r)) * 4 + ch];
        }
      }
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 2 + ch];
        for (let y = 0; y < h; y++) {
          d[(y * w + x) * 4 + ch] = acc / (2 * r + 1);
          acc += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 2 + ch] - tmp[(Math.max(0, y - r) * w + x) * 2 + ch];
        }
      }
    }
  }

  // Resample each eye's traced lid lines into 11 steps across the eye.
  function buildEyes() {
    const frames = new Float32Array(8), top = new Float32Array(22), margin = new Float32Array(22), tau = new Float32Array(22);
    EYES.forEach((eye, e) => {
      const [ax, ay] = eye.outer, [bx, by] = eye.inner;
      const ox = (ax + bx) / 2, oy = (ay + by) / 2;
      const len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len;
      const nx = uy, ny = -ux;
      const toLocal = (pts) => pts.map(([x, y]) => [((x - ox) * ux + (y - oy) * uy) / (len / 2), (x - ox) * nx + (y - oy) * ny]).sort((p, q) => p[0] - q[0]);
      const sample = (pts, s) => {
        if (s <= pts[0][0]) return pts[0][1];
        for (let i = 1; i < pts.length; i++) {
          if (s <= pts[i][0]) { const f = (s - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]); return pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1]); }
        }
        return pts[pts.length - 1][1];
      };
      const T = toLocal(eye.top), M = toLocal(eye.margin), B = toLocal(eye.band);
      frames.set([ox, oy, Math.atan2(uy, ux), len / 2], e * 4);
      for (let i = 0; i <= 10; i++) {
        const s = -1 + i * 0.2;
        top[e * 11 + i] = sample(T, s);
        margin[e * 11 + i] = sample(M, s);
        tau[e * 11 + i] = Math.max(4, sample(M, s) - sample(B, s));
      }
    });
    return { frames, top, margin, tau };
  }

  // ---------------------------------------------------------------------------
  function buildProgram(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  function makeTexture(minFilter, magFilter) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clampLen(x, y, m) { const l = Math.hypot(x, y); return l > m ? [x * m / l, y * m / l] : [x, y]; }
  function clamp01(v) { return Math.min(1, Math.max(0, v)); }
  function smoothstep01(v) { const x = clamp01(v); return x * x * (3 - 2 * x); }
  function clampNum(v, lo, hi, fallback) { return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback; }
  function easeInQuad(x) { return x * x; }
  function easeOutCubic(x) { return 1 - (1 - x) ** 3; }

  addEventListener("resize", resize);
  addEventListener("pointermove", onPointerMove, { passive: true });
  addEventListener("pointerdown", onPointerDown);
  const pointerGone = () => { pointer.inside = false; pointer.t = 0; };
  addEventListener("pointerout", (e) => { if (!e.relatedTarget) pointerGone(); });
  addEventListener("blur", pointerGone);
  addEventListener("keydown", (e) => {
    if (e.code === "Space") { paused = !paused; e.preventDefault(); }
    else if (e.code === "KeyR") { intro = INTRO_START; }
    else if (e.code === "KeyF") { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
  });
  document.addEventListener("visibilitychange", () => { last = 0; });

  // Wallpaper players. Settings arrive before or after the first frame.
  const setting = {
    motion(v) { MOTION = clampNum(Number(v) / 100, 0, 2, 1); },
    interactive(v) { INTERACTIVE = Boolean(v); if (!INTERACTIVE) pointerGone(); },
    intro(v) { const on = Boolean(v); if (on !== PLAY_INTRO && intro < 3) intro = on ? intro : 99; PLAY_INTRO = on; },
  };
  window.wallpaperPropertyListener = {
    applyUserProperties(props) {
      for (const [key, prop] of Object.entries(props)) setting[key]?.(prop.value);
    },
  };
  window.livelyPropertyListener = (name, value) => setting[name]?.(value);

  // Hooks for tooling: jump the clocks to inspect a moment.
  window.persona = {
    seek(idleSeconds, introSeconds = 99) { idle = idleSeconds; intro = introSeconds; last = 0; },
    set paused(v) { paused = v; }, get paused() { return paused; },
    blinkNow() { blink.at = idle; blink.double = false; },
    forceBlink(amount) { forcedBlink = Number.isFinite(amount) ? amount : null; },
    lookAt(sx, sy) { pointer.x = sx; pointer.y = sy; pointer.inside = true; pointer.lastMove = idle; gaze.next = 0; },
    step(dt) { update(dt); },
    get ready() { return started; },
    get debug() {
      let energy = 0;
      for (let k = 0; k < flow.x.length; k++) energy = Math.max(energy, Math.hypot(flow.x[k], flow.y[k]));
      return { gaze: [gaze.x, gaze.y], head: head.angle, current: energy, motion: MOTION, interactive: INTERACTIVE, intro: PLAY_INTRO };
    },
  };
})();
