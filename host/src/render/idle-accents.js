// 逐物种 idle accent：在精灵槽 box 内画 1px 程序图元，随 animPhase(4 拍)轻动。
// 全部用 INK 当前 fillStyle/strokeStyle（调用方已设黑）。无新资产。
const P = (phase) => ((phase % 4) + 4) % 4;
const dot = (g, x, y) => g.fillRect(Math.round(x), Math.round(y), 1, 1);

function flame(g, box, phase, { scale = 1 } = {}) { // 火：尾端跳动火苗 + 火星
  const p = P(phase);
  const x = box.x + box.w * 0.74;
  const y = box.y + box.h * 0.78;
  const h = (6 + (p === 2 ? 2 : 0)) * scale;
  const dx = p === 1 ? -1 : p === 3 ? 1 : 0;
  g.beginPath();
  g.moveTo(x + dx, y - h);
  g.quadraticCurveTo(x + 3 * scale + dx, y - h * 0.4, x + dx, y);
  g.quadraticCurveTo(x - 3 * scale + dx, y - h * 0.4, x + dx, y - h);
  g.fill();
  if (p % 2 === 0) dot(g, x + dx + 2 * scale, y - h - 2); // 火星
}

function sparks(g, box, phase) { // 电：随相位换位的火花点（相邻相位取不同点对，保证每拍都变）
  const p = P(phase);
  const pts = [[0.2, 0.3], [0.8, 0.25], [0.15, 0.7], [0.85, 0.65]];
  const a = pts[p], b = pts[(p + 1) % 4];
  for (const [fx, fy] of [a, b]) {
    const x = box.x + box.w * fx, y = box.y + box.h * fy;
    dot(g, x, y); dot(g, x + 1, y - 1); dot(g, x - 1, y + 1);
  }
}

function ripples(g, box, phase) { // 水：脚边外扩水弧 + 偶滴水
  const p = P(phase);
  const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.96;
  const r = 10 + p * 6;
  g.beginPath(); g.ellipse(cx, cy, r, Math.max(2, r * 0.18), 0, Math.PI, 0); g.stroke();
  if (p === 3) dot(g, box.x + box.w * 0.72, box.y + box.h * 0.85);
}

function leaves(g, box, phase) { // 草：叶摆 + 孢子点
  const p = P(phase);
  const x = box.x + box.w * 0.5, y = box.y + box.h * 0.06;
  const tilt = [0, 2, -1, -2][p];
  g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x + tilt, y); g.stroke();
  if (p >= 1) dot(g, x + 6 + p, y - p * 2); // 孢子上飘
}

function gem(g, box, phase) { // 超能：额宝石闪 + 绕行光点
  const p = P(phase);
  dot(g, box.x + box.w * 0.5, box.y + box.h * 0.16); // 宝石
  if (p % 2 === 0) dot(g, box.x + box.w * 0.5 + 1, box.y + box.h * 0.16 - 1);
  const ang = (p / 4) * Math.PI * 2;
  dot(g, box.x + box.w * 0.5 + Math.cos(ang) * box.w * 0.5,
        box.y + box.h * 0.5 + Math.sin(ang) * box.h * 0.42); // 绕行点
}

function rings(g, box, phase) { // 恶：环纹明灭光圈
  const p = P(phase);
  if (p === 1 || p === 2) {
    const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.5;
    g.beginPath(); g.ellipse(cx, cy, box.w * 0.42 + p, box.h * 0.42 + p, 0, 0, Math.PI * 2); g.stroke();
  }
}

function crystals(g, box, phase) { // 冰：冰晶小十字
  const p = P(phase);
  const cross = (x, y) => { g.beginPath(); g.moveTo(x - 2, y); g.lineTo(x + 2, y); g.moveTo(x, y - 2); g.lineTo(x, y + 2); g.stroke(); };
  cross(box.x + box.w * (0.2 + 0.05 * p), box.y + box.h * 0.2);
  if (p % 2 === 1) cross(box.x + box.w * 0.8, box.y + box.h * 0.3);
}

function ribbons(g, box, phase) { // 妖精：缎带波 + 爱心
  const p = P(phase);
  const y = box.y + box.h * (0.5 + 0.04 * Math.sin(p));
  g.beginPath(); g.moveTo(box.x + box.w * 0.1, y);
  g.quadraticCurveTo(box.x + box.w * 0.2, y - 4 + p, box.x + box.w * 0.32, y); g.stroke();
  if (p >= 2) { const hx = box.x + box.w * 0.62, hy = box.y + box.h * 0.18 - p; dot(g, hx, hy); dot(g, hx + 2, hy); dot(g, hx + 1, hy + 1); }
}

function twitch(g, box, phase) { // 普通(伊布)：耳尖/尾尖抖动点
  const p = P(phase);
  dot(g, box.x + box.w * 0.34, box.y + box.h * 0.08 - (p === 0 ? 1 : 0)); // 左耳尖
  dot(g, box.x + box.w * 0.62, box.y + box.h * 0.08 - (p === 0 ? 1 : 0)); // 右耳尖
  dot(g, box.x + box.w * 0.86 + (p === 1 ? 1 : 0), box.y + box.h * 0.5);  // 尾尖
}

// 物种 → 图元（+参数）。火/草按进化体型调 scale。
const ACCENTS = {
  eevee: twitch,
  vaporeon: ripples, jolteon: sparks, espeon: gem, umbreon: rings,
  leafeon: leaves, glaceon: crystals, sylveon: ribbons,
  flareon: (g, b, p) => flame(g, b, p, { scale: 0.9 }),
  bulbasaur: leaves, ivysaur: leaves, venusaur: leaves,
  charmander: (g, b, p) => flame(g, b, p, { scale: 1 }),
  charmeleon: (g, b, p) => flame(g, b, p, { scale: 1.3 }),
  charizard: (g, b, p) => flame(g, b, p, { scale: 1.6 }),
  squirtle: ripples, wartortle: ripples, blastoise: ripples,
};

export const ACCENT_SPECIES = Object.keys(ACCENTS);

export function drawIdleAccent(g, species, box, phase) {
  const fn = ACCENTS[species];
  if (fn) fn(g, box, phase);
}
