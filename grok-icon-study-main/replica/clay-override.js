/* 星小驰 — 对齐参考：珊瑚红软海星、白竖椭圆眼、旁侧三粒泡泡；纯色扁平。 */
(function (g) {
  const geo = g.GROK_GEO;
  if (!geo) return;

  const CX = 114.27;
  const CY = 116;

  // 胖臂软海星：内半径抬高 → 尖角变圆鼓，贴近参考图
  function softStarPath(cx, cy, outer, inner, tips, samples) {
    const pts = [];
    const total = tips * 2;
    for (let i = 0; i < total; i++) {
      const a = -Math.PI / 2 + (i / total) * Math.PI * 2;
      const r = i % 2 === 0 ? outer : inner;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    const n = pts.length;
    const round = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const p3 = pts[(i + 2) % n];
      for (let s = 0; s < samples; s++) {
        const t = s / samples;
        const t2 = t * t, t3 = t2 * t;
        const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        round.push([x, y]);
      }
    }
    let d = `M${round[0][0].toFixed(2)} ${round[0][1].toFixed(2)}`;
    for (let i = 1; i < round.length; i++) d += `L${round[i][0].toFixed(2)} ${round[i][1].toFixed(2)}`;
    return d + "Z";
  }

  const CLAY_PATH = softStarPath(CX, CY, 100, 74, 5, 12);
  const top = CY - 100;
  const bottom = CY + 100;

  geo.shapes.clay = {
    label: "星小驰",
    path: CLAY_PATH,
    face: { x: 0, y: 2, sx: 0.92, sy: 0.88, eye: 1.0 },
    radius: 106,
    tiltScale: 0.9,
    top,
    bottom,
    // 参考图旁侧泡泡（与身体同色，挂在角色 group 上一起动）
    bubbles: [
      { x: 48, y: 42, r: 11 },
      { x: 68, y: 28, r: 6.5 },
      // 右下：拉开与尖角间距，做成悬浮小圆，勿贴成赘肉
      { x: 204, y: 196, r: 11 },
    ],
  };

  // 默认珊瑚红；保留浅色等作可选
  const XIAOCHI_RED = "#E23B4C";
  Object.assign(geo.palette, {
    clay: { light: XIAOCHI_RED, dark: "#C42F3E" },
    xiaochi: { light: XIAOCHI_RED, dark: "#C42F3E" },
    accent: { light: XIAOCHI_RED, dark: "#C42F3E" },
    dough: { light: "#F2EBE3", dark: "#E5D9CC" },
    ink: { light: "#222222", dark: "#111111" },
    glaze: { light: "#3D5A4C", dark: "#2A3F36" },
    indigoClay: { light: "#3A4A62", dark: "#2A3548" },
  });

  // 红身 → 白色竖椭圆眼（参考图）；浅身才用墨色眼
  geo.eyeInkMap = {
    clay: "#FFFFFF",
    xiaochi: "#FFFFFF",
    accent: "#FFFFFF",
    red: "#FFFFFF",
    magenta: "#FFFFFF",
    dough: "#2A2A28",
    ink: "#F2EBE3",
    black: "#F2EBE3",
    glaze: "#FFFFFF",
    indigoClay: "#FFFFFF",
    brown: "#FFFFFF",
    orange: "#2A2A28",
    yellow: "#2A2A28",
    green: "#FFFFFF",
    cyan: "#2A2A28",
    blue: "#FFFFFF",
    violet: "#FFFFFF",
    gray: "#FFFFFF",
  };
  delete geo.pupilMap;

  // 白竖椭圆：干净、无瞳孔
  function softOval(cx, cy, rx, ry, n) {
    const pts = [];
    const p = 2.05;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 - Math.PI / 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const ax = Math.pow(Math.abs(c), 2 / p) * (c < 0 ? -1 : 1);
      const ay = Math.pow(Math.abs(s), 2 / p) * (s < 0 ? -1 : 1);
      pts.push([+(cx + ax * rx).toFixed(2), +(cy + ay * ry).toFixed(2)]);
    }
    return pts;
  }

  function pair(lx, ly, rx, ry, lrx, lry, rrx, rry, n) {
    return [softOval(lx, ly, lrx, lry, n), softOval(rx, ry, rrx, rry, n)];
  }

  const N = 28;
  const L = 130, R = 160, Y = 112;
  geo.eyes = [
    pair(L, Y, R, Y, 8.2, 12.8, 8.2, 12.8, N),           // 0 idle
    pair(L, Y, R, Y, 7.4, 14.0, 7.4, 14.0, N),           // 1 listening
    pair(L, Y + 2, R, Y + 2, 10.5, 7.0, 10.5, 7.0, N),   // 2 happy
    pair(L - 1, Y - 2, R + 1, Y - 2, 9.2, 14.2, 9.2, 14.2, N), // 3 curious
    pair(L, Y + 3, R, Y + 3, 10.0, 5.2, 10.0, 5.2, N),   // 4 sleepy
    pair(L + 1, Y, R - 1, Y + 1, 6.8, 11.5, 6.6, 11.0, N), // 5 suspicious
    pair(L, Y, R, Y - 1, 7.8, 12.2, 8.4, 11.6, N),       // 6 asymmetric
    pair(L + 1, Y - 1, R - 1, Y - 1, 7.5, 11.5, 7.5, 11.5, N), // 7 focused
    pair(L, Y, R, Y, 8.0, 12.4, 8.0, 12.4, N),           // 8 idle alt
    pair(L - 1, Y - 1, R + 1, Y - 1, 8.8, 13.2, 8.8, 13.2, N), // 9 searching
    pair(L, Y, R, Y, 7.2, 13.0, 7.2, 13.0, N),           // 10 focus
    pair(L, Y + 1, R, Y + 1, 9.8, 8.0, 9.8, 8.0, N),     // 11 soft smile
    pair(L - 1, Y, R + 1, Y + 1, 8.5, 12.5, 7.8, 13.0, N), // 12 uneven
    pair(L, Y + 4, R, Y + 4, 9.5, 4.0, 9.5, 4.0, N),     // 13 sleep
    pair(L + 1, Y, R - 1, Y + 1, 6.5, 12.0, 6.5, 11.5, N), // 14 confuse
    pair(L, Y - 1, R, Y - 1, 8.5, 13.5, 8.5, 13.5, N),   // 15 proud
    pair(L + 1, Y - 1, R - 1, Y, 7.5, 12.5, 7.5, 12.0, N), // 16 think
    pair(L, Y - 1, R, Y - 1, 9.0, 11.5, 9.0, 11.5, N),   // 17 excited
    pair(L - 2, Y, R + 2, Y, 8.2, 12.5, 8.5, 12.0, N),   // 18 scan
    pair(L, Y, R, Y, 8.0, 12.6, 8.0, 12.6, N),           // 19 listen
    pair(L - 1, Y - 2, R + 1, Y - 1, 9.0, 13.5, 8.6, 13.0, N), // 20 scan
    pair(L - 1, Y - 3, R + 1, Y - 3, 9.8, 14.5, 9.8, 14.5, N), // 21 surprise
    pair(L, Y + 3, R, Y + 3, 9.8, 5.0, 9.8, 5.0, N),     // 22 drowsy
    pair(L + 2, Y, R - 1, Y + 1, 6.8, 11.2, 6.5, 11.8, N), // 23 side-eye
    pair(L + 1, Y + 1, R - 1, Y + 1, 7.2, 10.5, 7.2, 10.5, N), // 24 shy
  ];

  g.CLAY_META = {
    defaultShape: "clay",
    defaultColor: "clay",
    persona: "星小驰",
    note: "珊瑚红软海星 · 白竖椭圆眼 · 三粒旁侧泡泡 · 纯色扁平",
  };
})(window);
