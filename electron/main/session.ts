import { randomUUID } from "node:crypto";
import type {
  CheckReport,
  GuideInfo,
  SessionEvent,
  SessionSnapshot,
  StepStatus,
  WorkspaceInfo,
} from "../../shared/types";
import { LocalStore, type ProgressRecord } from "./store";
import { WorkspaceMonitor } from "./workspace";

interface ActiveSession {
  id: string;
  guide: GuideInfo;
  workspace: WorkspaceInfo;
  monitor: WorkspaceMonitor;
  progress: ProgressRecord;
  sequence: number;
  checking: boolean;
  lastReport?: CheckReport;
  debounce?: NodeJS.Timeout;
}

export class CoachService {
  private active?: ActiveSession;

  constructor(
    private readonly store: LocalStore,
    private readonly emit: (event: SessionEvent) => void,
  ) {}

  async start(guide: GuideInfo, workspace: WorkspaceInfo): Promise<SessionSnapshot> {
    await this.close();
    const saved = await this.store.getProgress(guide.tutorial, workspace.id);
    const monitor = new WorkspaceMonitor(workspace);
    await monitor.start(
      () => this.onWorkspaceChange(),
      (message) => this.send("workspace_disconnected", { message }),
    );
    const firstStep = guide.tutorial.steps[0]!;
    const statuses: Record<string, StepStatus> = Object.fromEntries(
      guide.tutorial.steps.map((step) => [step.id, "not_started"]),
    );
    const progress: ProgressRecord = saved ?? {
      schemaVersion: 1,
      tutorialId: guide.tutorial.tutorialId,
      tutorialVersion: guide.tutorial.version,
      workspaceId: workspace.id,
      currentStepId: firstStep.id,
      statuses,
      updatedAt: new Date().toISOString(),
    };
    for (const step of guide.tutorial.steps) {
      progress.statuses[step.id] ??= "not_started";
      if (progress.statuses[step.id] === "checking") progress.statuses[step.id] = "in_progress";
    }
    if (!saved) progress.statuses[progress.currentStepId] = "in_progress";

    this.active = {
      id: randomUUID(),
      guide,
      workspace,
      monitor,
      progress,
      sequence: 0,
      checking: false,
    };
    await this.store.saveProgress(progress);
    if (!saved) return this.relocate(this.active.id);
    return this.snapshot();
  }

  async checkCurrent(sessionId: string): Promise<CheckReport> {
    const active = this.require(sessionId);
    if (active.checking) throw new Error("当前步骤正在检查，请稍候");
    const step = this.currentStep(active);
    active.checking = true;
    active.progress.statuses[step.id] = "checking";
    this.send("check_started", this.snapshot());
    try {
      const report = await active.monitor.checkStep(step);
      active.lastReport = report;
      active.progress.statuses[step.id] =
        report.status === "passed" ? "completed" : report.status === "unknown" ? "unknown" : "in_progress";
      const settings = await this.store.getSettings();
      if (report.status === "passed" && settings.autoAdvance && step.next.length > 0) {
        this.enterStep(step.next[0]!);
      }
      await this.store.saveProgress(active.progress);
      this.send("check_finished", this.snapshot());
      return report;
    } finally {
      active.checking = false;
    }
  }

  async relocate(sessionId: string): Promise<SessionSnapshot> {
    const active = this.require(sessionId);
    if (active.checking) throw new Error("正在检查，请稍后重新定位");
    active.checking = true;
    try {
      let currentStepId = active.guide.tutorial.steps.at(-1)!.id;
      let firstUnresolved = true;
      for (const step of active.guide.tutorial.steps) {
        const report = await active.monitor.checkStep(step);
        if (report.status === "passed") {
          active.progress.statuses[step.id] = "completed";
          if (firstUnresolved) currentStepId = step.id;
        } else {
          active.progress.statuses[step.id] = report.status === "unknown" ? "unknown" : "not_started";
          if (firstUnresolved) {
            currentStepId = step.id;
            active.progress.currentStepId = step.id;
            active.progress.statuses[step.id] = report.status === "unknown" ? "unknown" : "in_progress";
            active.lastReport = report;
            firstUnresolved = false;
          }
        }
      }
      if (firstUnresolved) active.progress.currentStepId = currentStepId;
      await this.store.saveProgress(active.progress);
      this.send("step_changed", this.snapshot());
      return this.snapshot();
    } finally {
      active.checking = false;
    }
  }

  async navigate(
    sessionId: string,
    action: "previous" | "next" | "skip" | "mark_completed" | "undo",
    reason?: string,
  ): Promise<SessionSnapshot> {
    const active = this.require(sessionId);
    const step = this.currentStep(active);
    const steps = active.guide.tutorial.steps;
    const index = steps.findIndex((item) => item.id === step.id);

    if (action === "skip" || action === "mark_completed") {
      if (!reason?.trim()) throw new Error(action === "skip" ? "跳过步骤需要填写原因" : "人工完成需要填写原因");
      active.progress.statuses[step.id] = action === "skip" ? "skipped" : "completed";
      if (step.next[0]) this.enterStep(step.next[0]);
    } else if (action === "previous") {
      if (index > 0) this.enterStep(steps[index - 1]!.id, true);
    } else if (action === "next") {
      const status = active.progress.statuses[step.id];
      if (status !== "completed" && status !== "skipped") {
        throw new Error("当前步骤尚未完成；如需继续，请使用“跳过”并填写原因");
      }
      if (step.next[0]) this.enterStep(step.next[0]);
    } else {
      active.progress.statuses[step.id] = "in_progress";
      active.lastReport = undefined;
    }

    await this.store.saveProgress(active.progress);
    this.send("step_changed", this.snapshot());
    return this.snapshot();
  }

  context(sessionId: string) {
    const active = this.require(sessionId);
    return {
      guide: active.guide,
      workspace: active.workspace,
      step: this.currentStep(active),
    };
  }

  snapshot(): SessionSnapshot {
    const active = this.active;
    if (!active) throw new Error("指导会话尚未开始");
    const step = this.currentStep(active);
    return {
      sessionId: active.id,
      tutorialId: active.guide.tutorial.tutorialId,
      tutorialVersion: active.guide.tutorial.version,
      workspaceId: active.workspace.id,
      currentStepId: step.id,
      currentStatus: active.progress.statuses[step.id] ?? "not_started",
      nextStepIds: step.next,
      completedStepIds: Object.entries(active.progress.statuses)
        .filter(([, status]) => status === "completed")
        .map(([stepId]) => stepId),
      lastReport: active.lastReport,
    };
  }

  async close(): Promise<void> {
    if (!this.active) return;
    clearTimeout(this.active.debounce);
    await this.active.monitor.close();
    this.active = undefined;
  }

  private onWorkspaceChange(): void {
    const active = this.active;
    if (!active) return;
    clearTimeout(active.debounce);
    active.debounce = setTimeout(() => {
      const current = this.active;
      if (!current || current.checking) return;
      const status = current.progress.statuses[current.progress.currentStepId];
      if (status !== "in_progress" && status !== "unknown") return;
      void this.checkCurrent(current.id).catch((error: unknown) => {
        this.send("error", { message: error instanceof Error ? error.message : String(error) });
      });
    }, 450);
  }

  private enterStep(stepId: string, preserveStatus = false): void {
    const active = this.active!;
    active.progress.currentStepId = stepId;
    if (!preserveStatus || active.progress.statuses[stepId] === "not_started") {
      active.progress.statuses[stepId] = "in_progress";
    }
    active.lastReport = undefined;
  }

  private currentStep(active: ActiveSession) {
    const step = active.guide.tutorial.steps.find((item) => item.id === active.progress.currentStepId);
    if (!step) throw new Error("当前步骤不在教程中，请重新定位");
    return step;
  }

  private require(sessionId: string): ActiveSession {
    if (!this.active || this.active.id !== sessionId) throw new Error("指导会话已失效，请重新开始");
    return this.active;
  }

  private send(type: SessionEvent["type"], payload: SessionEvent["payload"]): void {
    const active = this.active;
    if (!active) return;
    this.emit({ protocolVersion: 1, sessionId: active.id, sequence: ++active.sequence, type, payload });
  }
}
