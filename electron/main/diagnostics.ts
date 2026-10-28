import path from "node:path";
import type { ErrorDiagnosis, Verification } from "../../shared/types";

export interface DiagnosticContext {
  workspacePath: string;
  currentDirectory?: string;
  verification?: Verification;
  moduleFileExists?: boolean;
}

export function diagnoseError(errorText: string, context: DiagnosticContext): ErrorDiagnosis {
  const lines = errorText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const errorLine = lines.at(-1) ?? "未提供错误内容";
  const verificationCommand = context.verification?.command.join(" ");
  const cdCommand = `Set-Location "${context.workspacePath}"`;
  const moduleError = /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/.exec(errorText);

  if (moduleError) {
    const moduleName = moduleError[1]!;
    const current = context.currentDirectory?.trim();
    const outsideWorkspace = current && path.resolve(current).toLowerCase() !== path.resolve(context.workspacePath).toLowerCase();
    if (context.moduleFileExists === false && context.verification?.moduleFile) {
      return {
        signature: "python.module.file-missing",
        title: "验收模块文件不存在或位置不一致",
        category: "working_directory",
        summary: `命令需要 ${context.verification.moduleFile}，但当前工作区没有找到它。先核对文件位置，不要重新安装依赖。`,
        errorLine,
        actions: [
          `确认文件存在于 ${context.verification.moduleFile}`,
          "检查包目录、文件名、扩展名以及是否误放到项目根目录",
          "文件位置修正后重新运行验收",
        ],
        suggestedCommands: [...(verificationCommand ? [cdCommand, verificationCommand] : [])],
      };
    }
    if (context.moduleFileExists === true && !outsideWorkspace && context.verification?.moduleFile?.startsWith("src/")) {
      return {
        signature: "python.module.src-path",
        title: "源码文件存在，但 src 未进入模块搜索路径",
        category: "dependency",
        summary: `${context.verification.moduleFile} 已存在，且当前位于项目根目录。python -m 不会自动把 src 加入 sys.path；优先检查 editable 安装是否完成或生效。`,
        errorLine,
        actions: [
          "在当前虚拟环境中执行 editable 安装，并确认命令没有报错",
          "用 python -m pip show ops-copilot 检查安装是否属于当前 Python",
          "临时验证可在 PowerShell 设置 $env:PYTHONPATH = \"$PWD\\src\" 后重跑；正式使用仍建议 editable 安装",
        ],
        suggestedCommands: [cdCommand, 'python -m pip install -e ".[dev]"', ...(verificationCommand ? [verificationCommand] : [])],
      };
    }
    if (outsideWorkspace && /(?:^|[/\\])src(?:[/\\]|$)/i.test(current)) {
      return {
        signature: "python.module.cwd",
        title: "运行目录导致找不到模块",
        category: "working_directory",
        summary: `你在 ${current} 中运行，Python 没有从项目根目录解析 ${moduleName}。先改目录，不要先改业务代码。`,
        errorLine,
        actions: [
          `返回项目根目录：${context.workspacePath}`,
          verificationCommand ? `使用模块方式重新运行：${verificationCommand}` : "使用教程声明的模块方式重新运行",
          "如果根目录仍报同样错误，再检查 editable 安装",
        ],
        suggestedCommands: [cdCommand, ...(verificationCommand ? [verificationCommand] : [])],
      };
    }
    return {
      signature: "python.module.install",
      title: "项目包或依赖尚未正确安装",
      category: "dependency",
      summary: `当前目录没有明显的包目录嵌套问题，接下来检查 ${moduleName} 是否安装，以及 src 布局是否已注册。`,
      errorLine,
      actions: [
        `确认终端位于项目根目录：${context.workspacePath}`,
        "在已激活的虚拟环境中重新安装当前项目的 editable 包",
        "仍失败时检查 pyproject.toml 的包发现和 pythonpath 配置",
      ],
      suggestedCommands: [cdCommand, 'python -m pip install -e ".[dev]"', ...(verificationCommand ? [verificationCommand] : [])],
    };
  }

  if (/KeyError:\s*['"]tool_call_id['"]/.test(errorText)) {
    return {
      signature: "langchain.tool-message.id",
      title: "工具消息缺少 tool_call_id",
      category: "message_schema",
      summary: "add_messages 正在构造 ToolMessage，但消息中没有必填的工具调用 ID。问题在 tools 节点的返回结构。",
      errorLine,
      actions: [
        "从 langchain_core.messages 导入 ToolMessage",
        "把 (\"tool\", ...) 二元组改为 ToolMessage(content=..., tool_call_id=...)",
        "M0 可使用 read-1；多动作时使用对应 action_id，然后重新运行验收",
      ],
      suggestedCommands: [...(verificationCommand ? [cdCommand, verificationCommand] : [])],
    };
  }

  if (/AssertionError/.test(errorText)) {
    return {
      signature: "python.assertion",
      title: "程序已运行，但结果不符合验收断言",
      category: "assertion",
      summary: "这通常不是模块安装问题。需要定位第一个失败的 assert，比较实际状态、调用次数或消息数量。",
      errorLine,
      actions: [
        "向上找到 demo 或测试中第一个失败断言行",
        "打印该断言左右的实际值，不要删除断言",
        "修复后重新运行同一验收命令",
      ],
      suggestedCommands: [...(verificationCommand ? [cdCommand, verificationCommand] : [])],
    };
  }

  if (/不是内部或外部命令|command not found|No such file or directory/.test(errorText)) {
    return {
      signature: "process.executable.missing",
      title: "命令或文件路径不可用",
      category: "environment",
      summary: "先确认可执行程序已安装、虚拟环境已激活，并核对当前目录与文件路径。",
      errorLine,
      actions: ["运行 python --version", "确认虚拟环境已激活", "核对工作区和命令中的相对路径"],
      suggestedCommands: ["python --version", cdCommand],
    };
  }

  return {
    signature: "generic.unclassified",
    title: "当前规则库无法确定具体原因",
    category: "unknown",
    summary: "先保留最后一行异常和最近出现的自己文件行。保存脱敏反馈后，可交给教程作者或有经验的开发者继续定位。",
    errorLine,
    actions: [
      "从最后一行确认异常类型和缺失字段",
      "向上找最近的自己文件、函数和行号",
      "记录执行命令、是否使用官方样板以及最近改动",
    ],
    suggestedCommands: [...(verificationCommand ? [cdCommand, verificationCommand] : [])],
  };
}
