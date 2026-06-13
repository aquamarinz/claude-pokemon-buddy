import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

import { H, INK, PAPER, W } from "./palette.js";
import { imageDataToFrame } from "./frame.js";
import { ZPIX_FONT_PATH, drawSprite } from "./layout.js";
import { loadBuddySprite } from "./sprites.js";

GlobalFonts.registerFromPath(ZPIX_FONT_PATH, "Zpix");
const MONO = '"Zpix"';

const HATCH_FRAMES = 6;

function px(g, t, x, y, size, align = "left", weight = 700) {
  g.font = `${weight} ${size}px ${MONO}`;
  g.textAlign = align;
  g.textBaseline = "alphabetic";
  g.fillText(t, x, y);
}

export async function renderOnboarding(scene) {
  const canvas = createCanvas(W, H);
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  g.fillStyle = INK;
  g.strokeStyle = INK;
  g.lineWidth = 2;
  g.strokeRect(6, 6, W - 12, H - 12);

  if (scene.kind === "oak") drawOak(g, scene.lines ?? []);
  else if (scene.kind === "choose") drawChoose(g, scene.candidates ?? [], scene.sel ?? 0);
  else if (scene.kind === "hatch") await drawHatch(g, scene.frame ?? 0, scene.species);
  else if (scene.kind === "born") {
    const sprite = await loadBuddySprite(scene.species ?? "eevee");
    drawBorn(g, scene.name, sprite);
  }

  return imageDataToFrame(g.getImageData(0, 0, W, H));
}

function drawOak(g, lines) {
  px(g, "大木博士", 20, 30, 12, "left", 800);
  g.lineWidth = 1;
  line(g, 20, 38, W - 20, 38);
  g.lineWidth = 2;
  lines.forEach((text, i) => px(g, text, 28, 84 + i * 34, 18, "left", 700));
  px(g, "▶ KEY", W - 26, H - 22, 12, "right", 700);
}

function drawChoose(g, candidates, sel) {
  px(g, "选择你的伙伴", W / 2, 36, 24, "center", 800);
  const chosen = candidates[sel];
  drawEgg(g, chosen?.species ?? "eevee", W / 2, 112, 1.0);
  if (chosen) px(g, chosen.name, W / 2, 178, 24, "center", 800); // 中央大名(选中物种, 24px 清)

  // 候选 chip：只蛋 + 编号(去掉糊的小中文名，靠中央大名识别)
  const bx = 24;
  const bw = (W - 48 - 18) / 4;
  candidates.forEach((candidate, i) => {
    const x = bx + i * (bw + 6);
    const y = 194;
    const h = 64;
    const on = i === sel;
    g.lineWidth = on ? 3 : 1;
    g.strokeRect(x, y, bw, h);
    drawEgg(g, candidate.species, x + bw / 2, y + 28, 0.42);
    px(g, "#" + (i + 1), x + bw / 2, y + 56, 12, "center", on ? 800 : 600);
  });
  g.lineWidth = 2;
  px(g, "KEY 切换 · 长按确认", W / 2, H - 16, 12, "center", 600);
}

async function drawHatch(g, frame, species) {
  const f = Math.max(0, Math.min(HATCH_FRAMES - 1, frame));
  px(g, "孵化中…", W / 2, 40, 24, "center", 800);
  if (f >= HATCH_FRAMES - 1) {
    // 末帧揭晓所选物种真 sprite; species 缺省(旧调用)回退占位轮廓
    const sprite = species ? await loadBuddySprite(species) : null;
    if (sprite && sprite.gray && !sprite.placeholder) {
      drawSprite(g, sprite.gray, { x: W / 2 - 68, y: 82, maxSize: 136, srcW: sprite.w, srcH: sprite.h, scale: 3 });
    } else {
      critter(g, W / 2, 150);
    }
  } else {
    const crack = f < 2 ? 0 : f < 4 ? 1 : 2;
    const shake = f % 2 === 0 ? -4 : 4;
    drawEgg(g, species ?? "eevee", W / 2, 150, 1.4, { crack, shake });
  }
  px(g, "♪ 孵化音", W / 2, H - 18, 12, "center", 600);
}

function drawBorn(g, name, sprite) {
  if (sprite && sprite.gray && !sprite.placeholder) {
    drawSprite(g, sprite.gray, { x: W / 2 - 68, y: 30, maxSize: 136, srcW: sprite.w, srcH: sprite.h, scale: 3 });
  } else {
    critter(g, W / 2, 90);
  }
  px(g, name + " 诞生了！", W / 2, 196, 24, "center", 800);
  px(g, "默认名 " + name, W / 2, 226, 12, "center", 600);
  px(g, "▶ KEY 开始养成", W / 2, H - 22, 12, "center", 700);
}

function drawEgg(g, species, cx, cy, scale = 1, { crack = 0, shake = 0 } = {}) {
  const fn = EGG_SHAPES[species] ?? EGG_SHAPES.eevee;
  g.save();
  g.translate(cx + shake, cy);
  g.scale(scale, scale);
  g.lineWidth = 3;
  fn(g);
  if (crack > 0) drawCrack(g, crack);
  g.restore();
}

const EGG_SHAPES = {
  eevee: eggEevee,
  bulbasaur: eggBulbasaur,
  charmander: eggCharmander,
  squirtle: eggSquirtle,
};

function eggEevee(g) {
  g.beginPath();
  g.ellipse(0, 0, 34, 44, 0, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-29, 3);
  g.lineTo(-19, -4);
  g.lineTo(-10, 5);
  g.lineTo(0, -4);
  g.lineTo(10, 5);
  g.lineTo(20, -4);
  g.lineTo(29, 3);
  g.stroke();
  [[-13, -13, 5], [12, -7, 4], [-4, 21, 4]].forEach(([x, y, r]) => {
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.fill();
  });
}

function eggBulbasaur(g) {
  g.beginPath();
  g.ellipse(0, 2, 35, 43, 0, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, -41);
  g.quadraticCurveTo(-3, -52, 5, -59);
  g.stroke();
  leaf(g, -12, -51, -24, -62, -4, -60);
  leaf(g, 10, -52, 25, -60, 5, -62);
  g.beginPath();
  g.arc(8, -58, 6, 0.6, Math.PI * 1.8);
  g.stroke();
  leaf(g, -12, -8, -25, -18, -6, -25);
  leaf(g, 15, 4, 28, -2, 8, -14);
  leaf(g, -1, 22, -16, 19, 8, 8);
}

function eggCharmander(g) {
  g.beginPath();
  g.moveTo(0, -50);
  g.bezierCurveTo(32, -25, 36, 28, 0, 46);
  g.bezierCurveTo(-36, 28, -32, -25, 0, -50);
  g.closePath();
  g.stroke();
  g.lineWidth = 2;
  triangle(g, -7, -52, 0, -69, 7, -52, true);
  triangle(g, -22, -16, -12, -33, -5, -13, true);
  triangle(g, 7, 5, 16, -14, 23, 8, true);
  triangle(g, -8, 23, 1, 7, 10, 25, true);
}

function eggSquirtle(g) {
  g.beginPath();
  g.ellipse(0, 2, 38, 40, 0, 0, Math.PI * 2);
  g.stroke();
  g.save();
  g.beginPath();
  g.ellipse(0, 2, 34, 36, 0, 0, Math.PI * 2);
  g.clip();
  g.lineWidth = 2;
  [-17, -3, 12].forEach((y) => {
    g.beginPath();
    g.moveTo(-34, y);
    g.bezierCurveTo(-15, y + 4, 15, y - 4, 34, y);
    g.stroke();
  });
  g.beginPath();
  g.moveTo(-14, -29);
  g.bezierCurveTo(-4, -13, -5, 16, -15, 34);
  g.moveTo(14, -29);
  g.bezierCurveTo(4, -13, 5, 16, 15, 34);
  g.stroke();
  g.restore();
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-19, -43);
  g.quadraticCurveTo(-11, -50, -3, -43);
  g.quadraticCurveTo(6, -35, 17, -43);
  g.stroke();
}

function drawCrack(g, crack) {
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-20, -6);
  g.lineTo(-6, 2);
  g.lineTo(-14, 10);
  g.lineTo(2, 16);
  if (crack > 1) {
    g.moveTo(6, -20);
    g.lineTo(12, -4);
    g.lineTo(4, 4);
  }
  g.stroke();
}

function leaf(g, x1, y1, x2, y2, x3, y3) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.quadraticCurveTo(x2, y2, x3, y3);
  g.quadraticCurveTo((x1 + x3) / 2, (y1 + y3) / 2, x1, y1);
  g.fill();
}

function triangle(g, x1, y1, x2, y2, x3, y3, fill = false) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.lineTo(x3, y3);
  g.closePath();
  if (fill) g.fill();
  else g.stroke();
}

function critter(g, cx, cy) {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = INK;
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(0, 6, 22, 18, 0, 0, 7);
  g.fill();
  g.beginPath();
  g.arc(-2, -12, 14, 0, 7);
  g.fill();
  g.beginPath();
  g.moveTo(-16, -20);
  g.lineTo(-22, -34);
  g.lineTo(-6, -22);
  g.fill();
  g.beginPath();
  g.moveTo(12, -20);
  g.lineTo(20, -34);
  g.lineTo(4, -22);
  g.fill();
  g.fillStyle = PAPER;
  g.beginPath();
  g.arc(-6, -12, 2.4, 0, 7);
  g.fill();
  g.beginPath();
  g.arc(3, -12, 2.4, 0, 7);
  g.fill();
  g.restore();
  g.fillStyle = INK;
}

function line(g, x1, y1, x2, y2) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}
