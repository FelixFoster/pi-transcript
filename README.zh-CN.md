# pi-transcript

**模型可以压缩上下文，但你应该仍然能看到自己问过什么。**

基于 Pi 官方扩展接口的只读历史阅读器。`/transcript` 可以查看、搜索当前分支的原始对话，包括压缩前的内容；工具输出和思考默认折叠，主界面保留最近问题的一行预览。

[English](README.md) · [架构](docs/architecture.md) · [安全边界](SECURITY.md)

## 安装

需要 Node.js 22.19+ 和 `@earendil-works` 版 Pi。

```bash
pi install git:github.com/FelixFoster/pi-transcript@v0.1.0
```

在 Pi 中执行 `/reload`，然后：

```text
/transcript
/transcript 之前问题中的关键词
```

也可按 `Ctrl+Shift+H`。若终端拦截快捷键，使用命令即可。当前版本通过 GitHub 分发，**尚未发布到 npm**。

## 使用

- 默认定位到最近一次提问，Home 回到当前分支的开头。
- ↑↓ / j、k：切换条目；PgUp/PgDn：翻页阅读长消息。
- Enter / 空格：折叠或展开当前条目。
- `/` 或 Ctrl+F：搜索；Enter 应用，Esc 取消编辑。
- 搜索覆盖折叠的工具输出和思考，按 n/N 切换匹配条目。
- `u`：只看用户提问；`c`：清除搜索；Esc / q：退出。
- 全屏模式下，宿主支持时可用滚轮和点击；普通终端模式使用键盘导航。
- `/transcript-pin`：开关主界面的最近问题预览，当前运行时生效，重载后重置。
- `pi --transcript-no-pin`：本次运行关闭预览。

搜索是忽略大小写的字面量匹配，不是正则。匹配结果按条目过滤，匹配的活动自动展开；长条目尝试跳到首个完整落在换行后单行内的匹配，其他位置继续翻页查看，不提供逐个匹配位置跳转。

## 明确边界

**这是独立阅读器，不是主聊天区的无缝无限回滚补丁。**

- 不改 `buildContextEntries()`、模型上下文或渲染器，不打猴子补丁。
- 不关闭压缩，不降低 token 消耗，也不让模型重新获得所有历史。
- 不复制消息到会话，不修改 JSONL，不上传数据，不写额外历史库。
- 只显示当前分支。查看其他分支请先用 Pi 的 `/tree` 切换。
- 内容以纯文本显示；图片用占位符，隐藏的扩展消息和内部状态不展示。
- 原工具已经截断、会话已删除、导入时缺失的内容无法恢复。
- 阅读器是打开时的快照；继续执行产生的新内容需要关闭后重新打开。
- 虚拟视口只对当前可见/访问的条目换行，缓存最多 32 个条目；读取投影和搜索仍随文本量线性增长，不是无限内存方案。

## 验证

测试矩阵针对 Pi **0.85.1 / 1.5.0**、Node.js **22 / 24**。其他版本未验证；通配 peer dependency 不代表所有版本兼容。

包含真实 SessionManager、真实压缩完成 UI 处理函数的回归测试，以及 regular / fullscreen 两种模式下的真实 CLI 伪终端测试。伪终端使用隔离 HOME、合成对话、离线启动，不读取真实会话，也不调用模型。它不等同于真实服务商调用下的端到端压缩验证。

```bash
npm ci --ignore-scripts
npm run check
python3 tests/pty_smoke.py
```

## 卸载

```bash
pi remove git:github.com/FelixFoster/pi-transcript
```

执行 `/reload`，预览和状态栏被清理，没有实例补丁残留，会话文件不变。临时使用 `-e` 加载时，请重启并去掉该参数。

## 开源协作

问题反馈请使用合成或脱敏内容，**不要上传真实会话 JSONL、密钥或私有代码**。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

本项目受到 `pi-tui-history-replay` 所探索问题的启发，但代码为独立实现，采用不同的 UI 和生命周期设计，不是重命名复制或 fork。

MIT © FelixFoster。
