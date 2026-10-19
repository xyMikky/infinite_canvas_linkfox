/* L4 — playlists, blink, login wrap, springs. Symbols: g1e VBe w_t cSe rnt int ant ont snt. */
(function (g) {
  const GROUPS = [
    { label: "生命周期", states: ["sleeping", "waking", "idle", "listening", "thinking", "searching", "working"] },
    { label: "情绪反应", states: ["excited", "surprised", "suspicious", "angry", "drowsy", "happy", "curious", "confused", "bored", "proud", "shy", "sad", "laughing", "scared", "playful", "celebrate"] },
    { label: "助手形态", states: ["orbit", "radar", "progress"] },
    { label: "产品流程", states: ["spawning", "humming", "loading", "dictating", "writing", "sending", "receiving", "uploading", "notifying", "alerting", "dragging", "bouncing", "powering-down"] },
  ];

  // 界面中文名（引擎内部仍用英文 state id）
  const STATE_LABELS = {
    sleeping: "休眠", waking: "醒来", idle: "空闲", listening: "聆听",
    thinking: "思考", searching: "搜索", working: "工作中",
    excited: "兴奋", surprised: "惊讶", suspicious: "怀疑", angry: "生气",
    drowsy: "困倦", happy: "开心", curious: "好奇", confused: "困惑",
    bored: "无聊", proud: "得意", shy: "害羞", sad: "难过",
    laughing: "大笑", scared: "害怕", playful: "俏皮", celebrate: "庆祝",
    orbit: "环绕", radar: "雷达", progress: "进度",
    spawning: "生成中", humming: "嗡鸣", loading: "加载中", dictating: "听写",
    writing: "书写", sending: "发送", receiving: "接收", uploading: "上传",
    notifying: "通知", alerting: "告警", dragging: "拖拽", bouncing: "弹跳",
    "powering-down": "关机",
  };

  const SHAPE_LABELS = {
    clay: "星小驰", blob: "水滴团", pebble: "鹅卵石", bean: "豆形", egg: "蛋形",
    squircle: "方圆角", tablet: "平板", capsule: "胶囊", cylinder: "圆柱",
    hex: "六边形", gem: "宝石", crystal: "水晶", wedge: "楔形",
    shield: "盾牌", dome: "穹顶", arch: "拱门", cloud: "云朵",
    teardrop: "泪滴", leaf: "叶片",
  };

  const COLOR_LABELS = {
    clay: "珊瑚红", xiaochi: "星小驰红", accent: "强调红", dough: "面团米",
    ink: "墨黑", glaze: "釉绿", indigoClay: "靛灰",
    black: "黑色", brown: "棕色", red: "红色", orange: "橙色",
    yellow: "黄色", green: "绿色", cyan: "青色", blue: "蓝色",
    violet: "紫色", magenta: "品红", gray: "灰色",
  };

  const labelOf = (map, id, fallback) => (map && map[id]) || fallback || id;

  const EYE_PLAYLIST = {
    sleeping: [13, 22, 4], waking: [13], idle: [0, 8], listening: [10, 1, 19],
    thinking: [8, 16, 14, 17, 5], searching: [15, 9, 3, 20, 12, 18],
    working: [7, 16, 11, 10], excited: [2, 17, 21, 3, 11], surprised: [3, 21],
    suspicious: [14, 5, 23], angry: [7, 16], drowsy: [4, 22, 13],
    happy: [2, 11, 17, 19], curious: [3, 21, 0, 15], confused: [14, 5, 8],
    bored: [4, 22, 0], proud: [15, 8, 2], shy: [0, 24, 13], sad: [4, 13, 22],
    laughing: [2, 11, 17], scared: [3, 21], playful: [2, 17, 11, 8],
    celebrate: [2, 8, 17], orbit: [0, 8], radar: [0, 8], progress: [0, 8],
    spawning: [3, 0], humming: [0, 8], loading: [0, 8], dictating: [10, 1, 19],
    sending: [0, 8], receiving: [19, 0, 8], uploading: [15, 9, 8], writing: [15, 9],
    notifying: [3, 21, 0], alerting: [3, 21], bouncing: [2, 17],
    dragging: [3, 15, 0], "powering-down": [13, 22],
  };

  const EYE_HOLD_MS = {
    sleeping: [6000, 10000], waking: [800, 800], idle: [9000, 16000],
    listening: [2800, 5000], thinking: [2000, 3600], searching: [1000, 1800],
    working: [1800, 3200], excited: [1100, 2000], surprised: [2500, 4000],
    suspicious: [2600, 4500], angry: [2200, 3800], drowsy: [4000, 8000],
    happy: [2500, 4500], curious: [1800, 3200], confused: [2200, 3800],
    bored: [3500, 6000], proud: [3500, 6000], shy: [3000, 5500],
    sad: [4000, 7000], laughing: [1200, 2400], scared: [900, 1800],
    playful: [1500, 3000], celebrate: [1400, 2600], orbit: [4000, 8000],
    radar: [4000, 8000], progress: [4000, 8000], spawning: [1200, 1200],
    humming: [5000, 9000], loading: [6000, 10000], dictating: [4000, 8000],
    sending: [4000, 8000], receiving: [4000, 8000], uploading: [4000, 8000],
    writing: [4000, 8000], notifying: [1500, 2600], alerting: [2000, 3600],
    bouncing: [3000, 6000], dragging: [1600, 3000], "powering-down": [6000, 9000],
  };

  const BLINK_MS = {
    sleeping: null, waking: null, idle: [6000, 14000], listening: [3000, 7000],
    thinking: [3500, 7000], searching: [1600, 4000], working: [2800, 5500],
    excited: [2000, 4000], surprised: [1800, 3500], suspicious: [4500, 8000],
    angry: [3500, 7000], drowsy: null, happy: [2500, 5000], curious: [2500, 5500],
    confused: [2800, 5500], bored: [4000, 8000], proud: [3500, 7000],
    shy: [3000, 6000], sad: [4000, 8000], laughing: [2500, 5000],
    scared: [1200, 3000], playful: [2000, 4500], celebrate: [2200, 4500],
    orbit: null, radar: null, progress: null, spawning: null, humming: [4000, 8000],
    loading: null, dictating: null, sending: null, receiving: null, uploading: null,
    writing: null, notifying: [2000, 4000], alerting: null, bouncing: null,
    dragging: [2200, 4500], "powering-down": null,
  };

  const ONBOARDING = ["curious", "happy", "playful", "excited", "listening", "proud", "laughing", "shy"];
  const ONBOARDING_MS = 1200;
  const onboardMood = (n) => (n % 2 === 0 ? "idle" : ONBOARDING[((n - 1) / 2) % ONBOARDING.length] ?? "idle");

  // Clay feel: softer damping, more squash overshoot (doughy bounce).
  const SPRINGS = {
    spin: [4.2, 0.82],
    x: [2.8, 0.92],
    y: [3.1, 0.88],
    squash: [6.5, 0.62],
    blink: [18, 0.92],
    eyeScale: [7.2, 0.78],
    gazeX: [9.5, 0.95],
    gazeY: [9.5, 0.95],
    notify: [7.5, 0.5],
    humDots: [5.2, 0.95],
    overlay: [11, 0.92],
    overlayMix: [9, 0.9],
    shape: [7.5, 0.85],
    overlayTurn: [11, 0.92],
    spinTurn: [5.1, 0.88],
  };

  // 星小驰参考：白竖眼略收，避免瞪视
  const FACE_TUNE = { size: 0.9, gap: 1.02, height: 1.0, eyeWidth: 0.92, eyeHeight: 1.08 };
  const POSE = { turn: 8, tilt: -6, roll: 10, scale: 1 };
  const POSE_HOME = { turn: 14, tilt: -8, roll: 14 };
  const UNIFORM_EYES = true;
  const V_T = new Set(["happy", "excited", "proud"]);
  const B_T = new Set(["playful"]);
  const WINK_STATES = new Set(["idle", "happy", "excited", "curious", "playful"]);
  const SHAPE_ZOOM = { clay: 0.94, blob: 0.92, pebble: 0.96, squircle: 0.84, tablet: 1, wedge: 0.94, hex: 0.94, cloud: 1, teardrop: 1 };
  const VIEW_SCALE = 259 / 229;
  const shapeZoom = (name) => SHAPE_ZOOM[name] ?? 1;
  const poseScale = (name) => shapeZoom(name) * VIEW_SCALE;
  const shapeEyeScale = (name) => SHAPE_ZOOM.blob / shapeZoom(name);
  const VIEW = { minX: -15, minY: -15, width: 259, height: 259 };
  const VIEW_HALF = VIEW.width / 2;
  const VIEW_MID = VIEW.minX + VIEW_HALF;
  const OVERLAY_ZOOM = {
    dots: 1.5, orbit: 1.14, radar: 1.14, progress: 1.32, gather: 1.15,
    wave: 1.42, send: 1.12, receive: 1.12, dock: 1.3, ball: 1.22,
    whirl: 1.45, pencil: 1.18, bang: 1.28, standby: 1.75,
  };
  const overlayViewZoom = (kind, scale) => (kind == null ? 1 : Math.max(OVERLAY_ZOOM[kind] / Math.max(scale, 1), 1));

  // Source G_t / MNe / Y_t — login ink. Live $_t uses --fg = ink.flat ?? MNe(color).
  const INK = {
    black: { lightFrom: "#585858", lightTo: "#000000", darkFrom: "#FFFFFF", darkTo: "#C2C2C2" },
    brown: { lightFrom: "#AE8968", lightTo: "#855C36", darkFrom: "#A27952", darkTo: "#604227" },
    red: { lightFrom: "#FF5667", lightTo: "#E02135", darkFrom: "#FF3E51", darkTo: "#A21826" },
    orange: { lightFrom: "#FF8838", lightTo: "#E05B00", darkFrom: "#FF781C", darkTo: "#C24E00" },
    yellow: { lightFrom: "#FFAF38", lightTo: "#E08600", darkFrom: "#FFA31C", darkTo: "#C27400" },
    green: { lightFrom: "#1CCF82", lightTo: "#009957", darkFrom: "#00C972", darkTo: "#008048" },
    cyan: { lightFrom: "#58D3C5", lightTo: "#00A592", darkFrom: "#1CC3B0", darkTo: "#007769" },
    blue: { lightFrom: "#459FFE", lightTo: "#0E74E0", darkFrom: "#2A92FE", darkTo: "#0C64C1" },
    violet: { lightFrom: "#B792FE", lightTo: "#804EE0", darkFrom: "#9159FE", darkTo: "#5C39A1" },
    magenta: { lightFrom: "#FF77BE", lightTo: "#E02A88", darkFrom: "#FF47A6", darkTo: "#A21E62" },
    gray: { lightFrom: "#A6A6A6", lightTo: "#696969", darkFrom: "#B7B7B7", darkTo: "#777777" },
    clay: { lightFrom: "#E23B4C", lightTo: "#E23B4C", darkFrom: "#C42F3E", darkTo: "#C42F3E" },
    xiaochi: { lightFrom: "#E23B4C", lightTo: "#E23B4C", darkFrom: "#C42F3E", darkTo: "#C42F3E" },
    ink: { lightFrom: "#222222", lightTo: "#222222", darkFrom: "#111111", darkTo: "#111111" },
    accent: { lightFrom: "#E23B4C", lightTo: "#E23B4C", darkFrom: "#C42F3E", darkTo: "#C42F3E" },
    dough: { lightFrom: "#F2EBE3", lightTo: "#F2EBE3", darkFrom: "#E5D9CC", darkTo: "#E5D9CC" },
    glaze: { lightFrom: "#3D5A4C", lightTo: "#3D5A4C", darkFrom: "#2A3F36", darkTo: "#2A3F36" },
    indigoClay: { lightFrom: "#3A4A62", lightTo: "#3A4A62", darkFrom: "#2A3548", darkTo: "#2A3548" },
  };
  const INK_ANGLE = 135;
  // 纯色：不再输出 linear-gradient，避免角色身上出现渐变
  const inkFg = (id) => {
    const pal = g.GROK_GEO.palette[id] || g.GROK_GEO.palette.clay || g.GROK_GEO.palette.black;
    return pal.light;
  };
  const inkCss = (id) => inkFg(id);
  const EYE_BG = "#FFFFFF";
  const eyeFillFor = (id) => (g.GROK_GEO.eyeInkMap && g.GROK_GEO.eyeInkMap[id]) || EYE_BG;

  g.GROK_TABLES = {
    GROUPS, STATE_LABELS, SHAPE_LABELS, COLOR_LABELS, labelOf,
    EYE_PLAYLIST, EYE_HOLD_MS, BLINK_MS,
    ONBOARDING, ONBOARDING_MS, onboardMood,
    SPRINGS, FACE_TUNE, POSE, POSE_HOME, UNIFORM_EYES,
    V_T, B_T, WINK_STATES,
    SHAPE_ZOOM, VIEW_SCALE, shapeZoom, poseScale, shapeEyeScale,
    VIEW, VIEW_HALF, VIEW_MID, OVERLAY_ZOOM, overlayViewZoom,
    INK, INK_ANGLE, inkFg, inkCss, EYE_BG, eyeFillFor,
  };
})(window);
