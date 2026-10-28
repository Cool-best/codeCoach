export type StepStatus =
  | "not_started"
  | "in_progress"
  | "checking"
  | "completed"
  | "blocked"
  | "unknown"
  | "skipped";

export type RuleType = "file_exists" | "file_contains";

export interface CheckRule {
  id?: string;
  type: RuleType;
  path: string;
  pattern?: string;
}

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | CheckRule;

export interface LineGuidance {
  code: string;
  explanation: string;
}

export interface Verification {
  cwd: string;
  command: string[];
  moduleFile?: string;
  expectedOutput: string;
  manual: boolean;
}

export interface FunctionGuidance {
  name: string;
  signature: string;
  purpose: string;
  parameters: Array<{ name: string; type: string; description: string }>;
  returns: string;
  sideEffects: string;
}

export interface StepEdit {
  path: string;
  summary: string;
  instructions: string[];
  functions: FunctionGuidance[];
  requiredPatterns: string[];
}

export interface StepContent {
  markdown: string;
  hints: string[];
  sample?: { language: string; code: string; targetPath?: string };
  lineMode?: LineGuidance[];
  diagram?: { id: string; source: string; highlightMessages: number[] };
}

export interface TutorialStep {
  id: string;
  title: string;
  summary: string;
  prerequisites: string[];
  next: string[];
  acceptance: string[];
  completion?: Condition;
  verification?: Verification;
  edits?: StepEdit[];
  content: StepContent;
}

export interface Tutorial {
  schemaVersion: 1;
  tutorialId: string;
  version: string;
  title: string;
  description: string;
  steps: TutorialStep[];
}

export interface GuideInfo {
  guideId: string;
  tutorial: Tutorial;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  path: string;
}

export interface CheckEvidence {
  ruleId: string;
  status: "passed" | "failed" | "unknown";
  message: string;
  path?: string;
  observedAt: string;
}

export interface CheckReport {
  stepId: string;
  status: "passed" | "failed" | "unknown" | "cancelled";
  evidence: CheckEvidence[];
  startedAt: string;
  finishedAt: string;
}

export interface ErrorDiagnosis {
  signature: string;
  title: string;
  category: "working_directory" | "dependency" | "message_schema" | "assertion" | "environment" | "unknown";
  summary: string;
  errorLine: string;
  actions: string[];
  suggestedCommands: string[];
}

export interface FeedbackReport extends ErrorDiagnosis {
  reportId: string;
  createdAt: string;
  tutorialId: string;
  tutorialVersion: string;
  stepId: string;
  command?: string;
  currentDirectory?: string;
  usedOfficialSample: boolean;
  errorText: string;
  note?: string;
}

export interface SessionSnapshot {
  sessionId: string;
  tutorialId: string;
  tutorialVersion: string;
  workspaceId: string;
  currentStepId: string;
  currentStatus: StepStatus;
  nextStepIds: string[];
  completedStepIds: string[];
  lastReport?: CheckReport;
}

export interface AppSettings {
  opacity: number;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  collapsed: boolean;
  autoAdvance: boolean;
  lastGuideId?: string;
  lastWorkspaceId?: string;
}

export interface Bootstrap {
  settings: AppSettings;
  guide?: GuideInfo;
  workspace?: WorkspaceInfo;
  session?: SessionSnapshot;
  notice?: string;
}

export interface SessionEvent {
  protocolVersion: 1;
  sessionId: string;
  sequence: number;
  type:
    | "step_changed"
    | "check_started"
    | "check_finished"
    | "workspace_disconnected"
    | "error";
  payload: SessionSnapshot | { message: string };
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export interface CoachApi {
  bootstrap(): Promise<ApiResult<Bootstrap>>;
  selectGuide(): Promise<ApiResult<GuideInfo | null>>;
  selectWorkspace(): Promise<ApiResult<WorkspaceInfo | null>>;
  startSession(input: {
    guideId: string;
    workspaceId: string;
  }): Promise<ApiResult<SessionSnapshot>>;
  checkCurrent(input: { sessionId: string }): Promise<ApiResult<CheckReport>>;
  relocate(input: { sessionId: string }): Promise<ApiResult<SessionSnapshot>>;
  navigate(input: {
    sessionId: string;
    action: "previous" | "next" | "skip" | "mark_completed" | "undo";
    reason?: string;
  }): Promise<ApiResult<SessionSnapshot>>;
  diagnoseError(input: {
    sessionId: string;
    errorText: string;
    currentDirectory?: string;
    usedOfficialSample: boolean;
  }): Promise<ApiResult<ErrorDiagnosis>>;
  saveFeedback(input: {
    sessionId: string;
    errorText: string;
    currentDirectory?: string;
    usedOfficialSample: boolean;
    note?: string;
  }): Promise<ApiResult<FeedbackReport>>;
  exportFeedback(): Promise<ApiResult<{ path: string; count: number } | null>>;
  setSettings(input: Partial<AppSettings>): Promise<ApiResult<AppSettings>>;
  resizeWindow(input: { width: number; height: number }): Promise<ApiResult<void>>;
  hideWindow(): Promise<ApiResult<void>>;
  quitApp(): Promise<ApiResult<void>>;
  onSessionEvent(listener: (event: SessionEvent) => void): () => void;
  onSettingsChanged(listener: (settings: AppSettings) => void): () => void;
}
