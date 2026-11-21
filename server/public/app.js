const socket = io();
const connStatus = document.getElementById("conn-status");
const buildingEl = document.getElementById("building");
const activityEl = document.getElementById("activity-list");
const companyNameEl = document.getElementById("company-name");
const timeToggleBtn = document.getElementById("time-toggle");
const timeControlsEl = document.getElementById("time-controls");
const timePlayBtn = document.getElementById("time-play");
const timeSpeedSel = document.getElementById("time-speed");
const timeSliderEl = document.getElementById("time-slider");
const timeMarkersEl = document.getElementById("time-markers");
const timeLabelEl = document.getElementById("time-label");
const timeLiveBtn = document.getElementById("time-live");

socket.on("connect", () => {
  connStatus.textContent = "đang kết nối trực tiếp";
  connStatus.className = "conn-status conn-status--online";
});
socket.on("disconnect", () => {
  connStatus.textContent = "mất kết nối";
  connStatus.className = "conn-status conn-status--offline";
});

function fmtTime(ts) {
  if (!ts) return "--:--";
  return new Date(ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL = {
  waiting_shift: () => "rảnh",
  running: () => "đang chạy…",
  done: (p) => `xong ✓ ${fmtTime(p.lastRunAt)}`,
  error: (p) => `lỗi · ${fmtTime(p.lastRunAt)}`,
};

const STATUS_COLOR = {
  waiting_shift: "#8f8468",
  running: "#c98a1f",
  done: "#3f9566",
  error: "#c94d49",
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function renderActivity(logs) {
  activityEl.innerHTML = logs
    .map(
      (l) => `
    <li>
      <span class="log-time">${fmtTime(l.ts)}</span>
      <span class="log-pos">${escapeHtml(l.positionId)}</span>
      <span class="${l.level === "error" ? "log-error" : ""}">${escapeHtml(l.message)}</span>
    </li>`
    )
    .join("");
}

/* ---------- shared helpers ---------- */

const PALETTE = {
  skin: ["#e8b88a", "#c98f5e", "#f2c9a0", "#a9714a", "#8d5a3c"],
  hair: ["#2a1d14", "#1c1c1c", "#5c3a1e", "#8a4a1e", "#3a3a3a", "#d9c08a"],
  shirt: ["#4a7c6f", "#6b5b95", "#c0604a", "#b98d2e", "#4a6fa5", "#7a8c5a", "#a05c7a"],
  floor: ["#d8dfca", "#ecdfc0", "#ddd0e6", "#d2dfe6", "#ead9c9", "#cfe0d6"],
};

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function pick(arr, seed) {
  return arr[seed % arr.length];
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function rand(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

/* ---------- time of day: real local clock drives sky/lighting everywhere ---------- */

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA),
    b = hexToRgb(hexB);
  return `rgb(${Math.round(lerp(a.r, b.r, t))},${Math.round(lerp(a.g, b.g, t))},${Math.round(lerp(a.b, b.b, t))})`;
}
/** Darkens a scenery color toward night as `dark` (0..1) rises, so every tile/
 *  wall/desk dims together while glowing elements (lamps, lit windows, monitor
 *  screens, character sprites) stay drawn in their own bright colors on top. */
function shade(hex, dark) {
  if (!dark || dark <= 0) return hex;
  return lerpColor(hex, "#12141f", Math.min(1, dark) * 0.75);
}

// Keyframes across a 24h day: ban ngày nắng (bright) -> chiều mát (golden,
// softer) -> tối (dark, lamps on). `dark` is 0=full daylight..1=full night;
// `lamp` drives street lamps / lit windows / office ceiling lights.
const DAY_KEYFRAMES = [
  { h: 0, top: "#0b1322", bottom: "#1c2b45", dark: 1, lamp: 1 },
  { h: 5, top: "#0b1322", bottom: "#1c2b45", dark: 1, lamp: 1 },
  { h: 6.5, top: "#3c5478", bottom: "#f3a76a", dark: 0.45, lamp: 0.5 },
  { h: 8, top: "#bfe3f5", bottom: "#e3f3fa", dark: 0, lamp: 0 },
  { h: 16, top: "#bfe3f5", bottom: "#e3f3fa", dark: 0, lamp: 0 },
  { h: 17.5, top: "#8fb3d6", bottom: "#ffcf8a", dark: 0.12, lamp: 0.12 },
  { h: 18.8, top: "#3a4571", bottom: "#ff9566", dark: 0.5, lamp: 0.65 },
  { h: 20, top: "#121a30", bottom: "#2a2f52", dark: 0.9, lamp: 0.95 },
  { h: 24, top: "#0b1322", bottom: "#1c2b45", dark: 1, lamp: 1 },
];

function getTimeOfDay(nowMs) {
  const d = new Date(nowMs);
  const hour = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  let i = 0;
  while (i < DAY_KEYFRAMES.length - 1 && DAY_KEYFRAMES[i + 1].h < hour) i++;
  const a = DAY_KEYFRAMES[i];
  const b = DAY_KEYFRAMES[Math.min(i + 1, DAY_KEYFRAMES.length - 1)];
  const t = clamp((hour - a.h) / (b.h - a.h || 1), 0, 1);
  const dark = lerp(a.dark, b.dark, t);
  return {
    hour,
    skyTop: lerpColor(a.top, b.top, t),
    skyBottom: lerpColor(a.bottom, b.bottom, t),
    dark,
    lamp: lerp(a.lamp, b.lamp, t),
    sunAlpha: clamp(1 - dark * 1.35, 0, 1),
    moonAlpha: clamp(dark * 1.35 - 0.25, 0, 1),
  };
}

let _tod = null;
function tod0() {
  return _tod || { dark: 0, lamp: 0, sunAlpha: 1, moonAlpha: 0, skyTop: "#bfe3f5", skyBottom: "#e3f3fa" };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawChip(ctx, cx, topY, text, bg) {
  ctx.font = '700 10px "JetBrains Mono", monospace';
  const w = ctx.measureText(text).width + 12;
  const h = 15;
  ctx.fillStyle = bg;
  roundRect(ctx, cx - w / 2, topY, w, h, 6);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, topY + h / 2 + 1);
}

function drawSpeechBubble(ctx, cx, bottomY, nowMs) {
  if (Math.sin(nowMs / 260) < -0.35) return; // blink off briefly, like mid-sentence pauses
  const w = 26,
    h = 15;
  roundRect(ctx, cx - w / 2, bottomY - h, w, h, 5);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#6b6358";
  const dotY = bottomY - h / 2;
  for (const dx of [-6, 0, 6]) {
    ctx.beginPath();
    ctx.arc(cx + dx, dotY, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ---------- isometric projection ---------- */

const TILE_W = 60;
const TILE_H = 30;

function isoPoint(gx, gy) {
  return { x: ((gx - gy) * TILE_W) / 2, y: ((gx + gy) * TILE_H) / 2 };
}
function tileCenter(gx, gy) {
  return isoPoint(gx + 0.5, gy + 0.5);
}

function isoBounds(gridW, gridD, topMargin, bottomMargin) {
  const left = isoPoint(0, gridD).x;
  const right = isoPoint(gridW, 0).x;
  const bottom = isoPoint(gridW, gridD).y;
  return {
    width: right - left,
    height: bottom + topMargin + bottomMargin,
    originX: -left,
    originY: topMargin,
  };
}

function drawFloorTile(ctx, gx, gy, color) {
  const p0 = isoPoint(gx, gy);
  const p1 = isoPoint(gx + 1, gy);
  const p2 = isoPoint(gx + 1, gy + 1);
  const p3 = isoPoint(gx, gy + 1);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();
  ctx.fillStyle = shade(color, tod0().dark);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.07)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawWallEdge(ctx, gx1, gy1, gx2, gy2, h, faceColor, topColor) {
  const dark = tod0().dark;
  const b1 = isoPoint(gx1, gy1);
  const b2 = isoPoint(gx2, gy2);
  const t1 = { x: b1.x, y: b1.y - h };
  const t2 = { x: b2.x, y: b2.y - h };
  ctx.beginPath();
  ctx.moveTo(b1.x, b1.y);
  ctx.lineTo(t1.x, t1.y);
  ctx.lineTo(t2.x, t2.y);
  ctx.lineTo(b2.x, b2.y);
  ctx.closePath();
  ctx.fillStyle = shade(faceColor, dark);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(t1.x, t1.y);
  ctx.lineTo(t2.x, t2.y);
  ctx.strokeStyle = shade(topColor, dark);
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** A small iso cuboid (desk, cart, bench…): top face + two shaded side faces. */
function drawIsoBox(ctx, gx, gy, w, d, h, topColor, leftColor, rightColor) {
  const dark = tod0().dark;
  topColor = shade(topColor, dark);
  leftColor = shade(leftColor, dark);
  rightColor = shade(rightColor, dark);
  const top = {
    a: isoPoint(gx, gy),
    b: isoPoint(gx + w, gy),
    c: isoPoint(gx + w, gy + d),
    d: isoPoint(gx, gy + d),
  };
  for (const k in top) top[k] = { x: top[k].x, y: top[k].y - h };

  // right face (between b-c edge, going down to floor)
  const bFloor = isoPoint(gx + w, gy);
  const cFloor = isoPoint(gx + w, gy + d);
  ctx.beginPath();
  ctx.moveTo(top.b.x, top.b.y);
  ctx.lineTo(top.c.x, top.c.y);
  ctx.lineTo(cFloor.x, cFloor.y);
  ctx.lineTo(bFloor.x, bFloor.y);
  ctx.closePath();
  ctx.fillStyle = rightColor;
  ctx.fill();

  // left face (c-d edge)
  const dFloor = isoPoint(gx, gy + d);
  ctx.beginPath();
  ctx.moveTo(top.c.x, top.c.y);
  ctx.lineTo(top.d.x, top.d.y);
  ctx.lineTo(dFloor.x, dFloor.y);
  ctx.lineTo(cFloor.x, cFloor.y);
  ctx.closePath();
  ctx.fillStyle = leftColor;
  ctx.fill();

  // top face
  ctx.beginPath();
  ctx.moveTo(top.a.x, top.a.y);
  ctx.lineTo(top.b.x, top.b.y);
  ctx.lineTo(top.c.x, top.c.y);
  ctx.lineTo(top.d.x, top.d.y);
  ctx.closePath();
  ctx.fillStyle = topColor;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/* ---------- character art (billboarded 2D sprite standing on the iso floor) ---------- */

function drawHead(ctx, cx, top, palette) {
  ctx.fillStyle = palette.skin;
  ctx.fillRect(cx - 8, top, 16, 16);
  ctx.fillStyle = palette.hair;
  ctx.fillRect(cx - 9, top - 3, 18, 6);
  ctx.fillRect(cx - 9, top, 3, 10);
  ctx.fillRect(cx + 6, top, 3, 10);
  ctx.fillStyle = "#2a211a";
  ctx.fillRect(cx - 4, top + 8, 2, 2);
  ctx.fillRect(cx + 2, top + 8, 2, 2);
}

function drawCheckBadge(ctx, cx, cy, scale) {
  if (scale <= 0) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fillStyle = "#4caf7d";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-4, 0);
  ctx.lineTo(-1, 3.5);
  ctx.lineTo(4.5, -4);
  ctx.stroke();
  ctx.restore();
}

function drawErrorBadge(ctx, cx, cy) {
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fillStyle = "#d9534f";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 3, cy - 3);
  ctx.lineTo(cx + 3, cy + 3);
  ctx.moveTo(cx + 3, cy - 3);
  ctx.lineTo(cx - 3, cy + 3);
  ctx.stroke();
}

/** Draws a person and returns the screen y of the top of their head, so
 *  callers can anchor name/status chips and speech bubbles above them. */
function drawPerson(ctx, cx, groundY, phase, o) {
  const { nowMs, palette, walking, doneRecently, doneSince, errored } = o;
  const bob = Math.sin(nowMs / 420) * 1.3;

  if (phase === "seated") {
    const typeBounce = o.typing ? Math.sin(nowMs / 110) * 2 : 0;
    const torsoBottom = groundY + 6;
    const torsoTop = torsoBottom - 20 + bob * 0.4;
    const headTop = torsoTop - 16 + bob * 0.6;

    ctx.fillStyle = palette.shirt;
    ctx.fillRect(cx - 11, torsoTop, 22, 20);

    ctx.fillStyle = palette.skin;
    if (doneRecently) {
      const raise = easeOutQuad(Math.min(1, doneSince / 260)) * 16;
      ctx.fillRect(cx - 15, torsoTop + 2 - raise, 5, 14);
      ctx.fillRect(cx + 10, torsoTop + 2 - raise, 5, 14);
    } else {
      ctx.fillRect(cx - 14, torsoTop + 10 + typeBounce, 5, 9);
      ctx.fillRect(cx + 9, torsoTop + 10 - typeBounce, 5, 9);
    }

    drawHead(ctx, cx, headTop, palette);
    if (doneRecently) drawCheckBadge(ctx, cx, headTop - 14, easeOutQuad(Math.min(1, doneSince / 300)));
    else if (errored) drawErrorBadge(ctx, cx, headTop - 12);
    return { headTop };
  }

  // standing / walking: full body, legs visible, no desk
  const legSwing = walking ? 4 * Math.sin((nowMs / 170) % (Math.PI * 2)) : 0;
  const torsoBottom = groundY - 2;
  const torsoTop = torsoBottom - 20 + (walking ? 0 : bob * 0.4);
  const headTop = torsoTop - 16 + (walking ? 0 : bob * 0.6);

  ctx.fillStyle = "#39342c";
  ctx.fillRect(cx - 9, torsoBottom, 7, 20 + legSwing);
  ctx.fillRect(cx + 2, torsoBottom, 7, 20 - legSwing);

  ctx.fillStyle = palette.shirt;
  ctx.fillRect(cx - 11, torsoTop, 22, 20);

  ctx.fillStyle = palette.skin;
  const armSwing = walking ? -legSwing * 0.6 : 0;
  ctx.fillRect(cx - 14, torsoTop + 2 + armSwing, 5, 14);
  ctx.fillRect(cx + 9, torsoTop + 2 - armSwing, 5, 14);

  drawHead(ctx, cx, headTop, palette);
  return { headTop };
}

/* ---------- office floor: rooms, desks, people (wander + chat while idle) ---------- */

const ROOM_D = 3; // 0: front aisle, 1: desk row, 2: back area
// Gap (in tiles) left as plain hallway between stacked room-rows. Rooms are
// flat billboards sorted purely by gx+gy, not real 3D occluders — with no
// gap, a character wandering to the back of one room and a character at the
// front of the room directly "south" of it sit close enough on screen that
// one sprite can swallow the other whole even though a wall sits between
// their rooms. The gap keeps that worst case to a partial, readable overlap.
const ROW_GAP = 1;
const WANDER_ROWS = [0, 2];
const DESK_H = 16;
const WALL_H = 36;
const TRIM_H = 8; // low outer edge on the open sides, so the floor still reads as one enclosed rectangle
const WALK_SPEED = 1.7; // tiles / second

const anim = new Map(); // position id -> behavior state
let nextChatCheckAt = 0;

function groupByRoom(positions) {
  const map = new Map();
  for (const p of positions) {
    if (!map.has(p.room)) map.set(p.room, []);
    map.get(p.room).push(p);
  }
  return map;
}

/** Packs rooms into a roughly square grid of rows x cols (rather than one
 *  long strip) so the whole floor reads as a rectangle, not a vertical/
 *  diagonal line, no matter how many positions the company config has. */
function layoutFloor(byRoom) {
  const entries = [...byRoom];
  const n = Math.max(1, entries.length);
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / cols);
  let cellW = 3;
  for (const [, positions] of entries) cellW = Math.max(cellW, positions.length * 2 + 1);

  const cellsFlat = entries.map(([room, positions], i) => ({
    room,
    positions,
    w: positions.length * 2 + 1,
    gx: (i % cols) * cellW,
    gy: Math.floor(i / cols) * (ROOM_D + ROW_GAP),
  }));

  return { cellsFlat, gridW: cols * cellW, gridD: rows * ROOM_D + (rows - 1) * ROW_GAP };
}

function ensureAnim(id, deskTile) {
  let a = anim.get(id);
  if (!a) {
    a = {
      mode: "seated",
      pos: { x: deskTile.x, y: deskTile.y },
      walk: null,
      standUntil: 0,
      chatWith: null,
      chatUntil: 0,
      lastStatus: null,
    };
    anim.set(id, a);
  }
  return a;
}

function startWalk(a, to, nowMs, onArrive) {
  const dist = Math.hypot(to.x - a.pos.x, to.y - a.pos.y) || 0.0001;
  a.walk = { from: { ...a.pos }, to, start: nowMs, dur: Math.max(300, (dist / WALK_SPEED) * 1000), onArrive };
  a.mode = "walk";
}

function stepWalk(a, nowMs) {
  if (a.mode !== "walk" || !a.walk) return;
  const t = Math.min(1, (nowMs - a.walk.start) / a.walk.dur);
  a.pos = { x: lerp(a.walk.from.x, a.walk.to.x, t), y: lerp(a.walk.from.y, a.walk.to.y, t) };
  if (t >= 1) {
    const onArrive = a.walk.onArrive;
    a.walk = null;
    a.mode = onArrive;
    if (onArrive === "stand") a.standUntil = nowMs + rand(1800, 4200);
    if (onArrive === "chat") a.chatUntil = nowMs + rand(3000, 5200);
  }
}

function releaseChat(a) {
  if (a.chatWith) {
    const partner = anim.get(a.chatWith);
    if (partner && partner.chatWith) partner.chatWith = null;
    a.chatWith = null;
  }
}

function pickWanderTile(bounds) {
  const y = pick(WANDER_ROWS, Math.floor(Math.random() * 1000)) + bounds.gy;
  const x = rand(bounds.gx + 0.4, bounds.gx + bounds.w - 0.4);
  return { x, y };
}

/** Drives one position's idle wander / chat / shift behavior for this frame. */
function updateBehavior(p, deskTile, roomBounds, nowMs) {
  const a = ensureAnim(p.id, deskTile);

  if (p.status !== "waiting_shift") {
    if (a.chatWith) releaseChat(a);
    const atDesk = a.mode === "seated" || (a.mode === "walk" && a.walk && a.walk.onArrive === "seated");
    if (!atDesk) startWalk(a, deskTile, nowMs, "seated");
    stepWalk(a, nowMs);
    a.lastStatus = p.status;
    return a;
  }
  a.lastStatus = p.status;

  if (a.mode === "seated") {
    a.mode = "stand";
    a.standUntil = nowMs + rand(200, 900);
    return a;
  }
  if (a.mode === "chat") {
    if (nowMs >= a.chatUntil) {
      releaseChat(a);
      a.mode = "stand";
      a.standUntil = nowMs + rand(600, 1600);
    }
    return a;
  }
  if (a.mode === "walk") {
    stepWalk(a, nowMs);
    return a;
  }
  // mode === "stand": free to wander once the pause is over
  if (nowMs >= a.standUntil) {
    startWalk(a, pickWanderTile(roomBounds), nowMs, "stand");
  }
  return a;
}

/** Occasionally pairs up two idle, unpaired people in the same room for a chat. */
function tryPairChats(byRoom, roomBoundsByPos, nowMs) {
  if (nowMs < nextChatCheckAt) return;
  nextChatCheckAt = nowMs + rand(4000, 8000);
  for (const [, positions] of byRoom) {
    const idle = positions.filter((p) => {
      const a = anim.get(p.id);
      return a && a.mode === "stand" && !a.chatWith && p.status === "waiting_shift";
    });
    if (idle.length >= 2 && Math.random() < 0.55) {
      const shuffled = idle.slice().sort(() => Math.random() - 0.5);
      const [pa, pb] = shuffled;
      const aa = anim.get(pa.id);
      const ab = anim.get(pb.id);
      const bounds = roomBoundsByPos.get(pa.id);
      const mid = {
        x: clamp((aa.pos.x + ab.pos.x) / 2, bounds.gx + 0.6, bounds.gx + bounds.w - 0.6),
        y: WANDER_ROWS[0] + bounds.gy + 0.5,
      };
      aa.chatWith = pb.id;
      ab.chatWith = pa.id;
      startWalk(aa, { x: mid.x - 0.4, y: mid.y }, nowMs, "chat");
      startWalk(ab, { x: mid.x + 0.4, y: mid.y }, nowMs, "chat");
    }
  }
}

function drawDesk(gx, gy) {
  drawIsoBox(ctx0(), gx + 0.15, gy + 0.15, 0.7, 0.7, DESK_H, "#8a5a34", "#6e4526", "#7a4e2c");
  const m = tileCenter(gx, gy);
  const mTop = { x: m.x, y: m.y - DESK_H - 11 };
  ctx0().fillStyle = "#2b2b2b";
  ctx0().fillRect(mTop.x - 7, mTop.y, 14, 11);
  ctx0().fillStyle = "#86d6ff";
  ctx0().fillRect(mTop.x - 5, mTop.y + 2, 10, 7);
}

let _ctx = null;
function ctx0() {
  return _ctx;
}

/** A hanging ceiling lamp, off (plain fixture) by day and glowing warm once
 *  `tod.lamp` rises in the evening — the office's own lights, distinct from
 *  (but timed together with) the street lamps and lit windows outside. */
function drawCeilingLight(cx, cy) {
  const ctx = ctx0();
  const tod = tod0();
  ctx.fillStyle = shade("#2e2a22", tod.dark * 0.5);
  ctx.fillRect(cx - 1.5, cy - 7, 3, 7);
  if (tod.lamp > 0.12) {
    const r = 20 + tod.lamp * 6;
    const glow = ctx.createRadialGradient(cx, cy + 5, 1, cx, cy + 5, r);
    glow.addColorStop(0, `rgba(255,228,170,${0.4 * tod.lamp})`);
    glow.addColorStop(1, "rgba(255,228,170,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy + 5, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy + 5, 5, 0, Math.PI * 2);
  ctx.fillStyle = tod.lamp > 0.12 ? "#ffe9b0" : shade("#4a443a", tod.dark * 0.5);
  ctx.fill();
}

/** An analog clock on the shared space's wall, always showing the viewer's
 *  real local time — the same clock the day/night sky and every agent's
 *  shift schedule are driven by, made visible. Drawn un-shaded (like the
 *  status chips) so it stays readable at any hour. */
function drawWallClock(cx, cy, nowMs) {
  const ctx = ctx0();
  const d = new Date(nowMs);
  const h = d.getHours() % 12;
  const m = d.getMinutes();
  const s = d.getSeconds();
  const r = 16;

  ctx.beginPath();
  ctx.arc(cx, cy, r + 2.5, 0, Math.PI * 2);
  ctx.fillStyle = "#3a342b";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#f5f1e6";
  ctx.fill();

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const inner = i % 3 === 0 ? r - 4 : r - 2.5;
    ctx.strokeStyle = "#6b6358";
    ctx.lineWidth = i % 3 === 0 ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * (r - 1.5), cy - Math.cos(a) * (r - 1.5));
    ctx.lineTo(cx + Math.sin(a) * inner, cy - Math.cos(a) * inner);
    ctx.stroke();
  }

  const hand = (angle, len, width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(angle) * len, cy - Math.cos(angle) * len);
    ctx.stroke();
  };
  hand(((h + m / 60) / 12) * Math.PI * 2, r * 0.48, 2, "#2e2a22");
  hand(((m + s / 60) / 60) * Math.PI * 2, r * 0.74, 1.5, "#2e2a22");
  hand((s / 60) * Math.PI * 2, r * 0.8, 1, "#c0504a");

  ctx.beginPath();
  ctx.arc(cx, cy, 1.6, 0, Math.PI * 2);
  ctx.fillStyle = "#2e2a22";
  ctx.fill();
}

function buildFloorScene(positions) {
  const byRoom = groupByRoom(positions);
  const { cellsFlat, gridW, gridD } = layoutFloor(byRoom);
  const bounds = isoBounds(gridW, gridD, 90, 16);

  const deskTileByPos = new Map();
  const roomBoundsByPos = new Map();
  for (const cell of cellsFlat) {
    cell.positions.forEach((p, i) => {
      deskTileByPos.set(p.id, { x: cell.gx + 1 + i * 2 + 0.5, y: cell.gy + 1.5 });
      roomBoundsByPos.set(p.id, { gx: cell.gx, gy: cell.gy, w: cell.w });
    });
  }
  return { byRoom, gridW, gridD, bounds, deskTileByPos, roomBoundsByPos, cellsFlat };
}

function drawFloorScene(ctx, scene, nowMs, historyMode) {
  const { gridW, gridD, bounds, cellsFlat, deskTileByPos, roomBoundsByPos, byRoom } = scene;
  _ctx = ctx;
  ctx.save();
  ctx.translate(bounds.originX, bounds.originY);

  // History mode shows each position's *status* accurately as of the
  // scrubbed time, but the idle wander/chat choreography was never recorded
  // anywhere (client-side-only, randomized, not synced across viewers) and
  // can't be replayed — so freeze everyone at their desk instead of feeding
  // reconstructed-past status into the live wander state machine.
  if (!historyMode) {
    for (const p of [].concat(...byRoom.values())) {
      updateBehavior(p, deskTileByPos.get(p.id), roomBoundsByPos.get(p.id), nowMs);
    }
    tryPairChats(byRoom, roomBoundsByPos, nowMs);
  }

  const queue = [];

  // floor tiles — every tile in the grid, including hallway filler for rows
  // shorter than the widest room and for the ROW_GAP strip between stacked
  // room-rows (both just read as plain floor, no room color/walls).
  for (let gy = 0; gy < gridD; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const cell = cellsFlat.find((c) => gx >= c.gx && gx < c.gx + c.w && gy >= c.gy && gy < c.gy + ROOM_D);
      const color = cell ? pick(PALETTE.floor, hashStr(cell.room)) : "#e4ded0";
      const key = gx + gy;
      queue.push({ key, fn: ((gx_, gy_, color_) => () => drawFloorTile(ctx, gx_, gy_, color_))(gx, gy, color) });
    }
  }

  // partition walls: every room draws its own west + north edge
  for (const cell of cellsFlat) {
    const x0 = cell.gx,
      x1 = cell.gx + cell.w,
      y0 = cell.gy,
      y1 = cell.gy + ROOM_D;
    queue.push({
      key: x0 + y0 - 0.5,
      fn: () => drawWallEdge(ctx, x0, y0, x0, y1, WALL_H, "#9c8f78", "#b5a98f"),
    });
    queue.push({
      key: x0 + y0 - 0.5,
      fn: () => drawWallEdge(ctx, x0, y0, x1, y0, WALL_H, "#857c6c", "#9c927f"),
    });
    const lampAnchor = tileCenter(x0 + (x1 - x0) / 2 - 0.5, y0 + 0.6);
    queue.push({
      key: x0 + y0 + 0.1,
      fn: () => drawCeilingLight(lampAnchor.x, lampAnchor.y - WALL_H - 4),
    });
  }

  // low trim along the open south/east edges: the north/west walls above
  // already close two sides, this closes the rest so the whole floor reads
  // as one enclosed rectangular space rather than open-ended rooms in a row.
  queue.push({ key: gridW + gridD + 1, fn: () => drawWallEdge(ctx, 0, gridD, gridW, gridD, TRIM_H, "#9c8f78", "#b5a98f") });
  queue.push({ key: gridW + gridD + 1, fn: () => drawWallEdge(ctx, gridW, 0, gridW, gridD, TRIM_H, "#9c8f78", "#b5a98f") });

  // a real-time wall clock, hung on the shared space's side wall — the back
  // wall sits right behind where people cluster and wander, so it kept
  // getting covered there; the west wall's room seam stays mostly clear.
  const clockAnchor = isoPoint(0, gridD / 2);
  queue.push({
    key: gridD / 2 + 0.4,
    fn: () => drawWallClock(clockAnchor.x, clockAnchor.y - WALL_H * 0.62, nowMs),
  });

  // desks
  for (const [room, positions] of byRoom) {
    positions.forEach((p) => {
      const t = deskTileByPos.get(p.id);
      const dgx = Math.floor(t.x - 0.5);
      const dgy = Math.floor(t.y - 0.5);
      queue.push({ key: dgx + dgy + 0.3, fn: () => drawDesk(dgx, dgy) });
    });
  }

  // people
  const chips = [];
  for (const [, positions] of byRoom) {
    for (const p of positions) {
      const a = anim.get(p.id);
      const deskTile = deskTileByPos.get(p.id);
      const seed = hashStr(p.id);
      const palette = {
        skin: pick(PALETTE.skin, seed),
        hair: pick(PALETTE.hair, seed >> 2),
        shirt: pick(PALETTE.shirt, seed >> 4),
      };
      const atDeskNow = historyMode || a.mode === "seated";
      // a.pos / deskTile already carry a tile-center-style coordinate, so
      // project with isoPoint directly — tileCenter() would add another +0.5
      // and visibly offset the sprite/chips from where the logic thinks it is.
      const renderPos = historyMode ? deskTile : a.pos;
      const pt = isoPoint(renderPos.x, renderPos.y);
      const key = renderPos.x + renderPos.y;

      queue.push({
        key,
        fn: () => {
          let headTop;
          if (atDeskNow) {
            const deskTop = isoPoint(deskTile.x, deskTile.y);
            ({ headTop } = drawPerson(ctx, deskTop.x, deskTop.y - DESK_H, "seated", {
              nowMs,
              palette,
              typing: p.status === "running",
              doneRecently: p.status === "done" && p.lastRunAt && nowMs - p.lastRunAt < 2400,
              doneSince: p.lastRunAt ? nowMs - p.lastRunAt : null,
              errored: p.status === "error",
            }));
          } else {
            ({ headTop } = drawPerson(ctx, pt.x, pt.y, "stand", {
              nowMs,
              palette,
              walking: a.mode === "walk",
            }));
          }
          chips.push(() => {
            drawChip(ctx, pt.x, headTop - 32, p.name, "rgba(28,24,18,0.82)");
            const label = (STATUS_LABEL[p.status] || (() => p.status))(p);
            drawChip(ctx, pt.x, headTop - 15, label, STATUS_COLOR[p.status] || "#8f8468");
            if (!historyMode && a.mode === "chat") drawSpeechBubble(ctx, pt.x, headTop - 36, nowMs);
          });
        },
      });
    }
  }

  queue.sort((a, b) => a.key - b.key);
  for (const job of queue) job.fn();
  for (const chip of chips) chip();

  ctx.restore();
  return bounds;
}

/* ---------- ground / street scene (ambient, not tied to agent data) ---------- */

const GROUND_D = 4; // 0: building base, 1: sidewalk, 2-3: road

function drawLampPost(gx, gy) {
  const ctx = ctx0();
  const tod = tod0();
  const base = tileCenter(gx, gy);
  ctx.fillStyle = shade("#3a362f", tod.dark);
  ctx.fillRect(base.x - 1.5, base.y - 46, 3, 46);
  if (tod.lamp > 0.1) {
    const r = 14 + tod.lamp * 5;
    const glow = ctx.createRadialGradient(base.x, base.y - 50, 1, base.x, base.y - 50, r);
    glow.addColorStop(0, `rgba(255,221,140,${0.55 * tod.lamp})`);
    glow.addColorStop(1, "rgba(255,221,140,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(base.x, base.y - 50, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(base.x, base.y - 50, 5, 0, Math.PI * 2);
  ctx.fillStyle = tod.lamp > 0.1 ? "#ffe49a" : shade("#8a8372", tod.dark);
  ctx.fill();
}

function drawTree(gx, gy) {
  const ctx = ctx0();
  const dark = tod0().dark;
  const base = tileCenter(gx, gy);
  ctx.fillStyle = shade("#6b4a2d", dark);
  ctx.fillRect(base.x - 3, base.y - 26, 6, 26);
  ctx.fillStyle = shade("#5f8c53", dark);
  ctx.beginPath();
  ctx.arc(base.x, base.y - 32, 15, 0, Math.PI * 2);
  ctx.fill();
}

function drawCar(gx, gy) {
  const ctx = ctx0();
  drawIsoBox(ctx, gx, gy, 1.6, 0.9, 14, "#a15b4f", "#7e4038", "#8c473e");
  drawIsoBox(ctx, gx + 0.3, gy + 0.1, 0.9, 0.7, 12, "#cde7f2", "#a9c3cc", "#b8d2db");
}

function drawVendorCart(gx, gy, nowMs) {
  const ctx = ctx0();
  drawIsoBox(ctx, gx, gy, 1, 0.8, 20, "#d8a24a", "#a97a32", "#c08f3d");
  const top = tileCenter(gx + 0.5, gy + 0.4);
  const poleTop = { x: top.x, y: top.y - 20 - 26 };
  ctx.strokeStyle = "#6b4a2d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(top.x, top.y - 20);
  ctx.lineTo(poleTop.x, poleTop.y);
  ctx.stroke();
  const sway = Math.sin(nowMs / 900) * 2;
  ctx.fillStyle = shade("#c0504a", tod0().dark);
  ctx.beginPath();
  ctx.moveTo(poleTop.x - 24 + sway, poleTop.y + 8);
  ctx.lineTo(poleTop.x + 24 + sway, poleTop.y + 8);
  ctx.lineTo(poleTop.x, poleTop.y - 10);
  ctx.closePath();
  ctx.fill();
  // steam wisps
  for (let i = 0; i < 2; i++) {
    const t = (nowMs / 900 + i * 0.5) % 1;
    ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - t)})`;
    ctx.beginPath();
    ctx.arc(top.x - 6 + i * 10, top.y - 24 - t * 20, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBench(gx, gy) {
  drawIsoBox(ctx0(), gx, gy, 1.6, 0.5, 8, "#8a6a46", "#6e5236", "#7c5d3d");
}

function drawTrashBin(gx, gy) {
  drawIsoBox(ctx0(), gx, gy, 0.4, 0.4, 13, "#5a6b5a", "#44503f", "#4e5c4a");
}

/** A real road-crossing light, cycling green -> yellow -> red like a real one
 *  (not an even three-way split), so it reads as something actually timed. */
function drawTrafficLight(gx, gy, nowMs) {
  const ctx = ctx0();
  const dark = tod0().dark;
  const base = tileCenter(gx, gy);
  ctx.fillStyle = shade("#3a362f", dark);
  ctx.fillRect(base.x - 1.5, base.y - 52, 3, 52);
  const boxX = base.x - 6,
    boxY = base.y - 66;
  ctx.fillStyle = shade("#2a2822", dark);
  ctx.fillRect(boxX, boxY, 12, 28);

  const cycle = nowMs % 9000;
  const activeIdx = cycle < 4500 ? 2 : cycle < 5500 ? 1 : 0; // 0 red, 1 yellow, 2 green
  const colors = ["#d9534f", "#ffd24a", "#4caf7d"];
  for (let i = 0; i < 3; i++) {
    const cy = boxY + 6 + i * 9;
    const on = i === activeIdx;
    if (on) {
      const glow = ctx.createRadialGradient(boxX + 6, cy, 1, boxX + 6, cy, 9);
      glow.addColorStop(0, `${colors[i]}88`);
      glow.addColorStop(1, `${colors[i]}00`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(boxX + 6, cy, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(boxX + 6, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = on ? colors[i] : shade(colors[i], 0.78);
    ctx.fill();
  }
}

/** A small dog trotting beside its owner — purely cosmetic street life. */
function drawDog(cx, groundY, nowMs) {
  const ctx = ctx0();
  const dark = tod0().dark;
  const swing = 2.2 * Math.sin(nowMs / 170);
  const bodyY = groundY - 6;
  ctx.fillStyle = shade("#6b4a2d", dark);
  ctx.fillRect(cx - 6, bodyY + 1, 2, 4 + swing);
  ctx.fillRect(cx - 2, bodyY + 1, 2, 4 - swing);
  ctx.fillRect(cx + 2, bodyY + 1, 2, 4 + swing);
  ctx.fillRect(cx + 4, bodyY + 1, 2, 4 - swing);
  ctx.fillStyle = shade("#b08a54", dark);
  ctx.fillRect(cx - 7, bodyY - 3, 13, 5);
  ctx.fillRect(cx - 9, bodyY - 5, 5, 5);
  ctx.fillRect(cx + 5, bodyY - 6, 2, 4);
}

/** Smooth back-and-forth pacing along the sidewalk, independent of any agent
 *  data — ambient pedestrian traffic. */
function walkerX(nowMs, periodMs, xMin, xMax, phase) {
  const t = (nowMs / periodMs + phase) % 2;
  return t < 1 ? lerp(xMin, xMax, t) : lerp(xMax, xMin, t - 1);
}

function drawGroundScene(ctx, gridW, nowMs) {
  _ctx = ctx;
  const bounds = isoBounds(gridW, GROUND_D, 70, 10);
  ctx.save();
  ctx.translate(bounds.originX, bounds.originY);

  const queue = [];
  for (let gy = 0; gy < GROUND_D; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const color = gy === 0 ? "#847c6e" : gy === 1 ? "#cfc9ba" : "#514d49";
      queue.push({ key: gx + gy, fn: ((gx_, gy_, c) => () => drawFloorTile(ctx, gx_, gy_, c))(gx, gy, color) });
    }
  }
  // road lane markings
  for (let gx = 0; gx < gridW; gx += 2) {
    queue.push({
      key: gx + 2.5,
      fn: ((gx_) => () => {
        const p = tileCenter(gx_, 2.5);
        ctx.fillStyle = "#e8d978";
        ctx.fillRect(p.x - 6, p.y - 1.5, 12, 3);
      })(gx),
    });
  }

  // building base wall along the sidewalk, with an entrance door set into it
  const doorX = Math.floor(gridW / 2);
  queue.push({ key: -0.5, fn: () => drawWallEdge(ctx, 0, 0, gridW, 0, 30, "#857c6c", "#9c927f") });
  queue.push({
    key: doorX + 0.2,
    fn: () => {
      drawIsoBox(ctx, doorX - 0.35, -0.02, 0.9, 0.3, 26, "#3d372c", "#2a251e", "#332e25");
      const p = tileCenter(doorX + 0.1, 0.1);
      ctx.fillStyle = tod0().lamp > 0.2 ? `rgba(255,221,150,${0.6 + 0.3 * tod0().lamp})` : "#86c6e8";
      ctx.fillRect(p.x - 7, p.y - 34, 6, 15);
      ctx.fillRect(p.x + 1, p.y - 34, 6, 15);
    },
  });

  queue.push({ key: 0.6, fn: () => drawLampPost(1, 1) });
  queue.push({ key: gridW - 1.4, fn: () => drawTree(gridW - 2, 1) });
  queue.push({ key: gridW - 4.4, fn: () => drawCar(gridW - 5, 2.1) });
  queue.push({ key: gridW - 6.5, fn: () => drawTrafficLight(gridW - 7, 1.9, nowMs) });
  queue.push({ key: doorX - 3.3, fn: () => drawTrashBin(doorX - 3.5, 1.3) });

  // street vendor stall, off to one side
  const vgx = 2.0,
    vgy = 1.15;
  queue.push({ key: vgx + vgy + 0.5, fn: () => drawVendorCart(vgx, vgy, nowMs) });
  queue.push({
    key: vgx + vgy + 1.1,
    fn: () => {
      const seed = hashStr("vendor");
      const palette = { skin: pick(PALETTE.skin, seed), hair: pick(PALETTE.hair, seed >> 2), shirt: pick(PALETTE.shirt, seed >> 4) };
      const pt = tileCenter(vgx + 1.9, vgy + 0.1);
      drawPerson(ctx, pt.x, pt.y, "stand", { nowMs, palette, walking: false });
    },
  });

  // a bench with two NPCs having a drink and a chat, clear of the door and vendor
  const bgx = doorX + 3,
    bgy = 1.15;
  queue.push({ key: bgx + bgy + 0.4, fn: () => drawBench(bgx, bgy) });
  const benchMid = tileCenter(bgx + 1.1, bgy + 0.25);
  for (let i = 0; i < 2; i++) {
    const px = bgx + 0.4 + i * 1.3;
    const py = bgy + 0.25;
    queue.push({
      key: bgx + bgy + 0.6 + i * 0.1,
      fn: () => {
        const seed = hashStr("bench" + i);
        const palette = { skin: pick(PALETTE.skin, seed), hair: pick(PALETTE.hair, seed >> 2), shirt: pick(PALETTE.shirt, seed >> 4) };
        const pt = tileCenter(px, py);
        drawPerson(ctx, pt.x, pt.y, "stand", { nowMs, palette, walking: false });
        ctx.fillStyle = "#f2efe8";
        ctx.fillRect(pt.x + (i === 0 ? 10 : -14), pt.y - 24, 6, 7);
      },
    });
  }
  queue.push({ key: bgx + bgy + 0.85, fn: () => drawSpeechBubble(ctx, benchMid.x, benchMid.y - 38, nowMs) });

  // two pedestrians pacing the sidewalk, one walking a dog — ambient street
  // life independent of any agent data, like the vendor and bench above.
  const walkY = 1.35;
  const w1x = walkerX(nowMs, 9000, 1.5, gridW - 1.5, 0);
  const w2x = walkerX(nowMs, 12000, 1.5, gridW - 1.5, 0.55);
  queue.push({
    key: w1x + walkY,
    fn: () => {
      const seed = hashStr("walker1");
      const palette = { skin: pick(PALETTE.skin, seed), hair: pick(PALETTE.hair, seed >> 2), shirt: pick(PALETTE.shirt, seed >> 4) };
      const pt = tileCenter(w1x, walkY);
      drawPerson(ctx, pt.x, pt.y, "stand", { nowMs, palette, walking: true });
      drawDog(pt.x - 13, pt.y, nowMs);
    },
  });
  queue.push({
    key: w2x + walkY + 0.05,
    fn: () => {
      const seed = hashStr("walker2");
      const palette = { skin: pick(PALETTE.skin, seed), hair: pick(PALETTE.hair, seed >> 2), shirt: pick(PALETTE.shirt, seed >> 4) };
      const pt = tileCenter(w2x, walkY);
      drawPerson(ctx, pt.x, pt.y, "stand", { nowMs, palette, walking: true });
    },
  });

  queue.sort((a, b) => a.key - b.key);
  for (const job of queue) job.fn();

  ctx.restore();
  return bounds;
}

/* ---------- sky / roof / "other floors" bands (flat, decorative) ---------- */

const SKY_H = 58;
const ROOF_H = 16;
const WIN_STRIP_H = 24;

function drawSky(ctx, w, nowMs, tod) {
  const grad = ctx.createLinearGradient(0, 0, 0, SKY_H);
  grad.addColorStop(0, tod.skyTop);
  grad.addColorStop(1, tod.skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, SKY_H);

  if (tod.dark > 0.45) {
    const starAlpha = clamp((tod.dark - 0.45) * 1.8, 0, 1);
    for (let i = 0; i < 18; i++) {
      const sx = (hashStr("star" + i) % 997) / 997 * w;
      const sy = (hashStr("stary" + i) % 401) / 401 * (SKY_H - 10) + 4;
      const twinkle = 0.5 + 0.5 * Math.sin(nowMs / 900 + i * 7);
      ctx.fillStyle = `rgba(255,255,255,${starAlpha * (0.4 + 0.5 * twinkle)})`;
      ctx.fillRect(sx, sy, 1.6, 1.6);
    }
  }

  if (tod.sunAlpha > 0.01) {
    ctx.fillStyle = `rgba(255,221,120,${0.9 * tod.sunAlpha})`;
    ctx.beginPath();
    ctx.arc(w - 36, 22, 13, 0, Math.PI * 2);
    ctx.fill();
  }
  if (tod.moonAlpha > 0.01) {
    ctx.fillStyle = `rgba(233,237,245,${tod.moonAlpha})`;
    ctx.beginPath();
    ctx.arc(w - 36, 22, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(180,190,210,${0.5 * tod.moonAlpha})`;
    ctx.beginPath();
    ctx.arc(w - 40, 18, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(w - 33, 26, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  const cloudTint = tod.dark > 0.5 ? "rgba(130,140,170,0.55)" : tod.dark > 0.15 ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.85)";
  const drift = (nowMs / 60000) % 1;
  ctx.fillStyle = cloudTint;
  for (let i = 0; i < 3; i++) {
    const cx = ((drift + i / 3) % 1) * (w + 80) - 40;
    drawCloud(ctx, cx, 16 + i * 12);
  }
}
function drawCloud(ctx, cx, cy) {
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.arc(cx + 8, cy - 3, 8, 0, Math.PI * 2);
  ctx.arc(cx + 17, cy, 7, 0, Math.PI * 2);
  ctx.fill();
}
function drawRoofBand(ctx, y, w) {
  const dark = tod0().dark;
  ctx.fillStyle = shade("#6b6358", dark);
  ctx.fillRect(0, y, w, ROOF_H);
  ctx.fillStyle = shade("#847c6e", dark);
  ctx.fillRect(0, y, w, 3);
  ctx.fillStyle = shade("#4f483f", dark);
  ctx.fillRect(w * 0.25, y - 6, 10, 6);
  ctx.fillRect(w * 0.6, y - 9, 7, 9);
}
function drawWindowStrip(ctx, y, w, seedOffset, nowMs, tod) {
  ctx.fillStyle = shade("#857c6c", tod.dark);
  ctx.fillRect(0, y, w, WIN_STRIP_H);
  const winW = 16,
    gap = 10;
  let x = 10,
    i = 0;
  while (x + winW < w - 6) {
    const seed = hashStr(`w${seedOffset}-${i}`);
    const base = (seed % 100) / 100; // stable per-window threshold
    const blink = Math.sin(nowMs / 1400 + seed) > 0.9;
    const lit = base < tod.lamp * 0.85 + 0.05 || blink;
    ctx.fillStyle = lit ? `rgba(255,221,140,${0.55 + 0.35 * tod.lamp})` : shade("#96b4c3", tod.dark * 0.8 + 0.2);
    ctx.fillRect(x, y + 5, winW, WIN_STRIP_H - 10);
    x += winW + gap;
    i++;
  }
}
function drawFloorPlaque(ctx, x, y) {
  roundRect(ctx, x, y, 50, 18, 4);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fill();
  ctx.fillStyle = "#4a443a";
  ctx.font = '700 9px "JetBrains Mono", monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("TẦNG 4", x + 25, y + 10);
}

/* ---------- assembly ---------- */

let canvas = null;
let ctx = null;
let latestState = null;
let wrapEl = null;

// Mouse-driven camera (scroll to zoom, left-drag to pan) over a fixed-size
// viewport (#building-wrap, overflow:hidden). Applied as a CSS transform on
// the canvas element itself, never touching its drawing coordinate system.
// `userSet` tracks whether the person has taken the wheel/drag — until they
// do, the camera keeps auto-fitting to the whole scene on every resize/data
// update, the same passive behavior the plain CSS auto-fit used to give.
const camera = { x: 0, y: 0, scale: 1, userSet: false };

function clampScale(s) {
  return Math.min(4, Math.max(0.25, s));
}

function applyCamera() {
  canvas.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
}

function fitCamera() {
  if (!wrapEl || !canvas.width || !canvas.height) return;
  const wrapW = wrapEl.clientWidth;
  const wrapH = wrapEl.clientHeight;
  if (!wrapW || !wrapH) return;
  // Never upscale past native pixel size (would blur the pixel art) — only
  // shrink to fit when the scene is bigger than the viewport.
  camera.scale = clampScale(Math.min(1, wrapW / canvas.width, wrapH / canvas.height));
  camera.x = (wrapW - canvas.width * camera.scale) / 2;
  camera.y = Math.max(0, (wrapH - canvas.height * camera.scale) / 2);
  applyCamera();
}

function setupCamera() {
  let dragging = false;
  let last = { x: 0, y: 0 };

  wrapEl.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = wrapEl.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const localX = (mx - camera.x) / camera.scale;
      const localY = (my - camera.y) / camera.scale;
      const newScale = clampScale(camera.scale * Math.exp(-e.deltaY * 0.001));
      camera.x = mx - localX * newScale;
      camera.y = my - localY * newScale;
      camera.scale = newScale;
      camera.userSet = true;
      applyCamera();
    },
    { passive: false },
  );

  wrapEl.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    last = { x: e.clientX, y: e.clientY };
    wrapEl.classList.add("is-dragging");
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    camera.x += e.clientX - last.x;
    camera.y += e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    camera.userSet = true;
    applyCamera();
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    wrapEl.classList.remove("is-dragging");
  });
  wrapEl.addEventListener("dblclick", () => {
    camera.userSet = false;
    fitCamera();
  });
  window.addEventListener("resize", () => {
    if (!camera.userSet) fitCamera();
  });
}

function ensureCanvas() {
  if (canvas) return;
  wrapEl = document.getElementById("building-wrap");
  canvas = document.createElement("canvas");
  canvas.id = "building-canvas";
  buildingEl.appendChild(canvas);
  ctx = canvas.getContext("2d");
  setupCamera();
}

/* ---------- time travel: history/scrubber over the same isometric scene ----
 * "4D" (per the project owner, after clarifying what they meant) = keep the
 * isometric 2D-canvas engine as-is, but add time itself as a first-class,
 * scrubbable axis: real day/night + the wall clock already are pure
 * functions of a single `nowMs`, so decoupling that from `Date.now()` lets
 * the whole scene be viewed at any past moment. Reconstructed from the
 * `logs` table via GET /api/history (see server.ts / state/db.ts) — every
 * status transition is logged there (level:"status"), not just completions.
 * Deliberately NOT replayed: the idle wander/chat choreography, which only
 * ever existed client-side and per-viewer (see drawFloorScene's historyMode
 * branch) — there's no historical "true position" to reconstruct. */

let historyMode = false;
let virtualTimeMs = Date.now();
let playing = false;
let playSpeed = 1;
let historyLogs = [];
let historyRangeStart = Date.now();
let historyRangeEnd = Date.now();
let lastFrameRealMs = null;
let lastFloorLayout = null; // {floorX, floorY, deskTileByPos} from the latest tick(), for panning to a position

/** Reconstructs a position's status as of `atMs` from its "status"-level log
 * rows (sorted ascending by ts): the latest one at or before `atMs`, or
 * "waiting_shift" if none yet existed at that time. */
function statusAtTime(positionId, atMs) {
  let status = "waiting_shift";
  let ts = null;
  for (const l of historyLogs) {
    if (l.positionId !== positionId || l.level !== "status") continue;
    if (l.ts > atMs) break;
    status = l.message;
    ts = l.ts;
  }
  return { status, ts };
}

function positionsAtTime(positions, atMs) {
  return positions.map((p) => {
    const { status, ts } = statusAtTime(p.id, atMs);
    return { ...p, status, lastRunAt: ts };
  });
}

function fmtDateTime(ts) {
  return new Date(ts).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function refreshTimeUI() {
  timeToggleBtn.hidden = historyMode;
  // Not `.hidden` here: #time-controls has its own CSS `display: flex` (an
  // ID selector), which outranks the browser's `[hidden] { display: none }`
  // attribute-selector rule and would leave it visible even when "hidden".
  timeControlsEl.style.display = historyMode ? "flex" : "none";
  timePlayBtn.textContent = playing ? "⏸" : "▶";
  timeSliderEl.min = String(historyRangeStart);
  timeSliderEl.max = String(historyRangeEnd);
  timeSliderEl.value = String(virtualTimeMs);
  timeLabelEl.textContent = historyMode ? fmtDateTime(virtualTimeMs) : "Trực tiếp";
}

function refreshTimeMarkers() {
  timeMarkersEl.innerHTML = "";
  const span = Math.max(1, historyRangeEnd - historyRangeStart);
  for (const l of historyLogs) {
    if (l.level !== "error") continue;
    const pct = clamp(((l.ts - historyRangeStart) / span) * 100, 0, 100);
    const mark = document.createElement("div");
    mark.className = "time-marker";
    mark.style.left = `${pct}%`;
    mark.title = `${l.positionId} · ${fmtDateTime(l.ts)}`;
    mark.addEventListener("click", () => {
      playing = false;
      virtualTimeMs = l.ts;
      panToPosition(l.positionId);
      refreshTimeUI();
    });
    timeMarkersEl.appendChild(mark);
  }
}

async function enterHistoryMode() {
  const until = Date.now();
  try {
    const res = await fetch(`/api/history?since=0&until=${until}`);
    const data = await res.json();
    historyLogs = Array.isArray(data.logs) ? data.logs : [];
  } catch {
    historyLogs = [];
  }
  historyRangeStart = historyLogs.length ? historyLogs[0].ts : until - 3600_000;
  historyRangeEnd = until;
  virtualTimeMs = historyRangeEnd;
  historyMode = true;
  playing = false;
  refreshTimeMarkers();
  refreshTimeUI();
}

function exitHistoryMode() {
  historyMode = false;
  playing = false;
  refreshTimeUI();
}

/** Centers the camera on a position's desk — used when a scrubber error
 * marker is clicked, so the room it happened in is actually in view. */
function panToPosition(positionId) {
  if (!lastFloorLayout || !wrapEl) return;
  const t = lastFloorLayout.deskTileByPos.get(positionId);
  if (!t) return;
  const local = isoPoint(t.x, t.y);
  const px = lastFloorLayout.floorX + local.x;
  const py = lastFloorLayout.floorY + local.y;
  camera.x = wrapEl.clientWidth / 2 - px * camera.scale;
  camera.y = wrapEl.clientHeight / 2 - py * camera.scale;
  camera.userSet = true;
  applyCamera();
}

function setupTimeControls() {
  timeToggleBtn.addEventListener("click", async () => {
    await enterHistoryMode();
  });
  timeLiveBtn.addEventListener("click", () => {
    exitHistoryMode();
  });
  timePlayBtn.addEventListener("click", () => {
    if (!historyMode) return;
    if (virtualTimeMs >= historyRangeEnd) virtualTimeMs = historyRangeStart;
    playing = !playing;
    refreshTimeUI();
  });
  timeSpeedSel.addEventListener("change", () => {
    playSpeed = Number(timeSpeedSel.value) || 1;
  });
  timeSliderEl.addEventListener("input", () => {
    playing = false;
    virtualTimeMs = Number(timeSliderEl.value);
    refreshTimeUI();
  });
}

function render(state) {
  latestState = state;
  companyNameEl.textContent = state.companyName;
  renderActivity(state.logs);
}

function tick() {
  const realNowMs = Date.now();
  const dtMs = lastFrameRealMs != null ? realNowMs - lastFrameRealMs : 0;
  lastFrameRealMs = realNowMs;

  if (historyMode) {
    if (playing) {
      virtualTimeMs = Math.min(historyRangeEnd, virtualTimeMs + dtMs * playSpeed);
      if (virtualTimeMs >= historyRangeEnd) playing = false;
      refreshTimeUI();
    }
  } else {
    virtualTimeMs = realNowMs;
  }

  if (latestState) {
    ensureCanvas();
    const nowMs = virtualTimeMs;
    _tod = getTimeOfDay(nowMs);
    const tod = _tod;
    const positionsForRender = historyMode ? positionsAtTime(latestState.positions, nowMs) : latestState.positions;
    const floorScene = buildFloorScene(positionsForRender);
    // The street is its own, wider stretch of ground (a building doesn't span
    // the whole block) so there's always room for the street-life props below,
    // even for a tiny one-room company whose floor alone would be very narrow.
    const groundGridW = Math.max(floorScene.gridW + 10, 20);
    const totalW = Math.max(floorScene.bounds.width, isoBounds(groundGridW, GROUND_D, 0, 0).width) + 20;
    const totalH = SKY_H + ROOF_H + WIN_STRIP_H + floorScene.bounds.height + WIN_STRIP_H + isoBounds(groundGridW, GROUND_D, 70, 10).height;

    if (canvas.width !== Math.ceil(totalW) || canvas.height !== Math.ceil(totalH)) {
      canvas.width = Math.ceil(totalW);
      canvas.height = Math.ceil(totalH);
      if (!camera.userSet) fitCamera();
    }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawSky(ctx, canvas.width, nowMs, tod);
    drawRoofBand(ctx, SKY_H, canvas.width);
    drawWindowStrip(ctx, SKY_H + ROOF_H, canvas.width, 1, nowMs, tod);

    const floorX = (canvas.width - floorScene.bounds.width) / 2;
    const floorY = SKY_H + ROOF_H + WIN_STRIP_H;
    lastFloorLayout = { floorX, floorY, deskTileByPos: floorScene.deskTileByPos };
    ctx.save();
    ctx.translate(floorX, floorY);
    drawFloorScene(ctx, floorScene, nowMs, historyMode);
    ctx.restore();

    const yAfterFloor = SKY_H + ROOF_H + WIN_STRIP_H + floorScene.bounds.height;
    drawWindowStrip(ctx, yAfterFloor, canvas.width, 2, nowMs, tod);
    drawFloorPlaque(ctx, 6, SKY_H + ROOF_H + 3);

    const groundBounds = isoBounds(groundGridW, GROUND_D, 70, 10);
    const groundX = (canvas.width - groundBounds.width) / 2;
    ctx.save();
    ctx.translate(groundX, yAfterFloor + WIN_STRIP_H);
    drawGroundScene(ctx, groundGridW, nowMs);
    ctx.restore();
  }
  requestAnimationFrame(tick);
}

socket.on("state", render);
setupTimeControls();
refreshTimeUI();
requestAnimationFrame(tick);
