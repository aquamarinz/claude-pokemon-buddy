// 独立于 60s 主 tick 的 buddy 动画驱动。自调度（await push 后再 sleep，不用裸
// setInterval 防积压），经 transport.push 的串行互斥推帧，diff 只发 buddy 脏区。
export function createBuddyAnimator({
  transport,
  getModel,
  render,
  intervalMs = 333,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  let running = false;
  let paused = false;
  let phase = 0;

  async function loop() {
    while (running) {
      if (!paused) {
        try {
          const model = getModel();
          if (model) {
            const frame = await render({ ...model, buddy: { ...model.buddy, animPhase: phase } });
            if (!paused && running) {
              phase = (phase + 1) % 1_000_000;
              await transport.push(frame);
            }
          }
        } catch { /* idle 帧：吞掉 getModel/render/push 异常，继续循环 */ }
      }
      await sleep(intervalMs);
    }
  }

  return {
    start() { if (!running) { running = true; loop().catch(() => { running = false; }); } },
    stop() { running = false; },
    pause() { paused = true; },
    resume() { paused = false; },
  };
}
