import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

import { EEVEE_IDLE_CRY } from "../pet/cries.js";
import { H, INK, LEFT_W, LIGHT, MID, PAPER, W } from "./palette.js";
import { ditherSpriteGray, SPRITE_CRISP_THRESHOLD, thresholdSpriteGray } from "./sprites.js";

export const ZPIX_FONT_PATH = fileURLToPath(new URL("../../seed/fonts/zpix.ttf", import.meta.url));
GlobalFonts.registerFromPath(ZPIX_FONT_PATH, "Zpix");

const MONO = '"Zpix"';
const CJK = '"Zpix"';
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MOOD_ZH = { shocked: "震惊", fainted: "力竭", strained: "吃力", focused: "专注", happy: "开心" };
export const BUDDY_SPRITE_SLOT = 136;
export const BUDDY_SPRITE_SCALE = 3;
const TODAY_TEXT_X = 11;
const TODAY_TEXT_MAX_X = LEFT_W - 12;
const TODAY_FONT = { weight: 700, size: 12, minSize: 12, family: MONO };

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
  const now = dateOrNow(model.now);

  return {
    clock: formatClock(model.clock, now),
    p5h: percentText(model.p5h),
    pweek: percentText(model.pweek),
    resets5h: formatReset(model.resets5h, now),
    resetsWeek: formatReset(model.resetsWeek, now),
    today: `today $${money(model.todayCost)} · ${tokens(model.todayTokens)} tok`,
    weatherMain: `${weatherLabel} ${value(weather.temp)}°`,
    weatherFeels: `体感${value(weather.feels)}°`,
    weatherDetail: `高${value(weather.hi)}°低${value(weather.lo)}° 降${value(weather.precip)}% 风${value(weather.wind)}`,
  };
}

function drawLeftPanel(g, model) {
  const text = layoutText(model);
  g.fillStyle = INK;
  g.fillRect(LEFT_W - 2, 0, 2, H);

  g.font = `800 12px ${MONO}`;
  g.fillText("CLAUDE", 10, 23);
  g.font = `700 12px ${MONO}`;
  g.textAlign = "right";
  g.fillText(text.clock, LEFT_W - 12, 23);
  g.textAlign = "left";
  line(g, 10, 33, LEFT_W - 12, 33);

  const p5h = clampPct(model.p5h);
  const p5hText = text.p5h;
  g.font = `800 48px ${MONO}`;
  g.fillText(p5hText, 9, 88);
  if (p5hText !== "--") {
    const pctX = Math.round(9 + g.measureText(p5hText).width - 2);
    g.font = `800 24px ${MONO}`;
    g.fillText("%", pctX, 87);
  }
  g.font = `800 12px ${MONO}`;
  g.fillText("5H", 151, 58);
  g.fillText("WINDOW", 151, 72);

  g.font = `700 12px ${MONO}`;
  g.fillText(text.resets5h, 11, 110);

  g.font = `800 12px ${MONO}`;
  g.fillText("WEEK", 11, 135);
  drawMeter(g, 56, 124, 100, 14, clampPct(model.pweek), { striped: true });
  g.font = `800 12px ${MONO}`;
  g.textAlign = "right";
  g.fillText(text.pweek === "--" ? "--" : `${text.pweek}%`, LEFT_W - 12, 136);
  g.textAlign = "left";

  g.font = `700 12px ${MONO}`;
  g.fillText(text.resetsWeek, 11, 155);
  g.font = fitTodayLineFont(g, text.today);
  g.fillText(text.today, TODAY_TEXT_X, 177);

  line(g, 10, 189, LEFT_W - 12, 189);
  // Weather: condition + temp enlarged to a secondary focal point.
  g.save();
  g.translate(11, 192);
  g.scale(1.35, 1.35);
  drawWeatherIcon(g, weatherIconKind(model.weather), 0, 0);
  g.restore();
  g.font = `800 24px ${CJK}`;
  g.fillText(text.weatherMain, 56, 217);
  g.font = `600 12px ${CJK}`;
  g.fillText(text.weatherDetail, 11, 244);

  line(g, 10, 258, LEFT_W - 12, 258);
  g.font = `700 12px ${CJK}`;
  g.fillText(`室内  ${tempHum(model.room)}`, 11, 275);
  g.fillText(`室外  ${tempHum(model.out)}`, 11, 292);
}

function drawBuddyPanel(g, model) {
  const panelX = LEFT_W;
  const panelW = W - LEFT_W;
  const buddy = model.buddy ?? {};

  drawBubble(g, W - 8, 11, buddy.bubble ?? EEVEE_IDLE_CRY);
  drawShadow(g, panelX + panelW / 2, 190);
  drawSprite(g, buddy.spriteGray, {
    x: panelX + Math.floor((panelW - BUDDY_SPRITE_SLOT) / 2),
    y: 60,
    maxSize: BUDDY_SPRITE_SLOT,
    srcW: buddy.spriteW,
    srcH: buddy.spriteH,
  });

  g.fillStyle = INK;
  g.font = `800 12px ${MONO}`;
  g.fillRect(panelX + 14, 205, 7, 7);
  g.fillText(MOOD_ZH[buddy.mood] ?? buddy.mood ?? "专注", panelX + 27, 213);

  const level = Math.max(1, Number(buddy.level ?? 1));
  const hearts = heartCount(buddy.bond ?? 0);
  const streak = Math.max(0, Number(model.streak ?? 0));

  // 等级 + 连续天数（24px = Zpix 整数倍，清晰）
  g.font = `800 24px ${MONO}`;
  g.fillText(`Lv.${level}`, panelX + 14, 245);
  drawFlame(g, panelX + 104, 229);
  g.fillText(`${streak}天`, panelX + 122, 245);

  // 经验条
  drawMeter(g, panelX + 14, 255, 156, 11, clampPct(buddy.expPct ?? 0), { striped: false });

  // 亲密度
  g.font = `700 12px ${CJK}`;
  g.fillText("亲密度", panelX + 14, 288);
  drawHearts(g, panelX + 58, 277, hearts);
}

export function fitTodayLineFont(g, text) {
  return fitFont(g, text, {
    ...TODAY_FONT,
    maxWidth: TODAY_TEXT_MAX_X - TODAY_TEXT_X,
  });
}

export function drawSprite(g, spriteGray, {
  x,
  y,
  maxSize = BUDDY_SPRITE_SLOT,
  size,
  srcW,
  srcH,
  scale = BUDDY_SPRITE_SCALE,
  mode = "threshold",
  threshold = SPRITE_CRISP_THRESHOLD,
} = {}) {
  const pixels = spriteGray instanceof Uint8Array ? spriteGray : placeholderSprite(96, 96);
  const side = Math.max(1, Math.round(Math.sqrt(pixels.length)));
  const sourceW = Number.isInteger(srcW) && srcW > 0 ? srcW : (side * side === pixels.length ? side : 96);
  const sourceH = Number.isInteger(srcH) && srcH > 0 ? srcH : Math.max(1, Math.floor(pixels.length / sourceW));
  const rendered = mode === "dither"
    ? ditherSpriteGray(pixels, sourceW, sourceH)
    : thresholdSpriteGray(pixels, sourceW, sourceH, { threshold });
  const spriteCanvas = createCanvas(sourceW, sourceH);
  const sg = spriteCanvas.getContext("2d");
  const img = sg.createImageData(sourceW, sourceH);

  for (let i = 0; i < sourceW * sourceH; i += 1) {
    const v = rendered[i] ?? 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = v > 245 ? 0 : 255;
  }

  sg.putImageData(img, 0, 0);
  const slot = Math.max(1, Math.floor(maxSize ?? size ?? Math.max(sourceW, sourceH)));
  const integerScale = Math.max(1, Math.floor(scale));
  const fitScale = Math.max(1, Math.min(integerScale, Math.floor(slot / Math.max(sourceW, sourceH)) || 1));
  const targetW = sourceW * fitScale;
  const targetH = sourceH * fitScale;
  g.imageSmoothingEnabled = false;
  g.drawImage(
    spriteCanvas,
    x + Math.floor((slot - targetW) / 2),
    y + Math.floor((slot - targetH) / 2),
    targetW,
    targetH,
  );
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
  g.strokeStyle = INK;
  g.lineWidth = 2;
}

function drawBubble(g, rightX, y, text) {
  g.font = `700 24px ${MONO}`;
  const w = Math.ceil(g.measureText(text).width) + 22;
  const x = rightX - w;
  g.fillStyle = PAPER;
  g.strokeStyle = INK;
  g.lineWidth = 2;
  roundedRect(g, x, y, w, 36, 9);
  g.fill();
  g.stroke();
  g.fillStyle = INK;
  g.fillText(text, x + 11, y + 27);
}

function drawShadow(g, cx, y) {
  g.fillStyle = LIGHT;
  g.beginPath();
  g.ellipse(cx, y, 57, 10, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = INK;
}

function drawWeatherIcon(g, kind, x, y) {
  if (kind === "sun") {
    drawSunIcon(g, x, y);
  } else if (kind === "rain") {
    drawCloudIcon(g, x, y);
    drawRainIcon(g, x, y);
  } else if (kind === "snow") {
    drawCloudIcon(g, x, y);
    drawSnowIcon(g, x, y);
  } else if (kind === "fog") {
    drawFogIcon(g, x, y);
  } else {
    drawCloudIcon(g, x, y);
  }
}

function drawSunIcon(g, x, y) {
  g.fillStyle = INK;
  g.strokeStyle = INK;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(x + 15, y + 12, 7, 0, Math.PI * 2);
  g.fill();
  line(g, x + 15, y, x + 15, y + 4);
  line(g, x + 15, y + 20, x + 15, y + 24);
  line(g, x + 3, y + 12, x + 7, y + 12);
  line(g, x + 23, y + 12, x + 27, y + 12);
  line(g, x + 6, y + 3, x + 9, y + 6);
  line(g, x + 21, y + 18, x + 24, y + 21);
  line(g, x + 24, y + 3, x + 21, y + 6);
  line(g, x + 9, y + 18, x + 6, y + 21);
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

function drawRainIcon(g, x, y) {
  g.strokeStyle = INK;
  g.lineWidth = 2;
  line(g, x + 9, y + 21, x + 7, y + 25);
  line(g, x + 17, y + 21, x + 15, y + 25);
  line(g, x + 25, y + 21, x + 23, y + 25);
}

function drawSnowIcon(g, x, y) {
  g.strokeStyle = INK;
  g.lineWidth = 1;
  drawAsterisk(g, x + 10, y + 23);
  drawAsterisk(g, x + 21, y + 23);
  g.lineWidth = 2;
}

function drawFogIcon(g, x, y) {
  g.strokeStyle = INK;
  g.lineWidth = 2;
  line(g, x + 4, y + 7, x + 28, y + 7);
  line(g, x, y + 14, x + 24, y + 14);
  line(g, x + 4, y + 21, x + 28, y + 21);
}

function drawAsterisk(g, x, y) {
  line(g, x - 3, y, x + 3, y);
  line(g, x, y - 3, x, y + 3);
  line(g, x - 2, y - 2, x + 2, y + 2);
  line(g, x + 2, y - 2, x - 2, y + 2);
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

function drawHearts(g, x, y, filled) {
  for (let i = 0; i < 5; i += 1) {
    drawHeart(g, x + i * 20, y, Math.max(0, Math.min(1, filled - i)));
  }
}

function drawHeart(g, x, y, fill) {
  heartPath(g, x, y);

  if (fill >= 1) {
    g.fillStyle = INK;
    g.fill();
    return;
  }

  if (fill > 0) {
    g.save();
    g.clip();
    g.fillStyle = INK;
    g.fillRect(x, y, Math.round(8 * fill), 14);
    g.restore();
  }

  heartPath(g, x, y);
  g.strokeStyle = INK;
  g.lineWidth = 1;
  g.stroke();
  g.lineWidth = 2;
}

function heartPath(g, x, y) {
  g.beginPath();
  g.moveTo(x + 5, y + 10);
  g.bezierCurveTo(x, y + 6, x, y + 1, x + 4, y + 1);
  g.bezierCurveTo(x + 6, y + 1, x + 7, y + 2, x + 8, y + 4);
  g.bezierCurveTo(x + 9, y + 2, x + 10, y + 1, x + 12, y + 1);
  g.bezierCurveTo(x + 16, y + 1, x + 16, y + 6, x + 11, y + 10);
  g.lineTo(x + 8, y + 13);
  g.closePath();
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

export function heartCount(rawBond) {
  const v = Math.round(((Number(rawBond) || 0) / 40) * 2) / 2;
  return Math.max(0, Math.min(5, v));
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
  if (Math.abs(n) >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`;
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function money(v) {
  if (v == null) return "--";
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  if (Math.abs(n) >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`;
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

function fitFont(g, text, { weight, size, minSize, family, maxWidth }) {
  for (let px = size; px >= minSize; px -= 1) {
    const font = `${weight} ${px}px ${family}`;
    g.font = font;
    if (g.measureText(text).width <= maxWidth) return font;
  }
  return `${weight} ${minSize}px ${family}`;
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

function formatClock(clock, now = new Date()) {
  if (typeof clock === "string" && clock.length > 0) return clock;
  return hhmm(now);
}

export function formatReset(value, now = new Date()) {
  if (typeof value !== "string" || value.length === 0) return "reset unknown";
  const reset = new Date(value);
  const base = dateOrNow(now);
  if (!Number.isFinite(reset.getTime())) return "reset unknown";

  if (isSameLocalDate(reset, base)) {
    const minutes = Math.max(0, Math.ceil((reset.getTime() - base.getTime()) / 60_000));
    if (minutes <= 0) return "now";
    if (minutes < 60) return `in ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins === 0 ? `in ${hours}h` : `in ${hours}h${mins}m`;
  }

  if (isSameLocalDate(reset, addLocalDays(base, 1))) {
    return `tomorrow ${hhmm(reset)}`;
  }

  return `${MONTHS[reset.getMonth()]} ${pad2(reset.getDate())}, ${hhmm(reset)}`;
}

export function weatherIconKind(weather = {}) {
  const cond = String(weather?.cond ?? "");
  if (/雪|snow/i.test(cond)) return "snow";
  if (/雨|雷|rain|storm|shower/i.test(cond)) return "rain";
  if (/雾|霾|fog|mist|haze/i.test(cond)) return "fog";
  if (/晴|clear|sun/i.test(cond)) return "sun";
  return "cloud";
}

function dateOrNow(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function isSameLocalDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function addLocalDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function hhmm(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}
