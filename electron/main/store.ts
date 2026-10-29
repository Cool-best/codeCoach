import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AppSettings, GuideInfo, StepStatus, Tutorial, WorkspaceInfo } from "../../shared/types";
import { getGuideId, loadGuide } from "./guide";

const settingsSchema = z.object({
  opacity: z.number().min(0.45).max(1).default(0.94),
  fontScale: z.union([z.literal(0.85), z.literal(1), z.literal(1.15), z.literal(1.3)]).default(1),
  alwaysOnTop: z.boolean().default(true),
  clickThrough: z.boolean().default(false),
  collapsed: z.boolean().default(false),
  autoAdvance: z.boolean().default(false),
  lastGuideId: z.string().optional(),
  lastWorkspaceId: z.string().optional(),
});

const guideRecordSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  title: z.string(),
  tutorialId: z.string(),
  version: z.string(),
});

const workspaceRecordSchema = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
});

export interface ProgressRecord {
  schemaVersion: 1;
  tutorialId: string;
  tutorialVersion: string;
  workspaceId: string;
  currentStepId: string;
  statuses: Record<string, StepStatus>;
  updatedAt: string;
}

export class LocalStore {
  private settingsCache?: AppSettings;

  constructor(private readonly dataDirectory: string) {}

  async init(): Promise<void> {
    await Promise.all([
      mkdir(this.dataDirectory, { recursive: true }),
      mkdir(path.join(this.dataDirectory, "guides"), { recursive: true }),
      mkdir(path.join(this.dataDirectory, "progress"), { recursive: true }),
    ]);
  }

  async getSettings(): Promise<AppSettings> {
    if (this.settingsCache) return { ...this.settingsCache };
    const value = await this.readJson("settings.json", {});
    this.settingsCache = settingsSchema.parse(value);
    return { ...this.settingsCache };
  }

  async saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const settings = settingsSchema.parse({ ...(await this.getSettings()), ...patch });
    this.settingsCache = settings;
    await this.writeJson("settings.json", settings);
    return { ...settings };
  }

  async importGuide(sourcePath: string): Promise<GuideInfo> {
    const tutorial = await loadGuide(sourcePath);
    const guideId = getGuideId(tutorial);
    const fileName = `${guideId}.md`;
    await copyFile(sourcePath, path.join(this.dataDirectory, "guides", fileName));
    const records = await this.getGuideRecords();
    records[guideId] = {
      id: guideId,
      fileName,
      title: tutorial.title,
      tutorialId: tutorial.tutorialId,
      version: tutorial.version,
    };
    await this.writeJson("guides/index.json", records);
    return { guideId, tutorial };
  }

  async getGuide(guideId: string): Promise<GuideInfo> {
    const records = await this.getGuideRecords();
    const record = records[guideId];
    if (!record) throw new Error("找不到已导入的教程，请重新选择");
    const tutorial = await loadGuide(path.join(this.dataDirectory, "guides", record.fileName));
    return { guideId, tutorial };
  }

  async registerWorkspace(workspacePath: string): Promise<WorkspaceInfo> {
    const normalized = path.resolve(workspacePath);
    const workspace = {
      id: createHash("sha256").update(normalized.toLowerCase()).digest("hex").slice(0, 24),
      path: normalized,
      name: path.basename(normalized) || normalized,
    };
    const records = await this.getWorkspaceRecords();
    records[workspace.id] = workspace;
    await this.writeJson("workspaces.json", records);
    return workspace;
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceInfo> {
    const records = await this.getWorkspaceRecords();
    const workspace = records[workspaceId];
    if (!workspace) throw new Error("找不到工作区，请重新选择");
    return workspace;
  }

  async getProgress(tutorial: Tutorial, workspaceId: string): Promise<ProgressRecord | undefined> {
    const key = this.progressKey(tutorial, workspaceId);
    const value = await this.readJson<ProgressRecord | undefined>(`progress/${key}.json`, undefined);
    if (!value) return undefined;
    if (
      value.schemaVersion !== 1 ||
      value.tutorialId !== tutorial.tutorialId ||
      value.tutorialVersion !== tutorial.version ||
      value.workspaceId !== workspaceId ||
      !tutorial.steps.some((step) => step.id === value.currentStepId)
    ) {
      throw new Error("教程版本已变化，旧进度需要迁移；请使用“重新定位”建立新进度");
    }
    return value;
  }

  async saveProgress(progress: ProgressRecord): Promise<void> {
    const key = createHash("sha256")
      .update(`${progress.tutorialId}@${progress.tutorialVersion}:${progress.workspaceId}`)
      .digest("hex");
    await this.writeJson(`progress/${key}.json`, { ...progress, updatedAt: new Date().toISOString() });
  }

  private progressKey(tutorial: Tutorial, workspaceId: string): string {
    return createHash("sha256")
      .update(`${tutorial.tutorialId}@${tutorial.version}:${workspaceId}`)
      .digest("hex");
  }

  private async getGuideRecords(): Promise<Record<string, z.infer<typeof guideRecordSchema>>> {
    const records = await this.readJson("guides/index.json", {});
    return z.record(z.string(), guideRecordSchema).parse(records);
  }

  private async getWorkspaceRecords(): Promise<Record<string, z.infer<typeof workspaceRecordSchema>>> {
    const records = await this.readJson("workspaces.json", {});
    return z.record(z.string(), workspaceRecordSchema).parse(records);
  }

  private async readJson<T>(relativePath: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(path.join(this.dataDirectory, relativePath), "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
      throw error;
    }
  }

  private async writeJson(relativePath: string, value: unknown): Promise<void> {
    const destination = path.join(this.dataDirectory, relativePath);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, destination);
  }
}
