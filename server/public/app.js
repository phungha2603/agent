const socket = io();
const connStatus = document.getElementById("conn-status");
const roomsEl = document.getElementById("rooms");
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

/* ---------- activity log (plain DOM, unchanged from the card version) ---------- */

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

/* ---------- pixel-art office scene ---------- */

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

const WALK_MS = 850;
const CHECK_POP_MS = 2400;
const DESK_W = 100;
const PAD_LEFT = 54;
const PAD_RIGHT = 20;
const CANVAS_H = 186;
const FLOOR_Y = 158;
const DESK_TOP_Y = 112;
const DOOR_X = 18;

const roomCanvases = new Map(); // room name -> { wrap, canvas, ctx }
const animState = new Map(); // position id -> { phase, phaseStart, prevStatus, prevLastRunAt }
let latestState = null;

function groupByRoom(positions) {
  const map = new Map();
  for (const p of positions) {
    if (!map.has(p.room)) map.set(p.room, []);
    map.get(p.room).push(p);
  }
  return map;
}

function ensureRoomCanvas(room, positions) {
  let entry = roomCanvases.get(room);
  const width = PAD_LEFT + positions.length * DESK_W + PAD_RIGHT;
  if (!entry) {
    const wrap = document.createElement("div");
    wrap.className = "room";
    const h2 = document.createElement("h2");
    h2.textContent = room;
    const canvas = document.createElement("canvas");
    canvas.className = "room-canvas";
    wrap.appendChild(h2);
    wrap.appendChild(canvas);
    roomsEl.appendChild(wrap);
    entry = { wrap, canvas, ctx: canvas.getContext("2d") };
    roomCanvases.set(room, entry);
  }
  if (entry.canvas.width !== width || entry.canvas.height !== CANVAS_H) {
    entry.canvas.width = width;
    entry.canvas.height = CANVAS_H;
  }
  return entry;
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

function drawRoomScene(ctx, w, h, positions, nowMs) {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);

  const floorColor = pick(PALETTE.floor, hashStr(positions[0]?.room || ""));
  ctx.fillStyle = "rgba(0,0,0,0.035)";
  ctx.fillRect(0, 0, w, FLOOR_Y);
  ctx.fillStyle = floorColor;
  ctx.fillRect(0, FLOOR_Y, w, h - FLOOR_Y);
  ctx.strokeStyle = "rgba(0,0,0,0.06)";
  ctx.lineWidth = 1;
  for (let x = 10; x < w; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, FLOOR_Y);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
  }

  // window
  ctx.fillStyle = "rgba(130,190,220,0.55)";
  ctx.fillRect(16, 10, 26, 18);
  ctx.fillRect(50, 10, 26, 18);
  // door
  ctx.fillStyle = "rgba(0,0,0,0.1)";
  ctx.fillRect(2, FLOOR_Y - 44, 10, 44);
  // plant (flavor, bottom-right)
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
    if (a) {
      if (a.phase === "walk") {
        walkT = Math.min(1, (nowMs - a.phaseStart) / WALK_MS);
        cx = lerp(DOOR_X, deskCx, easeOutQuad(walkT));
        phase = "walk";
        if (walkT >= 1) a.phase = "seated";
      }
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

function render(state) {
  latestState = state;
  companyNameEl.textContent = state.companyName;

  const byRoom = groupByRoom(state.positions);
  for (const [room, positions] of byRoom) {
    ensureRoomCanvas(room, positions);
    for (const p of positions) updateAnim(p);
  }
  renderActivity(state.logs);
}

function tick() {
  if (latestState) {
    const nowMs = Date.now();
    const byRoom = groupByRoom(latestState.positions);
    for (const [room, positions] of byRoom) {
      const entry = roomCanvases.get(room);
      if (!entry) continue;
      drawRoomScene(entry.ctx, entry.canvas.width, entry.canvas.height, positions, nowMs);
    }
  }
  requestAnimationFrame(tick);
}

socket.on("state", render);
requestAnimationFrame(tick);
