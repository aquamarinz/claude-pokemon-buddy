# Usage Bridge 配置（官方 statusline rate_limits）

把 buddy 的 5h/周用量百分比接到 Claude Code 官方 `rate_limits` 真实值。原理：CC 经
`statusLine` command 把含 `rate_limits` 的会话 JSON 从 stdin 喂给
`host/src/usage-bridge.mjs` → bridge 原子写 `~/.claude/cpb-usage.json` → buddy host
读它出官方 5h/周% + reset。ccusage 仍保留，只出 today cost/token。

## CC 版本要求

```bash
claude --version   # 需 ≥ 2.1.80（rate_limits 字段从该版本起出现在 statusLine 输入）
```

## Windows（朋友 / 产品机）

编辑 `C:\Users\<name>\.claude\settings.json`，加入（路径用**正斜杠**避免 Git Bash 转义）：

```json
{
  "statusLine": {
    "type": "command",
    "command": "node C:/Users/<name>/path/to/claude-pokemon-buddy/host/src/usage-bridge.mjs"
  }
}
```

## Mac（本机试运行）

编辑 `~/.claude/settings.json`，`command` 指向本仓库的 `usage-bridge.mjs` 绝对路径
（在仓库根 `pwd` 取实际路径）：

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /Users/<you>/path/to/claude-pokemon-buddy/host/src/usage-bridge.mjs"
  }
}
```

## 已有 statusline 共存警告

若已配了 claude-hud 等 statusLine，此配置会**替换**它（CC 只跑一个 statusLine command）。
如需保留原状态栏，让 `usage-bridge.mjs` 内部再 `spawn` 原命令并把它的输出拼到本脚本输出后
（留作可选增强，默认直接替换）。

## `rate_limits` 缺失说明

- 仅 Pro / Max 订阅会有 `rate_limits`，且**会话首个 API 响应后**才出现。
- 首次配好后，在 CC 里发一条消息触发一次 statusLine + 首个 API 响应即可。
- bridge 永不抛错：缺 `rate_limits` 时写出 `fiveHourPct: null` / `weeklyPct: null`，
  host 侧经 `loadRateLimits` 显示 `--` 而非 0/100。

## 验证

触发一次后检查写出的文件：

```bash
cat ~/.claude/cpb-usage.json   # 应含 fiveHourPct/weeklyPct（数字）+ writtenAt
```

> 自定义路径：bridge 支持 `CPB_USAGE_PATH` 环境变量覆盖输出路径（测试用）。
