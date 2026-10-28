const fs = require("node:fs");
const path = require("node:path");
const { loadGuide } = require("../dist-electron/electron/main/guide.js");

const args = process.argv.slice(2);
const files = [];
let format = "text";
let strict = false;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--format") format = args[++index] ?? "text";
  else if (args[index] === "--strict") strict = true;
  else files.push(args[index]);
}
if (!["text", "json"].includes(format)) {
  console.error("--format only supports text or json");
  process.exit(2);
}
if (files.length === 0) {
  for (const file of fs.readdirSync("examples")) {
    if (/\.(md|markdown)$/i.test(file)) files.push(path.join("examples", file));
  }
}

function issue(level, rule, stepId, message) {
  return { level, rule, stepId, message };
}

function hasContentRule(condition) {
  if (!condition) return false;
  if ("type" in condition) return condition.type === "file_contains";
  if ("all" in condition) return condition.all.some(hasContentRule);
  if ("any" in condition) return condition.any.some(hasContentRule);
  if ("not" in condition) return hasContentRule(condition.not);
  return false;
}

async function lint(file) {
  const issues = [];
  let tutorial;
  try {
    tutorial = await loadGuide(path.resolve(file));
  } catch (error) {
    return { file, score: 0, issues: [issue("error", "protocol.parse", undefined, error instanceof Error ? error.message : String(error))] };
  }

  for (const step of tutorial.steps) {
    if (!step.summary) issues.push(issue("warning", "teaching.summary", step.id, "缺少一句话步骤目标"));
    if (step.acceptance.length === 0) issues.push(issue("warning", "teaching.acceptance", step.id, "缺少完成标准"));
    if (!step.content.sample?.code) issues.push(issue("warning", "teaching.sample", step.id, "缺少最小代码样板"));
    if (step.content.hints.length === 0) issues.push(issue("warning", "teaching.hints", step.id, "没有失败提示"));
    if (!hasContentRule(step.completion)) issues.push(issue("warning", "verification.weak-rule", step.id, "只有文件存在检查，无法证明关键实现已写入"));
    if (step.content.sample && /(?:\bTODO\b|if\s+False)/.test(step.content.sample.code)) {
      issues.push(issue("error", "sample.placeholder", step.id, "样板包含 TODO 或 if False，不能作为可靠实现"));
    }
    if (step.content.sample?.code.includes('("tool",')) {
      issues.push(issue("error", "sample.tool-message", step.id, "工具消息使用二元组且缺少 tool_call_id，应使用 ToolMessage"));
    }
    if (step.content.sample && step.content.sample.code.split(/\r?\n/).length > 250) {
      issues.push(issue("warning", "sample.too-large", step.id, "样板超过 250 行，建议拆分或提供最小版本"));
    }

    const verification = step.verification;
    const requiresGate = ["verify-m0", "verify-m1", "final-acceptance"].includes(step.id);
    if (requiresGate && !verification) {
      issues.push(issue("error", "verification.missing-gate", step.id, "阶段验收缺少结构化命令、目录和预期输出"));
    }
    if (verification) {
      const moduleIndex = verification.command.indexOf("-m");
      if (verification.moduleFile && moduleIndex >= 0) {
        const moduleName = verification.command[moduleIndex + 1];
        const expected = `src/${moduleName.replaceAll(".", "/")}.py`;
        if (expected !== verification.moduleFile) {
          issues.push(issue("error", "verification.module-mismatch", step.id, `命令模块 ${moduleName} 应对应 ${expected}，实际为 ${verification.moduleFile}`));
        }
        if (verification.cwd !== ".") {
          issues.push(issue("error", "verification.module-cwd", step.id, "src 布局的 python -m 验收必须从项目根目录执行"));
        }
      }
      if (verification.manual && !step.acceptance.some((item) => /运行|终端|pytest|确认/.test(item))) {
        issues.push(issue("warning", "verification.manual-unclear", step.id, "手动验收没有在完成标准中要求用户确认运行结果"));
      }
    }
  }

  const errorPenalty = issues.filter((item) => item.level === "error").length * 25;
  const warningPenalty = Math.min(45, issues.filter((item) => item.level === "warning").length * 4);
  return { file, title: tutorial.title, score: Math.max(0, 100 - errorPenalty - warningPenalty), issues };
}

(async () => {
  const reports = [];
  for (const file of files) reports.push(await lint(file));
  if (format === "json") console.log(JSON.stringify(reports, null, 2));
  else {
    for (const report of reports) {
      console.log(`\n${report.file}\nScore: ${report.score}/100`);
      if (report.issues.length === 0) console.log("PASS no quality issues found");
      for (const item of report.issues) {
        console.log(`${item.level.toUpperCase()} ${item.rule}${item.stepId ? ` [${item.stepId}]` : ""}\n  ${item.message}`);
      }
    }
  }
  const hasErrors = reports.some((report) => report.issues.some((item) => item.level === "error") || report.score < 80);
  const hasWarnings = reports.some((report) => report.issues.some((item) => item.level === "warning"));
  if (hasErrors || (strict && hasWarnings)) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
