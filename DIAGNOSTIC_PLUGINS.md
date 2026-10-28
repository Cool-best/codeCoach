# 诊断插件包：独立更新错误定位规则

CodeCoach 支持单文件 `.coachdiag` 诊断插件。插件只包含声明式规则，不是 npm 包，也不会执行 JavaScript、Python 或 shell。新增或调整常见错误规则时，不需要重新构建 exe。

## 1. 工作方式

每次点击“分析最后一行错误”时，应用依次读取：

1. 应用内置 `resources/diagnostics` 目录下的 `.coachdiag` 或 `.json` 文件。
2. 用户目录 `%APPDATA%\CodeCoach\diagnostics\plugins` 下的 `.coachdiag` 或 `.json` 文件。
3. 按 `priority` 从高到低匹配，最后使用内置诊断作为降级。

首次启动时，应用会把内置插件预置到用户目录；同名文件已经存在时不会覆盖，因此升级应用不会抹掉用户修改。加载时，用户目录中的同 ID 规则覆盖内置副本，其他规则仍按 `priority` 匹配。

修改插件后，下一次分析就会重新加载，无需重启或重新打包。无效插件会被忽略并记录警告，不影响内置规则。

当前插件是**声明式规则包**，适合做错误签名、条件匹配、修复文案和命令模板。新的文件探针、网络请求或 Python 环境探测仍需要宿主提供安全能力，插件不能自行执行这些操作。

## 2. 包结构

```json
{
  "schemaVersion": 1,
  "pluginId": "codecoach.python-modules",
  "version": "1.1.0",
  "rules": [
    {
      "id": "python.module.src-path",
      "priority": 90,
      "errorPattern": "ModuleNotFoundError: No module named",
      "flags": "i",
      "cwd": "workspace",
      "moduleFileExists": true,
      "category": "dependency",
      "title": "源码文件存在，但 src 未进入模块搜索路径",
      "summary": "{{moduleFile}} 已存在，请检查 editable 安装。",
      "actions": ["执行 python -m pip install -e \".[dev]\""],
      "suggestedCommands": ["{{cdCommand}}", "{{command}}"]
    }
  ]
}
```

条件字段：

- `errorPattern`：对错误文本匹配的 JavaScript 正则，最长 2000 字符。
- `flags`：只允许 `g`、`i`、`m` 的组合。
- `cwd`：`workspace`、`outside_workspace` 或 `any`。
- `moduleFileExists`：可选，使用宿主对 `verification.moduleFile` 的安全文件检查。

模板变量：

- `{{workspace}}`：用户选择的项目根目录。
- `{{currentDirectory}}`：用户填写的报错目录。
- `{{command}}`：当前步骤验收命令。
- `{{cdCommand}}`：PowerShell 返回工作区命令。
- `{{moduleFile}}`：当前步骤验收模块文件。

`category` 只能是 `working_directory`、`dependency`、`message_schema`、`assertion`、`environment`、`unknown`。

## 3. 安装或更新插件

内置插件无需手动安装，首次启动后可在上述用户目录直接查看和调整。安装第三方插件时使用 PowerShell：

```powershell
$pluginDir = "$env:APPDATA\CodeCoach\diagnostics\plugins"
New-Item -ItemType Directory -Force $pluginDir
Copy-Item .\codecoach.python-modules-1.1.0.coachdiag $pluginDir
```

然后重新点击“分析最后一行错误”。不需要重启 CodeCoach。

更新时直接替换同目录文件。建议先备份旧插件，并通过小范围错误样例验证后再分发。

## 4. 打包

校验并复制内置插件到发布目录：

```powershell
npm run diagnostics:pack
```

打包自己的插件：

```powershell
npm run diagnostics:pack -- path/to/my-plugin.coachdiag
```

输出位于 `release/plugins/<pluginId>-<version>.coachdiag`。单文件包中同时包含 manifest 和全部规则，无需 zip 或 npm install。

## 5. 安全边界

- 只安装来源可信的插件文件。
- 插件没有文件系统、网络、进程或环境变量权限。
- 正则长度和规则数量有限制，但分发前仍应检查恶意复杂正则。
- 模板只会替换文本，不会执行命令。
- `suggestedCommands` 仅展示给用户，CodeCoach 不会自动执行。
- 当前没有插件签名和远程仓库，不要从不可信链接直接下载并覆盖规则。

## 6. 为什么这次能更准确

旧诊断只匹配 `ModuleNotFoundError`，因此只能给出泛化的“依赖未安装”。现在宿主先检查 `verification.moduleFile`：

- 文件不存在：提示文件路径或教程协议不一致。
- 文件存在且目录错误：提示返回项目根目录。
- 文件存在且已经位于根目录：明确提示 `src` 未进入 Python 模块搜索路径，优先检查 editable 安装。

这类新条件如果只需新的错误签名和文案，可直接更新插件；如果需要新的证据采集能力，才需要升级宿主。
