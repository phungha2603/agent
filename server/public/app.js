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
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.07)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawWallEdge(ctx, gx1, gy1, gx2, gy2, h, faceColor, topColor) {
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
  ctx.fillStyle = faceColor;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(t1.x, t1.y);
  ctx.lineTo(t2.x, t2.y);
  ctx.strokeStyle = topColor;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** A small iso cuboid (desk, cart, bench…): top face + two shaded side faces. */
function drawIsoBox(ctx, gx, gy, w, d, h, topColor, leftColor, rightColor) {
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
const WANDER_ROWS = [0, 2];
const MAX_ROW_TILES = 26;
const DESK_H = 16;
const WALL_H = 36;
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

/** Packs rooms into grid rows (tile units) so the floor stays readable no
 *  matter how many positions the company config has. */
function layoutFloor(byRoom) {
  const rows = [];
  let current = [];
  let currentW = 0;
  for (const [room, positions] of byRoom) {
    const w = positions.length * 2 + 1;
    if (current.length > 0 && currentW + w > MAX_ROW_TILES) {
      rows.push({ cells: current, w: currentW });
      current = [];
      currentW = 0;
    }
    current.push({ room, positions, w, gx: currentW });
    currentW += w;
  }
  if (current.length) rows.push({ cells: current, w: currentW });
  const gridW = rows.reduce((m, r) => Math.max(m, r.w), 0);
  rows.forEach((r, i) => (r.gy = i * ROOM_D));
  return { rows, gridW, gridD: rows.length * ROOM_D };
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

function buildFloorScene(positions) {
  const byRoom = groupByRoom(positions);
  const { rows, gridW, gridD } = layoutFloor(byRoom);
  const bounds = isoBounds(gridW, gridD, 90, 16);

  const deskTileByPos = new Map();
  const roomBoundsByPos = new Map();
  const cellsFlat = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      cellsFlat.push({ ...cell, gy: row.gy });
      cell.positions.forEach((p, i) => {
        deskTileByPos.set(p.id, { x: cell.gx + 1 + i * 2 + 0.5, y: row.gy + 1.5 });
        roomBoundsByPos.set(p.id, { gx: cell.gx, gy: row.gy, w: cell.w });
      });
    }
  }
  return { byRoom, rows, gridW, gridD, bounds, deskTileByPos, roomBoundsByPos, cellsFlat };
}

function drawFloorScene(ctx, scene, nowMs) {
  const { gridW, gridD, bounds, cellsFlat, deskTileByPos, roomBoundsByPos, byRoom } = scene;
  _ctx = ctx;
  ctx.save();
  ctx.translate(bounds.originX, bounds.originY);

  for (const p of [].concat(...byRoom.values())) {
    updateBehavior(p, deskTileByPos.get(p.id), roomBoundsByPos.get(p.id), nowMs);
  }
  tryPairChats(byRoom, roomBoundsByPos, nowMs);

  const queue = [];

  // floor tiles (+ hallway filler for rows shorter than the widest one)
  for (let gy = 0; gy < gridD; gy += ROOM_D) {
    for (let gx = 0; gx < gridW; gx++) {
      const cell = cellsFlat.find((c) => c.gy === gy && gx >= c.gx && gx < c.gx + c.w);
      const color = cell ? pick(PALETTE.floor, hashStr(cell.room)) : "#e4ded0";
      for (let ly = 0; ly < ROOM_D; ly++) {
        const key = gx + gy + ly;
        queue.push({ key, fn: ((gx_, gy_, color_) => () => drawFloorTile(ctx, gx_, gy_, color_))(gx, gy + ly, color) });
      }
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
  }

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
      const atDeskNow = a.mode === "seated";
      // a.pos / deskTile already carry a tile-center-style coordinate, so
      // project with isoPoint directly — tileCenter() would add another +0.5
      // and visibly offset the sprite/chips from where the logic thinks it is.
      const pt = isoPoint(a.pos.x, a.pos.y);
      const key = a.pos.x + a.pos.y;

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
            if (a.mode === "chat") drawSpeechBubble(ctx, pt.x, headTop - 36, nowMs);
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
  const base = tileCenter(gx, gy);
  ctx.fillStyle = "#3a362f";
  ctx.fillRect(base.x - 1.5, base.y - 46, 3, 46);
  ctx.beginPath();
  ctx.arc(base.x, base.y - 50, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffdd88";
  ctx.fill();
}

function drawTree(gx, gy) {
  const ctx = ctx0();
  const base = tileCenter(gx, gy);
  ctx.fillStyle = "#6b4a2d";
  ctx.fillRect(base.x - 3, base.y - 26, 6, 26);
  ctx.fillStyle = "#5f8c53";
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
  ctx.fillStyle = "#c0504a";
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
      ctx.fillStyle = "#86c6e8";
      ctx.fillRect(p.x - 7, p.y - 34, 6, 15);
      ctx.fillRect(p.x + 1, p.y - 34, 6, 15);
    },
  });

  queue.push({ key: 0.6, fn: () => drawLampPost(1, 1) });
  queue.push({ key: gridW - 1.4, fn: () => drawTree(gridW - 2, 1) });
  queue.push({ key: gridW - 3.4, fn: () => drawCar(gridW - 4, 2.1) });

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
  const bgx = doorX + 2,
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

  queue.sort((a, b) => a.key - b.key);
  for (const job of queue) job.fn();

  ctx.restore();
  return bounds;
}

/* ---------- sky / roof / "other floors" bands (flat, decorative) ---------- */

const SKY_H = 58;
const ROOF_H = 16;
const WIN_STRIP_H = 24;

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
  ctx.fillStyle = "#4f483f";
  ctx.fillRect(w * 0.25, y - 6, 10, 6);
  ctx.fillRect(w * 0.6, y - 9, 7, 9);
}
function drawWindowStrip(ctx, y, w, seedOffset, nowMs) {
  ctx.fillStyle = "#857c6c";
  ctx.fillRect(0, y, w, WIN_STRIP_H);
  const winW = 16,
    gap = 10;
  let x = 10,
    i = 0;
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
  renderActivity(state.logs);
}

function tick() {
  if (latestState) {
    ensureCanvas();
    const nowMs = Date.now();
    const floorScene = buildFloorScene(latestState.positions);
    const totalW = Math.max(floorScene.bounds.width, isoBounds(floorScene.gridW, GROUND_D, 0, 0).width) + 20;
    const totalH = SKY_H + ROOF_H + WIN_STRIP_H + floorScene.bounds.height + WIN_STRIP_H + isoBounds(floorScene.gridW, GROUND_D, 70, 10).height;

    if (canvas.width !== Math.ceil(totalW) || canvas.height !== Math.ceil(totalH)) {
      canvas.width = Math.ceil(totalW);
      canvas.height = Math.ceil(totalH);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawSky(ctx, canvas.width, nowMs);
    drawRoofBand(ctx, SKY_H, canvas.width);
    drawWindowStrip(ctx, SKY_H + ROOF_H, canvas.width, 1, nowMs);

    const floorX = (canvas.width - floorScene.bounds.width) / 2;
    ctx.save();
    ctx.translate(floorX, SKY_H + ROOF_H + WIN_STRIP_H);
    drawFloorScene(ctx, floorScene, nowMs);
    ctx.restore();

    const yAfterFloor = SKY_H + ROOF_H + WIN_STRIP_H + floorScene.bounds.height;
    drawWindowStrip(ctx, yAfterFloor, canvas.width, 2, nowMs);
    drawFloorPlaque(ctx, 6, SKY_H + ROOF_H + 3);

    const groundBounds = isoBounds(floorScene.gridW, GROUND_D, 70, 10);
    const groundX = (canvas.width - groundBounds.width) / 2;
    ctx.save();
    ctx.translate(groundX, yAfterFloor + WIN_STRIP_H);
    drawGroundScene(ctx, floorScene.gridW, nowMs);
    ctx.restore();
  }
  requestAnimationFrame(tick);
}

socket.on("state", render);
requestAnimationFrame(tick);
