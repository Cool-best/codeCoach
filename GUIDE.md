# CodeCoach 教程编写、质量检查与反馈规范

## 1. 教程结构

教程使用 `coach_version: 1` frontmatter。每个二级标题是一个步骤，并且必须包含一个 `json coach` 块。普通 Markdown 用于教学，普通代码围栏提供最小样板，`mermaid <source-id>` 提供时序图。

步骤至少应有：

- 稳定 `id`、`summary`、`next`。
- 可观察的 `acceptance`。
- `completion` 文件检查规则。
- 必要的 `hints`、`lineMode` 和最小代码样板。
- 阶段验收所需的结构化 `verification`。

## 2. 结构化验收

当前版本不自动执行命令。`verification` 用于向用户展示真实工作区、可复制命令和预期输出，并辅助错误定位。

```json
{
  "verification": {
    "cwd": ".",
    "command": ["python", "-m", "ops_copilot.demo_m0"],
    "moduleFile": "src/ops_copilot/demo_m0.py",
    "expectedOutput": "M0 PASS",
    "manual": true
  }
}
```

约束：

- `cwd` 当前必须为 `.`，即用户选择的项目根目录。
- `command` 是参数数组，不是 shell 字符串。
- `moduleFile` 使用工作区内的正斜杠相对路径。
- `expectedOutput` 必须能由用户明确观察。
- `manual` 当前必须为 `true`，不能暗示应用已自动运行。
- src 布局下，`python -m ops_copilot.demo_m0` 必须对应 `src/ops_copilot/demo_m0.py`。

完成标准必须区分离线文件检查与用户手动运行结果。禁止把 `file_contains` 写成“测试已通过”。

## 3. 阶段验收要求

每个阶段都应回答四个问题：

1. 用户运行什么入口？
2. 在哪个目录运行？
3. 看到什么才算通过？
4. 失败后先检查什么？

只写“代码完成”或只检查文件存在，不足以构成阶段验收。关键 demo 应包含真实调用和断言，例如 `main()`、`graph.invoke()`、`pytest`、`TestClient` 或独立进程验证。

## 4. 质量评价脚本

先构建主进程，再检查所有内置教程：

```powershell
npm run guide:lint
```

检查指定教程或输出 JSON：

```powershell
npm run guide:lint -- examples/ops-copilot-langgraph.guide.md
npm run guide:lint -- --format json examples/ops-copilot-langgraph.guide.md
npm run guide:lint -- --strict examples/ops-copilot-langgraph.guide.md
```

评分从 100 分开始：

- 硬错误每项扣 25 分。
- 警告每项扣 4 分，警告最多合计扣 45 分。
- 低于 80 分或存在硬错误时命令返回非零。
- `--strict` 下任何警告也返回非零。

当前检查包括协议解析、步骤完整性、弱文件规则、危险占位写法、错误工具消息、阶段验收缺失、Python 模块路径不一致和手动验收说明。

分数用于比较和发现问题，不能证明教程可运行。发布前仍必须在干净目录原样执行官方 demo 和测试。

## 5. 发布质量门

```text
生成或修改 guide.md
→ npm run guide:lint -- --strict <文件>
→ 在干净目录导入教程
→ 原样执行所有官方验收命令
→ 修复失败并重新执行
→ 新手试走并记录卡点
→ 发布
```

以下情况不得发布：

- 官方样板本身无法运行。
- 关键实现用 TODO、`if False` 或无解释占位符冒充。
- 验收命令缺少目录、预期输出或排错说明。
- 模块名与实际文件路径不一致。
- 把用户手动测试描述成应用自动测试。
- 教程包含真实密钥、个人信息或越界路径。

## 6. 处理用户实际操练反馈

用户报告来自 CodeCoach 的脱敏 JSON，主要字段包括：

- `tutorialId`、`tutorialVersion`、`stepId`：确定教程位置。
- `command`、`currentDirectory`：复现运行上下文。
- `usedOfficialSample`：判断是否为官方样板问题的重要信号。
- `signature`、`category`、`errorLine`：初步错误分类。
- `errorText`：最近 20 行 traceback。
- `note`：用户补充的最近改动。

处理顺序：

1. **先复现**：使用相同教程版本、步骤和命令。
2. **区分来源**：教程协议、官方样板、用户改动、环境或检查器。
3. **官方样板优先**：`usedOfficialSample=true` 且可复现时，应优先修复教程。
4. **给出最小修复**：说明具体文件、结构和原因，避免让用户重装所有依赖。
5. **补回归验证**：把该错误加入 demo、pytest 或 `guide:lint` 规则。
6. **更新教程**：保持步骤 ID 稳定，记录修正内容并指导用户重新导入、重新定位。
7. **保护隐私**：公开 issue 前再次检查报告，不发布用户代码、令牌或个人信息。

如果规则库无法分类，不要由 AI 或作者凭空断言。先索取最小复现和最后 20 行异常，再判断下一步。
