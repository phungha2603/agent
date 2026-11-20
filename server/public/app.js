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

function render(state) {
  companyNameEl.textContent = state.companyName;

  const byRoom = new Map();
  for (const p of state.positions) {
    if (!byRoom.has(p.room)) byRoom.set(p.room, []);
    byRoom.get(p.room).push(p);
  }

  roomsEl.innerHTML = "";
  for (const [room, positions] of byRoom) {
    const roomEl = document.createElement("div");
    roomEl.className = "room";
    const label = STATUS_LABEL;
    roomEl.innerHTML = `
      <h2>${escapeHtml(room)}</h2>
      ${positions
        .map(
          (p) => `
        <div class="position">
          <div class="position-head">
            <span class="dot dot--${p.status}"></span>
            <span>${escapeHtml(p.name)}</span>
          </div>
          <div class="position-meta">${label[p.status](p)} · ${escapeHtml(p.provider)}/${escapeHtml(p.model)}</div>
          ${p.lastSummary ? `<div class="position-summary">${escapeHtml(p.lastSummary)}</div>` : ""}
        </div>`
        )
        .join("")}
    `;
    roomsEl.appendChild(roomEl);
  }

  activityEl.innerHTML = state.logs
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

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

socket.on("state", render);
