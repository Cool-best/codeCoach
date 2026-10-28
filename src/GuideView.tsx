import { useEffect, useMemo, useState } from "react";
import hljs from "highlight.js/lib/common";
import {
  BookOpen,
  Bug,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Code2,
  Compass,
  ListOrdered,
  LoaderCircle,
  MapPin,
  MoreHorizontal,
  RotateCcw,
  SkipForward,
  Workflow,
  XCircle,
} from "lucide-react";
import type { CheckReport, SessionSnapshot, TutorialStep } from "../shared/types";
import { MermaidDiagram } from "./MermaidDiagram";
import { VerificationCard } from "./VerificationCard";

interface Props {
  steps: TutorialStep[];
  session: SessionSnapshot;
  workspacePath: string;
  busy: boolean;
  onCheck: () => void;
  onRelocate: () => void;
  onFeedback: () => void;
  onNavigate: (action: "previous" | "next" | "skip" | "mark_completed" | "undo", reason?: string) => void;
}

type Tab = "overview" | "lines" | "sample" | "diagram";

const statusLabels: Record<string, string> = {
  not_started: "未开始",
  in_progress: "进行中",
  checking: "检查中",
  completed: "已完成",
  blocked: "已受阻",
  unknown: "待确认",
  skipped: "已跳过",
};

export function GuideView({ steps, session, workspacePath, busy, onCheck, onRelocate, onFeedback, onNavigate }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [lineIndex, setLineIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reasonAction, setReasonAction] = useState<"skip" | "mark_completed" | null>(null);
  const [reason, setReason] = useState("");
  const [copied, setCopied] = useState(false);
  const stepIndex = Math.max(0, steps.findIndex((item) => item.id === session.currentStepId));
  const step = steps[stepIndex]!;
  const nextStep = steps.find((item) => item.id === session.nextStepIds[0]);
  const lines = step.content.lineMode ?? [];
  const currentLine = lines[Math.min(lineIndex, Math.max(0, lines.length - 1))];
  const highlightedSample = useMemo(() => highlight(step.content.sample?.code ?? "", step.content.sample?.language), [step]);

  useEffect(() => {
    setTab("overview");
    setLineIndex(0);
    setMenuOpen(false);
  }, [step.id]);

  const runReasonAction = (): void => {
    if (!reasonAction || !reason.trim()) return;
    onNavigate(reasonAction, reason.trim());
    setReasonAction(null);
    setReason("");
  };

  return (
    <>
      <section className="progress-section">
        <div className="progress-copy">
          <span>学习进度</span>
          <span>{session.completedStepIds.length} / {steps.length}</span>
        </div>
        <div className="progress-track">
          <div style={{ width: `${(session.completedStepIds.length / steps.length) * 100}%` }} />
        </div>
      </section>

      <main className="guide-content">
        <div className="step-heading">
          <div className="eyebrow">
            第 {stepIndex + 1} 步
            <span className={`status status-${session.currentStatus}`}>{statusLabels[session.currentStatus]}</span>
          </div>
          <h1>{step.title}</h1>
          {step.summary && <p>{step.summary}</p>}
        </div>

        <div className="acceptance">
          <span className="acceptance-label"><Compass size={14} /> 做到这样就算完成</span>
          {step.acceptance.length > 0 ? (
            <ul>{step.acceptance.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : <p>按照下方说明操作，然后由你确认结果。</p>}
        </div>

        {step.verification && <VerificationCard verification={step.verification} workspacePath={workspacePath} onFeedback={onFeedback} />}

        <div className="tabs" role="tablist">
          <TabButton active={tab === "overview"} onClick={() => setTab("overview")} icon={<BookOpen size={14} />} label="指导" />
          {lines.length > 0 && <TabButton active={tab === "lines"} onClick={() => setTab("lines")} icon={<ListOrdered size={14} />} label="逐行" />}
          {step.content.sample && <TabButton active={tab === "sample"} onClick={() => setTab("sample")} icon={<Code2 size={14} />} label="样板" />}
          {step.content.diagram && <TabButton active={tab === "diagram"} onClick={() => setTab("diagram")} icon={<Workflow size={14} />} label={/^(?:flowchart|graph)\b/.test(step.content.diagram.source.trimStart()) ? "流程" : "时序"} />}
        </div>

        <div className="tab-panel">
          {tab === "overview" && (
            <div className="overview">
              <div className="markdown" dangerouslySetInnerHTML={{ __html: step.content.markdown }} />
              {step.edits?.map((edit) => (
                <section className="edit-guide" key={edit.path}>
                  <h3>修改 <code>{edit.path}</code></h3>
                  <p>{edit.summary}</p>
                  <ol>{edit.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol>
                  {edit.functions.map((fn) => (
                    <article className="function-contract" key={fn.name}>
                      <h4>{fn.name}</h4>
                      <code className="function-signature">{fn.signature}</code>
                      <p>{fn.purpose}</p>
                      <ul>{fn.parameters.map((parameter) => <li key={parameter.name}><code>{parameter.name}: {parameter.type}</code> — {parameter.description}</li>)}</ul>
                      <p><strong>返回：</strong>{fn.returns}</p>
                      <p><strong>副作用：</strong>{fn.sideEffects}</p>
                    </article>
                  ))}
                </section>
              ))}
              {step.content.hints.map((hint, index) => (
                <details className="hint" key={hint}>
                  <summary>需要一点提示？{step.content.hints.length > 1 ? ` ${index + 1}` : ""}</summary>
                  <p>{hint}</p>
                </details>
              ))}
            </div>
          )}

          {tab === "lines" && currentLine && (
            <div className="line-guide">
              <div className="line-count">第 {lineIndex + 1} 行，共 {lines.length} 行</div>
              <pre className="active-line"><code>{currentLine.code || " "}</code></pre>
              <p>{currentLine.explanation}</p>
              <div className="line-actions">
                <button className="button subtle" disabled={lineIndex === 0} onClick={() => setLineIndex((value) => value - 1)}><ChevronLeft size={15} /> 上一行</button>
                <button className="button subtle" disabled={lineIndex >= lines.length - 1} onClick={() => setLineIndex((value) => value + 1)}>下一行 <ChevronRight size={15} /></button>
              </div>
            </div>
          )}

          {tab === "sample" && step.content.sample && (
            <div className="sample">
              <div className="code-toolbar">
                <span>{step.content.sample.targetPath ?? "最小代码样板"}</span>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(step.content.sample!.code).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? <Check size={14} /> : <Clipboard size={14} />}{copied ? "已复制" : "复制"}
                </button>
              </div>
              <pre><code dangerouslySetInnerHTML={{ __html: highlightedSample }} /></pre>
              <p className="code-note">先理解再复制。应用不会自动改写你的代码。</p>
            </div>
          )}

          {tab === "diagram" && step.content.diagram && (
            <MermaidDiagram source={step.content.diagram.source} highlightMessages={step.content.diagram.highlightMessages} />
          )}
        </div>

        {session.lastReport && <Evidence report={session.lastReport} />}

        {session.currentStatus === "completed" && nextStep && (
          <div className="next-preview">
            <span>下一步</span>
            <strong>{nextStep.title}</strong>
            <p>{nextStep.summary}</p>
          </div>
        )}
        {session.currentStatus === "completed" && !nextStep && (
          <div className="finish-card"><CheckCircle2 size={22} /><div><strong>教程已完成</strong><p>你已经走完这条学习路径，可以回顾任一步骤。</p></div></div>
        )}
      </main>

      <footer className="action-footer">
        <button className="icon-button bordered" title="上一步" disabled={stepIndex === 0 || busy} onClick={() => onNavigate("previous")}><ChevronLeft size={18} /></button>
        {session.currentStatus === "completed" && nextStep ? (
          <button className="button primary grow" onClick={() => onNavigate("next")}>进入下一步 <ChevronRight size={16} /></button>
        ) : (
          <button className="button primary grow" disabled={busy || session.currentStatus === "checking"} onClick={onCheck}>
            {busy || session.currentStatus === "checking" ? <LoaderCircle className="spin" size={16} /> : <MapPin size={16} />}
            {session.currentStatus === "unknown" ? "重新检查" : "检查当前步骤"}
          </button>
        )}
        <div className="menu-anchor">
          <button className="icon-button bordered" title="更多操作" onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal size={18} /></button>
          {menuOpen && (
            <div className="context-menu">
              <button onClick={() => { onFeedback(); setMenuOpen(false); }}><Bug size={14} /> 报错定位与反馈</button>
              <button onClick={() => { onRelocate(); setMenuOpen(false); }}><RotateCcw size={14} /> 重新定位进度</button>
              <button onClick={() => { setReasonAction("mark_completed"); setMenuOpen(false); }}><CheckCircle2 size={14} /> 人工标记完成</button>
              {session.currentStatus === "completed" && <button onClick={() => { onNavigate("undo"); setMenuOpen(false); }}><RotateCcw size={14} /> 重做当前步骤</button>}
              <button className="danger-text" onClick={() => { setReasonAction("skip"); setMenuOpen(false); }}><SkipForward size={14} /> 跳过当前步骤</button>
            </div>
          )}
        </div>
      </footer>

      {reasonAction && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{reasonAction === "skip" ? "跳过当前步骤" : "人工标记完成"}</h2>
            <p>此操作会记录在本地进度中。请留下原因，方便以后回顾。</p>
            <textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：已用其他方式实现，并验证可以运行" />
            <div className="modal-actions">
              <button className="button subtle" onClick={() => { setReasonAction(null); setReason(""); }}>取消</button>
              <button className="button primary" disabled={!reason.trim()} onClick={runReasonAction}>确认</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button role="tab" aria-selected={active} className={active ? "active" : ""} onClick={onClick}>{icon}{label}</button>;
}

function Evidence({ report }: { report: CheckReport }) {
  return (
    <details className={`evidence evidence-${report.status}`} open={report.status !== "passed"}>
      <summary>
        {report.status === "passed" ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
        {report.status === "passed" ? "检查通过 · 查看证据" : report.status === "unknown" ? "暂时无法自动判断" : "还没有达到完成条件"}
      </summary>
      <ul>
        {report.evidence.map((item, index) => (
          <li key={`${item.ruleId}-${index}`} className={item.status}>
            {item.status === "passed" ? <Check size={13} /> : <XCircle size={13} />}
            <span>{item.message}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function highlight(code: string, language?: string): string {
  if (language && hljs.getLanguage(language)) return hljs.highlight(code, { language }).value;
  return hljs.highlightAuto(code).value;
}
