import { realpath, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type { CheckEvidence, CheckReport, CheckRule, Condition, TutorialStep, WorkspaceInfo } from "../../shared/types";

const MAX_SOURCE_BYTES = 1024 * 1024;

export class WorkspaceMonitor {
  private watcher?: FSWatcher;
  private rootRealPath?: string;

  constructor(readonly info: WorkspaceInfo) {}

  async start(onChange: (changedPath: string) => void, onError: (message: string) => void): Promise<void> {
    this.rootRealPath = await realpath(this.info.path);
    this.watcher = watch(this.info.path, {
      ignoreInitial: true,
      depth: 20,
      ignored: [
        /(^|[/\\])(node_modules|\.git|dist|dist-electron|release|build|out|coverage|\.next|\.venv)([/\\]|$)/,
        /(^|[/\\])\.codecoach([/\\]|$)/,
      ],
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 80 },
    });
    this.watcher.on("all", (_event, changedPath) => onChange(changedPath));
    this.watcher.on("error", (error) => onError(error instanceof Error ? error.message : String(error)));
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    this.watcher = undefined;
  }

  async checkStep(step: TutorialStep): Promise<CheckReport> {
    const startedAt = new Date().toISOString();
    if (!step.completion) {
      return {
        stepId: step.id,
        status: "unknown",
        evidence: [this.evidence(step.id, "unknown", "此步骤没有自动完成规则，请人工确认")],
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    }
    const evidence: CheckEvidence[] = [];
    const status = await this.evaluate(step.completion, step.id, evidence);
    return { stepId: step.id, status, evidence, startedAt, finishedAt: new Date().toISOString() };
  }

  private async evaluate(
    condition: Condition,
    rulePrefix: string,
    evidence: CheckEvidence[],
  ): Promise<"passed" | "failed" | "unknown"> {
    if ("all" in condition || "any" in condition) {
      const isAll = "all" in condition;
      const children = isAll ? condition.all : condition.any;
      const results: Array<"passed" | "failed" | "unknown"> = [];
      for (let index = 0; index < children.length; index += 1) {
        results.push(await this.evaluate(children[index]!, `${rulePrefix}.${index}`, evidence));
      }
      if (isAll) {
        if (results.every((result) => result === "passed")) return "passed";
        if (results.some((result) => result === "failed")) return "failed";
        return "unknown";
      }
      if (results.some((result) => result === "passed")) return "passed";
      if (results.every((result) => result === "failed")) return "failed";
      return "unknown";
    }
    if ("not" in condition) {
      const result = await this.evaluate(condition.not, `${rulePrefix}.not`, evidence);
      return result === "passed" ? "failed" : result === "failed" ? "passed" : "unknown";
    }
    return this.checkRule(condition, rulePrefix, evidence);
  }

  private async checkRule(
    rule: CheckRule,
    ruleId: string,
    evidence: CheckEvidence[],
  ): Promise<"passed" | "failed" | "unknown"> {
    const id = rule.id ?? ruleId;
    try {
      const filePath = await this.resolveSafe(rule.path);
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        evidence.push(this.evidence(id, "failed", "目标不是文件", rule.path));
        return "failed";
      }
      if (rule.type === "file_exists") {
        evidence.push(this.evidence(id, "passed", `已找到 ${rule.path}`, rule.path));
        return "passed";
      }
      if (fileStat.size > MAX_SOURCE_BYTES) {
        evidence.push(this.evidence(id, "unknown", "文件超过 1 MB，未执行内容检查", rule.path));
        return "unknown";
      }
      const source = await readFile(filePath, "utf8");
      const passed = source.includes(rule.pattern!);
      evidence.push(
        this.evidence(
          id,
          passed ? "passed" : "failed",
          passed ? `内容检查通过：${rule.path}` : `未在 ${rule.path} 中找到预期内容`,
          rule.path,
        ),
      );
      return passed ? "passed" : "failed";
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        evidence.push(this.evidence(id, "failed", `文件不存在：${rule.path}`, rule.path));
        return "failed";
      }
      const message = error instanceof Error ? error.message : String(error);
      evidence.push(this.evidence(id, "unknown", message, rule.path));
      return "unknown";
    }
  }

  private async resolveSafe(relativePath: string): Promise<string> {
    if (!this.rootRealPath) throw new Error("工作区尚未就绪");
    if (
      relativePath.includes("\\") ||
      path.posix.isAbsolute(relativePath) ||
      path.win32.isAbsolute(relativePath) ||
      relativePath.split("/").includes("..")
    ) {
      throw new Error("教程路径越出工作区，已阻止访问");
    }
    const candidate = path.resolve(this.rootRealPath, ...relativePath.split("/"));
    this.assertInside(candidate);
    try {
      const existing = await realpath(candidate);
      this.assertInside(existing);
      return existing;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = await realpath(path.dirname(candidate));
      this.assertInside(parent);
      return candidate;
    }
  }

  private assertInside(candidate: string): void {
    const relative = path.relative(this.rootRealPath!, candidate);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
    throw new Error("教程路径越出工作区，已阻止访问");
  }

  private evidence(
    ruleId: string,
    status: CheckEvidence["status"],
    message: string,
    filePath?: string,
  ): CheckEvidence {
    return { ruleId, status, message, path: filePath, observedAt: new Date().toISOString() };
  }
}
