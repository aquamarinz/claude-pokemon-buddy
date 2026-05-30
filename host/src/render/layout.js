import { createCanvas } from "@napi-rs/canvas";

import { H, INK, LEFT_W, LIGHT, MID, PAPER, W } from "./palette.js";
import { ditherSpriteGray } from "./sprites.js";

const MONO = '"Courier New", ui-monospace, monospace';
const CJK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

export function drawGray(model) {
  const canvas = createCanvas(W, H);
  const g = canvas.getContext("2d");

  g.imageSmoothingEnabled = false;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  g.textBaseline = "alphabetic";
  g.lineWidth = 2;
  g.strokeStyle = INK;
  g.fillStyle = INK;

  drawLeftPanel(g, model);
  drawBuddyPanel(g, model);

  return g.getImageData(0, 0, W, H);
}

export function layoutText(model = {}) {
  const weather = model.weather ?? {};
  const weatherLabel = weather.degraded ? "degraded" : (weather.cond ?? "--");

  return {
    clock: formatClock(model.clock),
    p5h: percentText(model.p5h),
    pweek: percentText(model.pweek),
    resets5h: formatReset(model.resets5h),
    resetsWeek: formatReset(model.resetsWeek),
    today: `today $${money(model.todayCost)} · ${tokens(model.todayTokens)} tok`,
    weatherMain: `${weatherLabel} ${value(weather.temp)}° · 风${value(weather.wind)}`,
    weatherFeels: `体感${value(weather.feels)}°`,
    weatherDetail: `最高${value(weather.hi)}° 最低${value(weather.lo)}° · 降水${value(weather.precip)}% · 风${value(weather.wind)}`,
  };
}

function drawLeftPanel(g, model) {
  const text = layoutText(model);
  g.fillStyle = INK;
  g.fillRect(LEFT_W - 2, 0, 2, H);

  g.font = `800 16px ${MONO}`;
  g.fillText("CLAUDE", 10, 23);
  g.font = `700 12px ${MONO}`;
  g.textAlign = "right";
  g.fillText(text.clock, LEFT_W - 12, 23);
  g.textAlign = "left";
  line(g, 10, 33, LEFT_W - 12, 33);

  const p5h = clampPct(model.p5h);
  const p5hText = text.p5h;
  g.font = `800 64px ${MONO}`;
  g.fillText(p5hText, 9, 88);
  if (p5hText !== "--") {
    const pctX = 9 + g.measureText(p5hText).width - 2;
    g.font = `800 23px ${MONO}`;
    g.fillText("%", pctX, 87);
  }
  g.font = `800 11px ${MONO}`;
  g.fillText("5H", 151, 58);
  g.fillText("WINDOW", 151, 72);

  g.font = `700 11px ${MONO}`;
  g.fillText(text.resets5h, 11, 110);

  g.font = `800 11px ${MONO}`;
  g.fillText("WEEK", 11, 135);
  drawMeter(g, 56, 124, 100, 14, clampPct(model.pweek), { striped: true });
  g.font = `800 14px ${MONO}`;
  g.textAlign = "right";
  g.fillText(text.pweek === "--" ? "--" : `${text.pweek}%`, LEFT_W - 12, 136);
  g.textAlign = "left";

  g.font = `700 11px ${MONO}`;
  g.fillText(text.resetsWeek, 11, 155);
  g.font = `700 13px ${MONO}`;
  g.fillText(text.today, 11, 177);

  line(g, 10, 191, LEFT_W - 12, 191);
  drawCloudIcon(g, 12, 202);
  g.font = `800 14px ${CJK}`;
  g.fillText(text.weatherMain, 42, 215);
  g.font = `600 11px ${CJK}`;
  g.fillText(text.weatherFeels, 110, 215);
  g.font = `600 10px ${CJK}`;
  g.fillText(text.weatherDetail, 11, 233);

  line(g, 10, 257, LEFT_W - 12, 257);
  g.font = `700 12px ${CJK}`;
  g.fillText(`室内  ${tempHum(model.room)}`, 11, 274);
  g.fillText(`室外  ${tempHum(model.out)}`, 11, 291);
}

function drawBuddyPanel(g, model) {
  const panelX = LEFT_W;
  const panelW = W - LEFT_W;
  const buddy = model.buddy ?? {};

  drawBubble(g, panelX + 114, 13, buddy.bubble ?? "Pika!");
  drawShadow(g, panelX + panelW / 2, 190);
  drawSprite(g, buddy.spriteGray, {
    x: panelX + Math.floor((panelW - 136) / 2),
    y: 60,
    size: 136,
  });

  g.fillStyle = INK;
  g.font = `800 12px ${MONO}`;
  g.fillRect(panelX + 49, 221, 7, 7);
  g.fillText(buddy.mood ?? "focused", panelX + 62, 229);

  g.font = `800 12px ${MONO}`;
  const level = Math.max(1, Number(buddy.level ?? 1));
  const hearts = heartString(buddy.bond ?? 0);
  const streak = Math.max(0, Number(model.streak ?? 0));
  g.fillText(`Lv.${level} ${hearts}`, panelX + 30, 251);
  drawFlame(g, panelX + 132, 239);
  g.fillText(`${streak}d`, panelX + 146, 251);
  drawMeter(g, panelX + 33, 260, 119, 8, clampPct(buddy.expPct ?? 0), { striped: false });
}

function drawSprite(g, spriteGray, { x, y, size }) {
  const pixels = spriteGray instanceof Uint8Array ? spriteGray : placeholderSprite(96, 96);
  const side = Math.max(1, Math.round(Math.sqrt(pixels.length)));
  const srcW = side * side === pixels.length ? side : 96;
  const srcH = Math.max(1, Math.floor(pixels.length / srcW));
  const dithered = ditherSpriteGray(pixels, srcW, srcH);
  const spriteCanvas = createCanvas(srcW, srcH);
  const sg = spriteCanvas.getContext("2d");
  const img = sg.createImageData(srcW, srcH);

  for (let i = 0; i < srcW * srcH; i += 1) {
    const v = dithered[i] ?? 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = v > 245 ? 0 : 255;
  }

  sg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(spriteCanvas, x, y, size, size);
}

function placeholderSprite(w, h) {
  const gray = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = x - w / 2;
      const dy = y - h / 2;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r < 34) gray[y * w + x] = ((x >> 3) + (y >> 3)) & 1 ? 60 : 180;
      if (Math.abs(dx) < 9 && Math.abs(dy) < 34) gray[y * w + x] = 30;
      if (Math.abs(dy) < 9 && Math.abs(dx) < 34) gray[y * w + x] = 30;
    }
  }
  return gray;
}

function drawMeter(g, x, y, w, h, pct, { striped }) {
  g.strokeStyle = INK;
  g.lineWidth = 2;
  g.strokeRect(x, y, w, h);
  const innerW = Math.max(0, Math.round((w - 4) * pct / 100));
  g.fillStyle = INK;
  g.fillRect(x + 2, y + 2, innerW, h - 4);

  if (striped) {
    g.strokeStyle = PAPER;
    g.lineWidth = 1;
    for (let sx = x + 5; sx < x + 2 + innerW; sx += 6) {
      line(g, sx, y + 2, sx, y + h - 2);
    }
  }

  g.fillStyle = INK;
}

function drawBubble(g, x, y, text) {
  g.font = `700 11px ${MONO}`;
  const w = Math.ceil(g.measureText(text).width) + 16;
  g.fillStyle = PAPER;
  g.strokeStyle = INK;
  g.lineWidth = 2;
  roundedRect(g, x, y, w, 21, 7);
  g.fill();
  g.stroke();
  g.fillStyle = INK;
  g.fillText(text, x + 8, y + 14);
}

function drawShadow(g, cx, y) {
  g.fillStyle = LIGHT;
  g.beginPath();
  g.ellipse(cx, y, 57, 10, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = INK;
}

function drawCloudIcon(g, x, y) {
  g.fillStyle = INK;
  g.beginPath();
  g.arc(x + 8, y + 11, 6, Math.PI, 0);
  g.arc(x + 15, y + 8, 8, Math.PI, 0);
  g.arc(x + 24, y + 12, 6, Math.PI, 0);
  g.rect(x + 4, y + 11, 25, 7);
  g.fill();
}

function drawFlame(g, x, y) {
  g.fillStyle = INK;
  g.beginPath();
  g.moveTo(x + 6, y);
  g.bezierCurveTo(x + 13, y + 7, x + 11, y + 15, x + 6, y + 16);
  g.bezierCurveTo(x, y + 14, x - 1, y + 8, x + 4, y + 4);
  g.bezierCurveTo(x + 4, y + 8, x + 8, y + 8, x + 6, y);
  g.fill();
}

function roundedRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

function line(g, x1, y1, x2, y2) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

function heartString(bond) {
  const filled = Math.max(0, Math.min(5, Math.round(Number(bond) || 0)));
  return `${"♥".repeat(filled)}${"♡".repeat(5 - filled)}`;
}

function tempHum(v) {
  if (!v) return "--°C · --%";
  const temp = typeof v.t === "number" && Number.isFinite(v.t) ? v.t.toFixed(1) : "--";
  const humidity = typeof v.h === "number" && Number.isFinite(v.h) ? Math.round(v.h) : "--";
  return `${temp}°C · ${humidity}%`;
}

function tokens(v) {
  if (v == null) return "--";
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function money(v) {
  if (v == null) return "--";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "--";
}

function value(v) {
  if (v == null) return "--";
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n)) : "--";
}

function clampPct(v) {
  if (v == null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function percentText(v) {
  if (v == null) return "--";
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return String(Math.max(0, Math.min(100, Math.round(n))));
}

function formatClock(clock) {
  if (typeof clock === "string" && clock.length > 0) return clock;
  return "--:--";
}

function formatReset(value) {
  return typeof value === "string" && value.length > 0 ? value : "--";
}
