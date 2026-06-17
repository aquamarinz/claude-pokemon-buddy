import { renderFrame } from "./frame.js";

// 招牌跳跃高度序列（向上为正）：下蹲蓄力→跳起→落回。accent 随 animPhase 一起动。
export const SIGNATURE_HOP = [-2, 4, 9, 7, 3, 0];

// 顺序推送招牌帧（每帧 await push 后再 delay，绝不并发 → 复用 P3 的 push 互斥不残影）。
// 视觉-only：不调 playSound——KEY 短按由固件本地即时播当前物种叫声，避免双响。
export async function playSignatureAnimation({
  transport,
  model,
  render = renderFrame,
  delay = (ms) => new Promise((r) => setTimeout(r, ms)),
  stepMs = 70,
}) {
  if (!model) return;
  for (let i = 0; i < SIGNATURE_HOP.length; i += 1) {
    const frame = await render({ ...model, buddy: { ...model.buddy, hop: SIGNATURE_HOP[i], animPhase: i } });
    await transport.push(frame);
    if (i < SIGNATURE_HOP.length - 1) await delay(stepMs);
  }
}
