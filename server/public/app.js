const socket = io();
const connStatus = document.getElementById("conn-status");
const buildingEl = document.getElementById("building");
const activityEl = document.getElementById("activity-list");
const companyNameEl = document.getElementById("company-name");

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
  waiting_shift: (p) => `chờ ca ${fmtTime(p.nextRunAt)}`,
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

/* ---------- activity log (plain DOM) ---------- */

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

/* ---------- office-floor scene (rooms, desks, people) ---------- */

const WALK_MS = 850;
const CHECK_POP_MS = 2400;
const DESK_W = 100;
const PAD_LEFT = 54;
const PAD_RIGHT = 20;
const ROOM_LABEL_H = 20;
const ROOM_BODY_H = 186;
const ROOM_CELL_H = ROOM_LABEL_H + ROOM_BODY_H;
const FLOOR_Y = 158; // within a room body
const DESK_TOP_Y = 112;
const DOOR_X = 18;
const MAX_ROW_W = 1200;

const animState = new Map(); // position id -> { phase, phaseStart, prevStatus }
let latestState = null;

function groupByRoom(positions) {
  const map = new Map();
  for (const p of positions) {
    if (!map.has(p.room)) map.set(p.room, []);
    map.get(p.room).push(p);
  }
  return map;
}

/** Packs rooms into rows (like flex-wrap) so the building floor stays a
 *  readable width no matter how many positions the company config has. */
function layoutFloor(byRoom) {
  const rows = [];
  let current = [];
  let currentW = 0;
  for (const [room, positions] of byRoom) {
    const w = PAD_LEFT + positions.length * DESK_W + PAD_RIGHT;
    if (current.length > 0 && currentW + w > MAX_ROW_W) {
      rows.push({ cells: current, w: currentW });
      current = [];
      currentW = 0;
    }
    current.push({ room, positions, w });
    currentW += w;
  }
  if (current.length) rows.push({ cells: current, w: currentW });
  const floorW = rows.reduce((m, r) => Math.max(m, r.w), 0);
  return { rows, floorW, floorH: rows.length * ROOM_CELL_H };
}

/** Triggers a short "walk to desk" animation whenever a position starts a new
 *  shift (status becomes "running"), so the office feels alive without
 *  replaying the walk when a shift simply finishes (running -> done/error),
 *  which should instead play the pop-badge animation in place. */
function updateAnim(p) {
  let a = animState.get(p.id);
  const now = Date.now();
  if (!a) {
    a = { phase: "walk", phaseStart: now, prevStatus: p.status };
    animState.set(p.id, a);
    return a;
  }
  if (a.prevStatus !== p.status && p.status === "running") {
    a.phase = "walk";
    a.phaseStart = now;
  }
  a.prevStatus = p.status;
  return a;
}

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

function drawDesk(ctx, cx, topY) {
  const w = 58,
    h = 14;
  ctx.fillStyle = "#8a5a34";
  ctx.fillRect(cx - w / 2, topY, w, h);
  ctx.fillStyle = "#6e4526";
  ctx.fillRect(cx - w / 2, topY + h - 3, w, 3);
  const mx = cx + 16;
  ctx.fillStyle = "#2b2b2b";
  ctx.fillRect(mx - 9, topY - 16, 18, 13);
  ctx.fillStyle = "#86d6ff";
  ctx.fillRect(mx - 7, topY - 14, 14, 9);
  ctx.fillRect(mx - 3, topY - 3, 6, 3);
}

/** Draws the person either mid-walk (full body, legs visible, moving toward the
 *  desk) or seated at the desk with an idle / typing / just-finished pose. */
function drawPerson(ctx, cx, deskTopY, floorY, o) {
  const { phase, walkT, status, nowMs, palette, doneRecently, doneSince } = o;
  const bob = Math.sin(nowMs / 420) * 1.3;

  if (phase === "walk") {
    const cycles = walkT * 6;
    const stepT = cycles % 1;
    const stepPhase = Math.floor(cycles) % 2;
    const legSwing = (stepPhase === 0 ? 1 : -1) * 4 * Math.sin(stepT * Math.PI);
    const torsoBottom = floorY - 2;
    const torsoTop = torsoBottom - 20;
    const headTop = torsoTop - 16;

    ctx.fillStyle = "#39342c";
    ctx.fillRect(cx - 9, torsoBottom, 7, 20 + legSwing);
    ctx.fillRect(cx + 2, torsoBottom, 7, 20 - legSwing);

    ctx.fillStyle = palette.shirt;
    ctx.fillRect(cx - 11, torsoTop, 22, 20);

    ctx.fillStyle = palette.skin;
    ctx.fillRect(cx - 14, torsoTop + 2, 5, 14 - legSwing * 0.6);
    ctx.fillRect(cx + 9, torsoTop + 2, 5, 14 + legSwing * 0.6);

    drawHead(ctx, cx, headTop, palette);
    return;
  }

  const typing = status === "running";
  const typeBounce = typing ? Math.sin(nowMs / 110) * 2 : 0;
  const slump = status === "error" ? 2 : 0;
  const torsoBottom = deskTopY + 6;
  const torsoTop = torsoBottom - 20 + bob * 0.4 + slump * 0.5;
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

  if (doneRecently) {
    drawCheckBadge(ctx, cx, headTop - 14, easeOutQuad(Math.min(1, doneSince / 300)));
  } else if (status === "error") {
    drawErrorBadge(ctx, cx, headTop - 12);
  }
}

/** Interior of one room: floor, window, door, plant, desks + people. Drawn in
 *  local coordinates (0,0)-(w, ROOM_BODY_H); the caller translates into place. */
function drawRoomInterior(ctx, w, positions, nowMs) {
  const floorColor = pick(PALETTE.floor, hashStr(positions[0]?.room || ""));
  ctx.fillStyle = "rgba(0,0,0,0.035)";
  ctx.fillRect(0, 0, w, FLOOR_Y);
  ctx.fillStyle = floorColor;
  ctx.fillRect(0, FLOOR_Y, w, ROOM_BODY_H - FLOOR_Y);
  ctx.strokeStyle = "rgba(0,0,0,0.06)";
  ctx.lineWidth = 1;
  for (let x = 10; x < w; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, FLOOR_Y);
    ctx.lineTo(x + 0.5, ROOM_BODY_H);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(130,190,220,0.55)";
  ctx.fillRect(16, 10, 26, 18);
  ctx.fillRect(50, 10, 26, 18);
  ctx.fillStyle = "rgba(0,0,0,0.1)";
  ctx.fillRect(2, FLOOR_Y - 44, 10, 44);
  const plantX = w - 18;
  ctx.fillStyle = "#6e8f55";
  ctx.beginPath();
  ctx.arc(plantX, FLOOR_Y - 18, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#7a5a3a";
  ctx.fillRect(plantX - 5, FLOOR_Y - 10, 10, 10);

  positions.forEach((p, i) => {
    const deskCx = PAD_LEFT + i * DESK_W + DESK_W / 2;
    const a = animState.get(p.id);
    const seed = hashStr(p.id);
    const palette = {
      skin: pick(PALETTE.skin, seed),
      hair: pick(PALETTE.hair, seed >> 2),
      shirt: pick(PALETTE.shirt, seed >> 4),
    };

    let cx = deskCx;
    let phase = "seated";
    let walkT = 1;
    if (a && a.phase === "walk") {
      walkT = Math.min(1, (nowMs - a.phaseStart) / WALK_MS);
      cx = lerp(DOOR_X, deskCx, easeOutQuad(walkT));
      phase = "walk";
      if (walkT >= 1) a.phase = "seated";
    }

    drawDesk(ctx, deskCx, DESK_TOP_Y);
    drawPerson(ctx, cx, DESK_TOP_Y, FLOOR_Y, {
      phase,
      walkT,
      status: p.status,
      nowMs,
      palette,
      doneRecently: p.status === "done" && p.lastRunAt && nowMs - p.lastRunAt < CHECK_POP_MS,
      doneSince: p.lastRunAt ? nowMs - p.lastRunAt : null,
    });

    drawChip(ctx, deskCx, 4, p.name, "rgba(28,24,18,0.82)");
    const label = (STATUS_LABEL[p.status] || (() => p.status))(p);
    drawChip(ctx, deskCx, FLOOR_Y + 4, label, STATUS_COLOR[p.status] || "#8f8468");
  });
}

function drawRoomCell(ctx, ox, oy, w, room, positions, nowMs) {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = "rgba(28,24,18,0.85)";
  ctx.fillRect(0, 0, w, ROOM_LABEL_H);
  ctx.fillStyle = "#fff";
  ctx.font = '700 11px "JetBrains Mono", monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(room, 8, ROOM_LABEL_H / 2 + 1);
  ctx.translate(0, ROOM_LABEL_H);
  drawRoomInterior(ctx, w, positions, nowMs);
  ctx.restore();
}

/** Unassigned floor space (a row shorter than the widest one) reads as a
 *  plain hallway rather than leaving a hole in the building. */
function drawHallwayFiller(ctx, ox, oy, w) {
  ctx.save();
  ctx.translate(ox, oy + ROOM_LABEL_H);
  ctx.fillStyle = "#e4ded0";
  ctx.fillRect(0, 0, w, ROOM_BODY_H);
  ctx.strokeStyle = "rgba(0,0,0,0.05)";
  for (let y = 14; y < ROOM_BODY_H; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------- building exterior: sky, other floors, street ---------- */

const FACADE = 16;
const SKY_H = 58;
const ROOF_H = 16;
const WIN_STRIP_H = 24;
const GROUND_H = 92;

function drawSky(ctx, w, nowMs) {
  const grad = ctx.createLinearGradient(0, 0, 0, SKY_H);
  grad.addColorStop(0, "#bfe3f5");
  grad.addColorStop(1, "#e3f3fa");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, SKY_H);

  ctx.fillStyle = "rgba(255,221,120,0.9)";
  ctx.beginPath();
  ctx.arc(w - 36, 22, 13, 0, Math.PI * 2);
  ctx.fill();

  const drift = (nowMs / 60000) % 1;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
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
  ctx.fillStyle = "#6b6358";
  ctx.fillRect(0, y, w, ROOF_H);
  ctx.fillStyle = "#847c6e";
  ctx.fillRect(0, y, w, 3);
  // a couple of roof fixtures for flavor
  ctx.fillStyle = "#4f483f";
  ctx.fillRect(w * 0.25, y - 6, 10, 6);
  ctx.fillRect(w * 0.6, y - 9, 7, 9);
}

/** A strip of generic lit/unlit windows standing in for the floors above or
 *  below this one, so the scene reads as "one floor inside a taller building". */
function drawWindowStrip(ctx, y, w, seedOffset, nowMs) {
  ctx.fillStyle = "#857c6c";
  ctx.fillRect(0, y, w, WIN_STRIP_H);
  const winW = 16;
  const gap = 10;
  let x = 10;
  let i = 0;
  while (x + winW < w - 6) {
    const seed = hashStr(`w${seedOffset}-${i}`);
    const blink = Math.sin(nowMs / 1400 + seed) > 0.85;
    const lit = seed % 3 !== 0 || blink;
    ctx.fillStyle = lit ? "rgba(255,221,140,0.9)" : "rgba(40,36,30,0.55)";
    ctx.fillRect(x, y + 5, winW, WIN_STRIP_H - 10);
    x += winW + gap;
    i++;
  }
}

function drawFacadeSides(ctx, totalW, floorW, yTop, yBottom) {
  ctx.fillStyle = "#9c8f78";
  ctx.fillRect(0, yTop, FACADE, yBottom - yTop);
  ctx.fillRect(FACADE + floorW, yTop, FACADE, yBottom - yTop);
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  for (let y = yTop + 6; y < yBottom; y += 10) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(FACADE, y + 0.5);
    ctx.moveTo(FACADE + floorW, y + 0.5);
    ctx.lineTo(totalW, y + 0.5);
    ctx.stroke();
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

function drawGround(ctx, y, w) {
  // sidewalk
  ctx.fillStyle = "#cfc9ba";
  ctx.fillRect(0, y, w, GROUND_H);
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  for (let x = 6; x < w; x += 26) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, y + 4);
    ctx.lineTo(x + 0.5, y + GROUND_H - 22);
    ctx.stroke();
  }
  // street
  const streetY = y + GROUND_H - 22;
  ctx.fillStyle = "#514d49";
  ctx.fillRect(0, streetY, w, 22);
  ctx.fillStyle = "#e8d978";
  for (let x = 4; x < w; x += 24) {
    ctx.fillRect(x, streetY + 10, 14, 2.5);
  }

  // building base wall + entrance door
  const baseX = FACADE;
  const baseW = w - FACADE * 2;
  ctx.fillStyle = "#847c6e";
  ctx.fillRect(baseX, y, baseW, 14);
  const doorW = 34;
  const doorX = baseX + baseW / 2 - doorW / 2;
  ctx.fillStyle = "#3d372c";
  ctx.fillRect(doorX, y + 2, doorW, 24);
  ctx.fillStyle = "#86c6e8";
  ctx.fillRect(doorX + 3, y + 5, (doorW - 8) / 2, 18);
  ctx.fillRect(doorX + 5 + (doorW - 8) / 2, y + 5, (doorW - 8) / 2, 18);

  // lamp post
  const lampX = baseX + 24;
  ctx.fillStyle = "#3a362f";
  ctx.fillRect(lampX, y + 14, 3, GROUND_H - 36);
  ctx.beginPath();
  ctx.arc(lampX + 1.5, y + 12, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffdd88";
  ctx.fill();

  // tree
  const treeX = w - FACADE - 26;
  ctx.fillStyle = "#6b4a2d";
  ctx.fillRect(treeX, y + 26, 6, GROUND_H - 48);
  ctx.fillStyle = "#5f8c53";
  ctx.beginPath();
  ctx.arc(treeX + 3, y + 22, 14, 0, Math.PI * 2);
  ctx.fill();

  // a small parked car for flavor
  const carX = w - FACADE - 90;
  ctx.fillStyle = "#a15b4f";
  ctx.fillRect(carX, streetY - 14, 46, 14);
  ctx.fillRect(carX + 8, streetY - 22, 26, 10);
  ctx.fillStyle = "#cde7f2";
  ctx.fillRect(carX + 10, streetY - 20, 9, 7);
  ctx.fillRect(carX + 21, streetY - 20, 9, 7);
  ctx.fillStyle = "#2a2622";
  ctx.beginPath();
  ctx.arc(carX + 9, streetY, 4, 0, Math.PI * 2);
  ctx.arc(carX + 38, streetY, 4, 0, Math.PI * 2);
  ctx.fill();
}

function buildScene(positions) {
  const byRoom = groupByRoom(positions);
  const { rows, floorW } = layoutFloor(byRoom);
  const totalW = floorW + FACADE * 2;
  const floorH = rows.length * ROOM_CELL_H;
  const yFloorTop = SKY_H + ROOF_H + WIN_STRIP_H;
  const yFloorBottom = yFloorTop + floorH;
  const totalH = yFloorBottom + WIN_STRIP_H + GROUND_H;
  return { rows, floorW, totalW, floorH, yFloorTop, yFloorBottom, totalH };
}

function drawBuilding(ctx, scene, nowMs) {
  const { rows, floorW, totalW, yFloorTop, yFloorBottom, totalH } = scene;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, totalW, totalH);

  drawSky(ctx, totalW, nowMs);
  drawRoofBand(ctx, SKY_H, totalW);
  drawWindowStrip(ctx, SKY_H + ROOF_H, totalW, 1, nowMs);

  let rowY = yFloorTop;
  for (const row of rows) {
    let colX = FACADE;
    for (const cell of row.cells) {
      drawRoomCell(ctx, colX, rowY, cell.w, cell.room, cell.positions, nowMs);
      colX += cell.w;
    }
    if (row.w < floorW) drawHallwayFiller(ctx, colX, rowY, floorW - row.w);
    rowY += ROOM_CELL_H;
  }

  drawWindowStrip(ctx, yFloorBottom, totalW, 2, nowMs);
  drawGround(ctx, yFloorBottom + WIN_STRIP_H, totalW);
  drawFacadeSides(ctx, totalW, floorW, SKY_H + ROOF_H, yFloorBottom + WIN_STRIP_H);
  drawFloorPlaque(ctx, 6, SKY_H + ROOF_H + 3);

  // outer building outline for a clean "cutaway" edge
  ctx.strokeStyle = "rgba(25,22,18,0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, SKY_H + 1, totalW - 2, yFloorBottom + WIN_STRIP_H + GROUND_H - SKY_H - 2);
}

let canvas = null;
let ctx = null;
function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.id = "building-canvas";
  buildingEl.appendChild(canvas);
  ctx = canvas.getContext("2d");
}

function render(state) {
  latestState = state;
  companyNameEl.textContent = state.companyName;
  for (const p of state.positions) updateAnim(p);
  renderActivity(state.logs);
}

function tick() {
  if (latestState) {
    ensureCanvas();
    const nowMs = Date.now();
    const scene = buildScene(latestState.positions);
    if (canvas.width !== scene.totalW || canvas.height !== scene.totalH) {
      canvas.width = scene.totalW;
      canvas.height = scene.totalH;
    }
    drawBuilding(ctx, scene, nowMs);
  }
  requestAnimationFrame(tick);
}

socket.on("state", render);
requestAnimationFrame(tick);
