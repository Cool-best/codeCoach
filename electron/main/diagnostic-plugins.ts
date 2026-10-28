import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { z } from "zod";
import type { ErrorDiagnosis } from "../../shared/types";
import { diagnoseError, type DiagnosticContext } from "./diagnostics";

const ruleSchema = z.object({
  id: z.string().min(1).max(150),
  priority: z.number().int().min(0).max(10_000).default(50),
  errorPattern: z.string().min(1).max(2000),
  flags: z.string().regex(/^[gim]*$/).default("i"),
  cwd: z.enum(["workspace", "outside_workspace", "any"]).default("any"),
  moduleFileExists: z.boolean().optional(),
  category: z.enum(["working_directory", "dependency", "message_schema", "assertion", "environment", "unknown"]),
  title: z.string().min(1).max(300),
  summary: z.string().min(1).max(2000),
  actions: z.array(z.string().max(1000)).max(20).default([]),
  suggestedCommands: z.array(z.string().max(1000)).max(20).default([]),
}).strict();

const pluginSchema = z.object({
  schemaVersion: z.literal(1),
  pluginId: z.string().min(1).max(150),
  version: z.string().min(1).max(50),
  rules: z.array(ruleSchema).min(1).max(100),
}).strict();

type DiagnosticRule = z.infer<typeof ruleSchema>;

interface PluginOptions {
  builtInFile: string;
  pluginDirectory: string;
}

export async function diagnoseWithPlugins(
  errorText: string,
  context: DiagnosticContext,
  options: PluginOptions,
): Promise<ErrorDiagnosis> {
  const rules: DiagnosticRule[] = [];
  for (const file of await pluginFiles(options)) {
    try {
      const plugin = pluginSchema.parse(JSON.parse(await readFile(file, "utf8")));
      rules.push(...plugin.rules);
    } catch (error) {
      console.warn(`忽略无效诊断插件 ${file}`, error);
    }
  }
  rules.sort((left, right) => right.priority - left.priority);

  for (const rule of rules) {
    if (!new RegExp(rule.errorPattern, rule.flags).test(errorText)) continue;
    if (rule.moduleFileExists !== undefined && rule.moduleFileExists !== context.moduleFileExists) continue;
    const outside = isOutsideWorkspace(context);
    if (rule.cwd === "workspace" && outside) continue;
    if (rule.cwd === "outside_workspace" && !outside) continue;
    const lines = errorText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {
      signature: rule.id,
      title: render(rule.title, context),
      category: rule.category,
      summary: render(rule.summary, context),
      errorLine: lines.at(-1) ?? "未提供错误内容",
      actions: rule.actions.map((action) => render(action, context)),
      suggestedCommands: rule.suggestedCommands.map((command) => render(command, context)),
    };
  }
  return diagnoseError(errorText, context);
}

async function pluginFiles(options: PluginOptions): Promise<string[]> {
  const files = [options.builtInFile];
  try {
    const entries = await readdir(options.pluginDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && /(?:\.coachdiag|\.json)$/i.test(entry.name)) {
        files.push(path.join(options.pluginDirectory, entry.name));
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return files;
}

function isOutsideWorkspace(context: DiagnosticContext): boolean {
  const current = context.currentDirectory?.trim();
  if (!current) return false;
  return path.resolve(current).toLowerCase() !== path.resolve(context.workspacePath).toLowerCase();
}

function render(template: string, context: DiagnosticContext): string {
  const values: Record<string, string> = {
    workspace: context.workspacePath,
    currentDirectory: context.currentDirectory ?? context.workspacePath,
    command: context.verification?.command.join(" ") ?? "",
    cdCommand: `Set-Location "${context.workspacePath}"`,
    moduleFile: context.verification?.moduleFile ?? "",
  };
  return template.replace(/\{\{(workspace|currentDirectory|command|cdCommand|moduleFile)\}\}/g, (_match, key: string) => values[key] ?? "");
}
