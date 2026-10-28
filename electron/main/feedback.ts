import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { ErrorDiagnosis, FeedbackReport } from "../../shared/types";

interface FeedbackInput {
  tutorialId: string;
  tutorialVersion: string;
  stepId: string;
  command?: string;
  currentDirectory?: string;
  usedOfficialSample: boolean;
  errorText: string;
  note?: string;
  diagnosis: ErrorDiagnosis;
}

export function sanitizeText(value: string, maxLength = 6000): string {
  const home = os.homedir();
  return value
    .split(home).join("~")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(token|password|secret|api[_-]?key)(\s*[:=]\s*)\S+/gi, "$1$2[REDACTED]")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[PHONE]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]")
    .split(/\r?\n/)
    .slice(-20)
    .join("\n")
    .slice(0, maxLength);
}

export class FeedbackStore {
  private readonly directory: string;

  constructor(dataDirectory: string) {
    this.directory = path.join(dataDirectory, "feedback");
  }

  async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  async save(input: FeedbackInput): Promise<FeedbackReport> {
    const report: FeedbackReport = {
      ...input.diagnosis,
      summary: sanitizeText(input.diagnosis.summary, 1200),
      errorLine: sanitizeText(input.diagnosis.errorLine, 1000),
      actions: input.diagnosis.actions.map((action) => sanitizeText(action, 1000)),
      suggestedCommands: input.diagnosis.suggestedCommands.map((command) => sanitizeText(command, 1000)),
      reportId: randomUUID(),
      createdAt: new Date().toISOString(),
      tutorialId: input.tutorialId,
      tutorialVersion: input.tutorialVersion,
      stepId: input.stepId,
      command: input.command,
      currentDirectory: input.currentDirectory ? sanitizeText(input.currentDirectory, 1000) : undefined,
      usedOfficialSample: input.usedOfficialSample,
      errorText: sanitizeText(input.errorText),
      note: input.note ? sanitizeText(input.note, 2000) : undefined,
    };
    const reports = await this.list();
    reports.unshift(report);
    await this.write(reports.slice(0, 100));
    return report;
  }

  async list(): Promise<FeedbackReport[]> {
    try {
      const value = JSON.parse(await readFile(path.join(this.directory, "index.json"), "utf8")) as unknown;
      return Array.isArray(value) ? value as FeedbackReport[] : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async write(reports: FeedbackReport[]): Promise<void> {
    const destination = path.join(this.directory, "index.json");
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(reports, null, 2)}\n`, "utf8");
    await rename(temporary, destination);
  }
}
