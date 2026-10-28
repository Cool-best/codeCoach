import { useCallback, useEffect, useState } from "react";
import {
  Braces,
  Check,
  ChevronRight,
  Download,
  FileText,
  FolderOpen,
  Keyboard,
  LoaderCircle,
  Minus,
  MousePointer2,
  Pin,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type {
  AppSettings,
  GuideInfo,
  SessionEvent,
  SessionSnapshot,
  WorkspaceInfo,
} from "../shared/types";
import { unwrap } from "./api";
import { GuideView } from "./GuideView";
import { FeedbackPanel } from "./FeedbackPanel";

const defaultSettings: AppSettings = {
  opacity: 0.94,
  alwaysOnTop: true,
  clickThrough: false,
  collapsed: false,
  autoAdvance: false,
};

export default function App() {
  const [settings, setSettings] = useState(defaultSettings);
  const [guide, setGuide] = useState<GuideInfo>();
  const [workspace, setWorkspace] = useState<WorkspaceInfo>();
  const [session, setSession] = useState<SessionSnapshot>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    void unwrap(window.coach.bootstrap())
      .then((result) => {
        setSettings(result.settings);
        setGuide(result.guide);
        setWorkspace(result.workspace);
        setSession(result.session);
        setNotice(result.notice ?? "");
      })
      .catch((reason: unknown) => setError(messageOf(reason)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const offSession = window.coach.onSessionEvent((event: SessionEvent) => {
      if ("sessionId" in event.payload) setSession(event.payload);
      else setNotice(event.payload.message);
    });
    const offSettings = window.coach.onSettingsChanged(setSettings);
    return () => {
      offSession();
      offSettings();
    };
  }, []);

  const perform = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  const selectGuide = (): void => {
    void perform(async () => {
      const selected = await unwrap(window.coach.selectGuide());
      if (selected) {
        setGuide(selected);
        setSession(undefined);
      }
    });
  };

  const selectWorkspace = (): void => {
    void perform(async () => {
      const selected = await unwrap(window.coach.selectWorkspace());
      if (selected) {
        setWorkspace(selected);
        setSession(undefined);
      }
    });
  };

  const start = (): void => {
    if (!guide || !workspace) return;
    void perform(async () => {
      setSession(await unwrap(window.coach.startSession({ guideId: guide.guideId, workspaceId: workspace.id })));
      setSettingsOpen(false);
    });
  };

  const updateSettings = (patch: Partial<AppSettings>): void => {
    void unwrap(window.coach.setSettings(patch)).then(setSettings).catch((reason: unknown) => setError(messageOf(reason)));
  };

  const navigate = (action: "previous" | "next" | "skip" | "mark_completed" | "undo", reason?: string): void => {
    if (!session) return;
    void perform(async () => {
      setSession(await unwrap(window.coach.navigate({ sessionId: session.sessionId, action, reason })));
    });
  };

  return (
    <div className={`app-shell ${settings.collapsed ? "is-collapsed" : ""}`}>
      <header className="titlebar">
        <div className="brand"><span className="brand-mark"><Braces size={16} /></span><strong>CodeCoach</strong></div>
        <div className="window-actions">
          {guide && workspace && <button title="设置" onClick={() => setSettingsOpen((value) => !value)}><Settings size={15} /></button>}
          {session && <button title={settings.collapsed ? "展开" : "收起"} onClick={() => updateSettings({ collapsed: !settings.collapsed })}><Minus size={16} /></button>}
          <button title="隐藏 · Ctrl+Alt+Space" onClick={() => void window.coach.hideWindow()}><X size={16} /></button>
        </div>
      </header>

      {!settings.collapsed && (
        <div className="app-body">
          {error && <div className="toast error" role="alert"><span>{error}</span><button onClick={() => setError("")}><X size={14} /></button></div>}
          {notice && <div className="toast notice"><span>{notice}</span><button onClick={() => setNotice("")}><X size={14} /></button></div>}

          {loading ? (
            <div className="center-state"><LoaderCircle className="spin" size={28} /><p>正在恢复指导进度…</p></div>
          ) : session && guide && workspace ? (
            <GuideView
              steps={guide.tutorial.steps}
              session={session}
              workspacePath={workspace.path}
              busy={busy}
              onCheck={() => void perform(async () => { await unwrap(window.coach.checkCurrent({ sessionId: session.sessionId })); })}
              onRelocate={() => void perform(async () => { setSession(await unwrap(window.coach.relocate({ sessionId: session.sessionId }))); })}
              onFeedback={() => setFeedbackOpen(true)}
              onNavigate={navigate}
            />
          ) : (
            <Welcome
              guide={guide}
              workspace={workspace}
              busy={busy}
              onGuide={selectGuide}
              onWorkspace={selectWorkspace}
              onStart={start}
            />
          )}

          {settingsOpen && guide && workspace && (
            <SettingsPanel
              settings={settings}
              guide={guide}
              workspace={workspace}
              onChange={updateSettings}
              onGuide={selectGuide}
              onWorkspace={selectWorkspace}
              onRestart={start}
              onExportFeedback={() => void perform(async () => {
                const result = await unwrap(window.coach.exportFeedback());
                if (result) setNotice(`已导出 ${result.count} 条脱敏反馈：${result.path}`);
              })}
              onClose={() => setSettingsOpen(false)}
              onQuit={() => void window.coach.quitApp()}
            />
          )}
          {feedbackOpen && session && workspace && <FeedbackPanel sessionId={session.sessionId} workspacePath={workspace.path} onClose={() => setFeedbackOpen(false)} />}
        </div>
      )}
    </div>
  );
}

function Welcome({ guide, workspace, busy, onGuide, onWorkspace, onStart }: {
  guide?: GuideInfo;
  workspace?: WorkspaceInfo;
  busy: boolean;
  onGuide: () => void;
  onWorkspace: () => void;
  onStart: () => void;
}) {
  return (
    <main className="welcome">
      <div className="welcome-hero">
        <span className="hero-icon"><Braces size={27} /></span>
        <div className="hero-kicker">LOCAL · EVIDENCE DRIVEN</div>
        <h1>把教程放在手边，<br />把代码写进项目。</h1>
        <p>一步步真实编码。你的文件有进展，指导才向前走。</p>
      </div>
      <div className="setup-list">
        <button className={guide ? "setup-item selected" : "setup-item"} onClick={onGuide} disabled={busy}>
          <span className="setup-icon">{guide ? <Check size={18} /> : <FileText size={18} />}</span>
          <span><small>第一步</small><strong>{guide?.tutorial.title ?? "选择 Markdown 教程"}</strong>{guide && <em>{guide.tutorial.steps.length} 个步骤 · v{guide.tutorial.version}</em>}</span>
          <ChevronRight size={17} />
        </button>
        <button className={workspace ? "setup-item selected" : "setup-item"} onClick={onWorkspace} disabled={busy}>
          <span className="setup-icon">{workspace ? <Check size={18} /> : <FolderOpen size={18} />}</span>
          <span><small>第二步</small><strong>{workspace?.name ?? "选择练习项目目录"}</strong>{workspace && <em>{workspace.path}</em>}</span>
          <ChevronRight size={17} />
        </button>
      </div>
      <button className="button primary start-button" disabled={!guide || !workspace || busy} onClick={onStart}>
        {busy ? <LoaderCircle className="spin" size={17} /> : <Braces size={17} />}开始指导<ChevronRight size={17} />
      </button>
      <div className="privacy-note"><ShieldCheck size={15} /><span>本地运行，不上传源码。不会自动修改文件或执行命令。</span></div>
      <div className="shortcut-note"><Keyboard size={14} /> Ctrl + Alt + Space 随时显示 / 隐藏</div>
    </main>
  );
}

function SettingsPanel({ settings, guide, workspace, onChange, onGuide, onWorkspace, onRestart, onExportFeedback, onClose, onQuit }: {
  settings: AppSettings;
  guide: GuideInfo;
  workspace: WorkspaceInfo;
  onChange: (patch: Partial<AppSettings>) => void;
  onGuide: () => void;
  onWorkspace: () => void;
  onRestart: () => void;
  onExportFeedback: () => void;
  onClose: () => void;
  onQuit: () => void;
}) {
  return (
    <div className="settings-panel">
      <div className="settings-title"><span><SlidersHorizontal size={17} /> 浮窗与指导设置</span><button onClick={onClose}><X size={16} /></button></div>
      <div className="settings-scroll">
        <label className="range-setting"><span><strong>窗口透明度</strong><em>{Math.round(settings.opacity * 100)}%</em></span><input type="range" min="0.45" max="1" step="0.01" value={settings.opacity} onChange={(event) => onChange({ opacity: Number(event.target.value) })} /></label>
        <SettingToggle icon={<Pin size={15} />} label="置顶于其他窗口" checked={settings.alwaysOnTop} onChange={(checked) => onChange({ alwaysOnTop: checked })} />
        <SettingToggle icon={<MousePointer2 size={15} />} label="鼠标穿透" description="开启后按 Ctrl+Alt+P 恢复交互" checked={settings.clickThrough} onChange={(checked) => onChange({ clickThrough: checked })} />
        <SettingToggle icon={<ChevronRight size={15} />} label="检查通过后自动进入下一步" checked={settings.autoAdvance} onChange={(checked) => onChange({ autoAdvance: checked })} />
        <div className="settings-section">
          <h3>当前学习上下文</h3>
          <button className="settings-resource" onClick={onGuide}><FileText size={15} /><span>{guide.tutorial.title}</span><ChevronRight size={14} /></button>
          <button className="settings-resource" onClick={onWorkspace}><FolderOpen size={15} /><span>{workspace.path}</span><ChevronRight size={14} /></button>
          <button className="button subtle full" onClick={onRestart}>按所选教程和目录重新开始</button>
        </div>
        <div className="settings-section">
          <h3>错误反馈</h3>
          <button className="button subtle full" onClick={onExportFeedback}><Download size={14} /> 导出本地脱敏反馈</button>
        </div>
        <div className="settings-section about">
          <h3>安全边界</h3>
          <p><ShieldCheck size={14} /> 代码和进度仅保存在本机。当前版本不会执行教程命令。</p>
          <p><Keyboard size={14} /> Ctrl+Alt+Space 显示/隐藏，Ctrl+Alt+P 切换鼠标穿透。</p>
        </div>
        <button className="quit-button" onClick={onQuit}>退出 CodeCoach</button>
      </div>
    </div>
  );
}

function SettingToggle({ icon, label, description, checked, onChange }: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-setting">
      <span className="toggle-copy">{icon}<span>{label}{description && <small>{description}</small>}</span></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch" />
    </label>
  );
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
