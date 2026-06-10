import { renderOnboarding } from "../render/onboarding.js";
import { CANDIDATES, OAK_LINES } from "./onboarding-data.js";
import { SOUND } from "../transport/proto.js";

const HATCH_FRAMES = 6;
const HATCH_FRAME_MS = 220;

export async function runOnboarding(io) {
  // 大木开场白：逐页累积，每页等一次 KEY
  for (let page = 1; page <= OAK_LINES.length; page += 1) {
    await io.push(await renderOnboarding({ kind: "oak", lines: OAK_LINES.slice(0, page) }));
    await waitKey(io);
  }

  // 选蛋：KEY short 切换、KEY long 确认
  let sel = 0;
  await io.push(await renderOnboarding({ kind: "choose", candidates: CANDIDATES, sel }));
  for (;;) {
    const b = await io.nextButton();
    if (b?.key === "KEY" && b.kind === "long") break;
    if (b?.key === "KEY") {
      sel = (sel + 1) % CANDIDATES.length;
      await io.push(await renderOnboarding({ kind: "choose", candidates: CANDIDATES, sel }));
    }
    // BOOT / 其它：忽略
  }
  const chosen = CANDIDATES[sel];

  // 孵化动画 + 音
  for (let f = 0; f < HATCH_FRAMES; f += 1) {
    await io.push(await renderOnboarding({ kind: "hatch", frame: f }));
    await io.delay(HATCH_FRAME_MS);
  }
  io.playSound(SOUND.EVOLVE); // 复用进化 fanfare 作孵化音

  // 诞生
  await io.push(await renderOnboarding({ kind: "born", species: chosen.species, name: chosen.name }));
  await waitKey(io);

  return { species: chosen.species, name: chosen.name };
}

async function waitKey(io) {
  for (;;) {
    const b = await io.nextButton();
    if (b?.key === "KEY") return;
  }
}
