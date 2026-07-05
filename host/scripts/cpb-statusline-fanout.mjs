#!/usr/bin/env node
// 跨平台 statusline fan-out：CC 的 statusline JSON 同时喂
//   1) buddy usage-bridge（写 cpb-usage.json，丢弃其单行输出）
//   2) 用户原有的 statusline command（stdout 透传，状态栏显示不变）
// 原 command 失败/缺省 → 退回 bridge 的一行。永不抛错（statusLine 崩溃会劣化 CC UI）。
// 用法：node cpb-statusline-fanout.mjs <原 statusline command 完整字符串>
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE = join(HERE, "..", "src", "usage-bridge.mjs");
const original = resolveOriginal(process.argv.slice(2));

// --b64 <base64> 单参数形态：原 command 带空格路径/嵌套引号时免转义（settings.json 里推荐用这个）
function resolveOriginal(args) {
  if (args[0] === "--b64" && args[1]) {
    try { return Buffer.from(args[1], "base64").toString("utf8").trim(); } catch { return ""; }
  }
  return args.join(" ").trim();
}

const input = await new Promise((resolve) => {
  let s = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (s += c));
  process.stdin.on("end", () => resolve(s));
  process.stdin.on("error", () => resolve(""));
});

const [bridgeOut, primaryOut] = await Promise.all([
  runChild(process.execPath, [BRIDGE], input, {}),
  original ? runChild(original, null, input, { shell: true }) : Promise.resolve(null),
]);

process.stdout.write(primaryOut?.ok ? primaryOut.stdout : bridgeOut.stdout);
process.exit(0);

function runChild(cmd, args, stdinText, opts) {
  return new Promise((resolve) => {
    let child;
    try {
      child = args ? spawn(cmd, args, opts) : spawn(cmd, opts);
    } catch {
      resolve({ ok: false, stdout: "" });
      return;
    }
    let out = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (c) => (out += c));
    child.on("error", () => resolve({ ok: false, stdout: "" }));
    child.on("close", (code) => resolve({ ok: code === 0, stdout: out }));
    child.stdin?.on("error", () => {});
    child.stdin?.end(stdinText);
  });
}
