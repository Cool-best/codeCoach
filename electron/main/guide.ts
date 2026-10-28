import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import { z } from "zod";
import type { Condition, Tutorial, TutorialStep } from "../../shared/types";

const MAX_GUIDE_BYTES = 2 * 1024 * 1024;

const frontmatterSchema = z.object({
  coach_version: z.literal(1),
  tutorial_id: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  version: z.string().min(1).max(50),
  description: z.string().max(2000).default(""),
});

const ruleSchema = z
  .object({
    id: z.string().min(1).optional(),
    type: z.enum(["file_exists", "file_contains"]),
    path: z
      .string()
      .min(1)
      .max(500)
      .refine(
        (value) =>
          !value.includes("\\") &&
          !path.posix.isAbsolute(value) &&
          !path.win32.isAbsolute(value) &&
          !value.split("/").includes(".."),
        "教程路径必须是工作区内的正斜杠相对路径",
      ),
    pattern: z.string().max(20_000).optional(),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.type === "file_contains" && !rule.pattern) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "file_contains 需要非空 pattern" });
    }
  });

const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema).min(1) }).strict(),
    z.object({ any: z.array(conditionSchema).min(1) }).strict(),
    z.object({ not: conditionSchema }).strict(),
    ruleSchema,
  ]),
);

const verificationSchema = z
  .object({
    cwd: z.literal("."),
    command: z.array(z.string().min(1).max(500)).min(1).max(20),
    moduleFile: z
      .string()
      .max(500)
      .refine(
        (value) =>
          !value.includes("\\") &&
          !path.posix.isAbsolute(value) &&
          !path.win32.isAbsolute(value) &&
          !value.split("/").includes(".."),
        "验收模块必须是工作区内的正斜杠相对路径",
      )
      .optional(),
    expectedOutput: z.string().min(1).max(500),
    manual: z.literal(true),
  })
  .strict();

const editSchema = z.object({
  path: z.string().min(1).max(500).refine(
    (value) =>
      !value.includes("\\") &&
      !path.posix.isAbsolute(value) &&
      !path.win32.isAbsolute(value) &&
      !value.split("/").includes(".."),
    "修改路径必须是工作区内的正斜杠相对路径",
  ),
  summary: z.string().min(1).max(1000),
  instructions: z.array(z.string().min(1).max(2000)).min(1).max(30),
  functions: z.array(z.object({
    name: z.string().min(1).max(200),
    signature: z.string().min(1).max(1000),
    purpose: z.string().min(1).max(2000),
    parameters: z.array(z.object({
      name: z.string().min(1).max(200),
      type: z.string().min(1).max(200),
      description: z.string().min(1).max(1000),
    }).strict()).max(50),
    returns: z.string().min(1).max(2000),
    sideEffects: z.string().min(1).max(1000).default("无"),
  }).strict()).max(20).default([]),
  requiredPatterns: z.array(z.string().min(1).max(20_000)).min(1).max(100),
}).strict();

const stepSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).max(100),
    summary: z.string().max(500).default(""),
    prerequisites: z.array(z.string()).default([]),
    next: z.array(z.string()).default([]),
    acceptance: z.array(z.string()).default([]),
    completion: conditionSchema.optional(),
    verification: verificationSchema.optional(),
    edits: z.array(editSchema).max(100).optional(),
    hints: z.array(z.string()).default([]),
    sample: z
      .object({
        language: z.string().max(50).default("plaintext"),
        code: z.string().max(200_000),
        targetPath: z.string().max(500).optional(),
      })
      .strict()
      .optional(),
    lineMode: z
      .array(z.object({ code: z.string(), explanation: z.string() }).strict())
      .max(1000)
      .optional(),
    diagram: z
      .object({
        sourceId: z.string().min(1),
        highlightMessages: z.array(z.number().int().positive()).default([]),
      })
      .strict()
      .optional(),
  })
  .strict();

const markdown = new MarkdownIt({ html: false, linkify: true });
const defaultLinkRender =
  markdown.renderer.rules.link_open ??
  ((tokens, index, options, _environment, self) => self.renderToken(tokens, index, options));
markdown.renderer.rules.link_open = (tokens, index, options, environment, self) => {
  tokens[index]?.attrSet("target", "_blank");
  tokens[index]?.attrSet("rel", "noreferrer noopener");
  return defaultLinkRender(tokens, index, options, environment, self);
};

export async function loadGuide(filePath: string): Promise<Tutorial> {
  const raw = await readFile(filePath, { encoding: "utf8", flag: "r" });
  if (Buffer.byteLength(raw, "utf8") > MAX_GUIDE_BYTES) {
    throw new Error("教程文件不能超过 2 MB");
  }
  return parseGuide(raw);
}

export function parseGuide(source: string): Tutorial {
  const parsed = matter(source);
  const frontmatter = frontmatterSchema.parse(parsed.data);
  const tokens = markdown.parse(parsed.content, {});
  const sections: Array<{ title: string; tokens: typeof tokens }> = [];
  let introduction: typeof tokens = [];
  let current: { title: string; tokens: typeof tokens } | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.type === "heading_open" && token.tag === "h2") {
      const titleToken = tokens[index + 1];
      current = { title: titleToken?.content ?? "未命名步骤", tokens: [] };
      sections.push(current);
      index += 2;
      continue;
    }
    if (current) current.tokens.push(token!);
    else introduction.push(token!);
  }

  if (sections.length === 0) throw new Error("教程至少需要一个二级标题步骤");

  const steps = sections.map((section) => parseStep(section.title, section.tokens));
  validateStepGraph(steps);

  return {
    schemaVersion: 1,
    tutorialId: frontmatter.tutorial_id,
    version: frontmatter.version,
    title: frontmatter.title,
    description: frontmatter.description || markdown.renderInline(introduction.map((token) => token.content).join(" ")),
    steps,
  };
}

function parseStep(
  title: string,
  tokens: ReturnType<MarkdownIt["parse"]>,
): TutorialStep {
  const coachTokens = tokens.filter((token) => {
    if (token.type !== "fence") return false;
    const info = token.info.trim().split(/\s+/);
    return info[0] === "json" && info[1] === "coach";
  });
  if (coachTokens.length !== 1) {
    throw new Error(`步骤“${title}”必须且只能包含一个 json coach 配置块`);
  }

  let metadata: z.infer<typeof stepSchema>;
  try {
    metadata = stepSchema.parse(JSON.parse(coachTokens[0]!.content));
  } catch (error) {
    throw new Error(`步骤“${title}”配置无效：${error instanceof Error ? error.message : String(error)}`);
  }

  const diagrams = new Map<string, string>();
  for (const token of tokens) {
    if (token.type !== "fence") continue;
    const [language, sourceId] = token.info.trim().split(/\s+/);
    if (language === "mermaid" && sourceId) diagrams.set(sourceId, token.content);
  }

  const ordinaryCode = tokens.find((token) => {
    if (token.type !== "fence") return false;
    const [language, kind] = token.info.trim().split(/\s+/);
    return language !== "mermaid" && kind !== "coach";
  });
  const sample = metadata.sample ??
    (ordinaryCode
      ? {
          language: ordinaryCode.info.trim().split(/\s+/)[0] || "plaintext",
          code: ordinaryCode.content.replace(/\n$/, ""),
          targetPath: undefined,
        }
      : undefined);

  const contentTokens = tokens.filter((token) => {
    if (token.type !== "fence") return true;
    const [language, kind] = token.info.trim().split(/\s+/);
    if (language === "mermaid" || (language === "json" && kind === "coach")) return false;
    return !metadata.sample && token !== ordinaryCode;
  });

  const diagramSource = metadata.diagram ? diagrams.get(metadata.diagram.sourceId) : undefined;
  if (metadata.diagram && !diagramSource) {
    throw new Error(`步骤“${title}”引用了不存在的 Mermaid 图 ${metadata.diagram.sourceId}`);
  }

  return {
    id: metadata.id,
    title,
    summary: metadata.summary,
    prerequisites: metadata.prerequisites,
    next: metadata.next,
    acceptance: metadata.acceptance,
    completion: metadata.completion,
    verification: metadata.verification,
    edits: metadata.edits,
    content: {
      markdown: markdown.renderer.render(contentTokens, markdown.options, {}),
      hints: metadata.hints,
      sample,
      lineMode: metadata.lineMode,
      diagram: metadata.diagram
        ? {
            id: metadata.diagram.sourceId,
            source: diagramSource!,
            highlightMessages: metadata.diagram.highlightMessages,
          }
        : undefined,
    },
  };
}

function validateStepGraph(steps: TutorialStep[]): void {
  const ids = new Set<string>();
  for (const step of steps) {
    if (ids.has(step.id)) throw new Error(`步骤 ID 重复：${step.id}`);
    ids.add(step.id);
  }
  for (const step of steps) {
    for (const reference of [...step.next, ...step.prerequisites]) {
      if (!ids.has(reference)) throw new Error(`步骤 ${step.id} 引用了不存在的步骤 ${reference}`);
    }
  }

  const byId = new Map(steps.map((step) => [step.id, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stepId: string): void => {
    if (visiting.has(stepId)) throw new Error(`步骤存在循环依赖：${stepId}`);
    if (visited.has(stepId)) return;
    visiting.add(stepId);
    for (const next of byId.get(stepId)?.next ?? []) visit(next);
    visiting.delete(stepId);
    visited.add(stepId);
  };
  for (const step of steps) visit(step.id);
}

export function getGuideId(tutorial: Tutorial): string {
  return createHash("sha256").update(`${tutorial.tutorialId}@${tutorial.version}`).digest("hex").slice(0, 24);
}
