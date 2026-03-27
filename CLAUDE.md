# Claude Code 实战经验总结

> 来源：Matt Van Horn (@mvanhorn) — "Every Claude Code Hack I Know (March 2026)"
> https://x.com/mvanhorn/status/2035857346602340637
> 注：原作者使用 macOS，以下已针对 **Windows 11** 调整。

---

## 核心理念：先计划，后执行

传统开发是 80% 编码 + 20% 规划。这个工作流将其反转：**80% 规划 + 20% 执行**。

---

## 1. 任何想法都先 `/ce:plan`

- 有产品想法 → `/ce:plan`
- 看到 GitHub issue → 复制 URL 粘贴 → `/ce:plan`
- 终端报错 → 截图（`Win+Shift+S`）粘贴进 Claude Code → `/ce:plan fix this`
- Claude Code 支持直接粘贴图片（截图、设计稿、Slack 对话）

**`/ce:plan` 会并行启动多个研究 agent：**
- 分析你的代码库（文件、模式、规范）
- 搜索 `docs/solutions/` 历史经验
- 研究外部最佳实践和框架文档

输出结构化的 `plan.md`：问题描述、方案、需改动的文件、带 checkbox 的验收标准、可参考的代码模式。

**`/ce:work`** 读取 plan.md 并执行：拆任务、实现、跑测试、勾掉标准。上下文丢失也没关系——新 session 指向 plan.md，从断点继续。

> 插件：`/plugin marketplace add EveryInc/compound-engineering-plugin`

---

## 2. 同时跑 4-6 个并行 Session

Windows Terminal 支持多标签页，每个标签是独立的 Claude Code session：

- 标签 1：在写 plan
- 标签 2：在执行另一个 plan（`/ce:work`）
- 标签 3：在跑 `/last30days` 调研
- 标签 4：在修 bug

**前提：必须开启 bypass permissions，否则无法上下文切换。**

> 推荐终端：**Windows Terminal**（微软官方，支持多标签、分屏、WSL）

---

## 3. 三个关键配置

### `%USERPROFILE%\.claude\settings.json`

```json
{
  "permissions": {
    "allow": [
      "WebSearch", "WebFetch", "Bash",
      "Read", "Write", "Edit",
      "Glob", "Grep", "Task", "TodoWrite"
    ],
    "deny": [],
    "defaultMode": "bypassPermissions"
  },
  "skipDangerousModePermissionPrompt": true,
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "powershell -c \"[System.Media.SystemSounds]::Beep.Play()\""
          }
        ]
      }
    ]
  }
}
```

- `bypassPermissions` + `skipDangerousModePermissionPrompt: true`：跳过每次操作的确认弹窗
- `Stop` hook 播放完成提示音：走开干别的，听到声音再回来（多 session 并行时必备）
- Windows 下用 PowerShell 播放系统提示音替代 macOS 的 `afplay`

### Zed 编辑器自动保存（`Ctrl+,`）

```json
{
  "autosave": {
    "after_delay": {
      "milliseconds": 500
    }
  }
}
```

Zed 每 500ms 保存，Claude Code 监听文件系统。Claude 改文件 → Zed 即时显示；你在 Zed 里打字 → Claude 1 秒内看到。Windows Terminal 和 Zed 各占半屏，像在 Google Doc 里协作。

> Zed 已支持 Windows，直接官网下载：zed.dev

---

## 4. 先调研再规划：`/last30days`

在 `/ce:plan` 之前，先运行 `/last30days <主题>`：

- 并行搜索 Reddit、X、YouTube、TikTok、Instagram、HN、Polymarket
- 几分钟内给出社区当前真实认知（非模型训练数据）
- 将输出直接喂给 `/ce:plan`，生成的计划基于最新信息

> 开源项目：`github.com/mvanhorn/last30days-skill`（4.5K stars）
> 安装：`@slashlast30days`

---

## 5. 把会议记录变成 plan.md

1. 用会议录制工具记录会议（Granola 暂无 Windows 版，可用 Teams/飞书内置转录）
2. 粘贴完整转录到 Claude Code
3. `/ce:plan turn this into a product proposal`
4. Claude 会交叉比对代码库 + 历史 strategy plan.md 文件

会议记录 + 代码库 + 历史策略 = 高质量的产品提案。

---

## 6. plan.md 不只用于写代码

同样的工作流适用于：

- 策略文档
- 产品 spec
- 竞品分析
- 文章写作

Claude Code 能访问 GitHub 代码库 + 所有历史 plan.md，每次规划都有完整上下文。

---

## 7. 远程工作

- **Telegram 集成**：手机通过 Telegram MCP 发消息给 Claude Code，外出时触发任务，回来时结果已就绪（当前环境已配置 Telegram MCP）
- **断线续跑**：在远程机器上跑 Claude Code session，本地只是窗口；Windows 下可用 WSL + tmux 或直接 SSH 到远程 Linux/Mac 服务器

---

## 8. Token 管理：双订阅策略

- **Claude Max**（$200/月）：规划、调研、Opus 编排
- **Codex**（$200/月）：重度实现任务
- `/ce:work --codex`：Claude credits 不足时自动切换到 Codex 执行

---

## 获取网页内容

优先使用 **Claude in Chrome（`mcp__Claude_in_Chrome`）** 工具获取网页，而非 `WebFetch`：

- `WebFetch` 无法执行 JavaScript，遇到 SPA / 需登录的页面（X、GitHub 等）会返回空页或错误
- Chrome MCP 在真实浏览器中运行，已登录状态、动态渲染内容均可正常读取
- 流程：`tabs_context_mcp` → `navigate` → `get_page_text` / `read_page`

---

## 工具清单（Windows 适配版）

| 工具 | 用途 | Windows 状态 |
|------|------|-------------|
| Compound Engineering | `/ce:plan` + `/ce:work` 核心插件 | ✅ 可用 |
| Windows Terminal | 多标签并行 session | ✅ 原生支持 |
| Zed | 编辑器（500ms 自动保存） | ✅ 支持 Windows |
| /last30days | 实时社区调研 | ✅ 可用 |
| Telegram MCP | 手机远程触发任务 | ✅ 已配置 |
| Granola | 会议录制转 plan | ❌ 仅 macOS |
| Monologue / WhisperFlow | 语音注入 | ❌ 仅 macOS |

---

## 总结公式

```
研究 (/last30days) → 规划 (/ce:plan) → 执行 (/ce:work)
```

**无论在哪、做什么，plan.md 是唯一检查点。**
