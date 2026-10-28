import { useState } from "react";
import { AlertCircle, Check, Clipboard, LoaderCircle, Save, ShieldCheck, X } from "lucide-react";
import type { ErrorDiagnosis, FeedbackReport } from "../shared/types";
import { unwrap } from "./api";

export function FeedbackPanel({ sessionId, workspacePath, onClose }: {
  sessionId: string;
  workspacePath: string;
  onClose: () => void;
}) {
  const [errorText, setErrorText] = useState("");
  const [currentDirectory, setCurrentDirectory] = useState(workspacePath);
  const [usedOfficialSample, setUsedOfficialSample] = useState(true);
  const [note, setNote] = useState("");
  const [diagnosis, setDiagnosis] = useState<ErrorDiagnosis>();
  const [report, setReport] = useState<FeedbackReport>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const analyze = async (): Promise<void> => {
    if (!errorText.trim()) return;
    setBusy(true);
    setError("");
    setReport(undefined);
    try {
      setDiagnosis(await unwrap(window.coach.diagnoseError({
        sessionId,
        errorText,
        currentDirectory,
        usedOfficialSample,
      })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      setReport(await unwrap(window.coach.saveFeedback({
        sessionId,
        errorText,
        currentDirectory,
        usedOfficialSample,
        note,
      })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const copyReport = (): void => {
    if (!report) return;
    void navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="modal-backdrop feedback-backdrop">
      <section className="feedback-panel">
        <header><div><AlertCircle size={17} /><strong>报错定位与反馈</strong></div><button onClick={onClose}><X size={17} /></button></header>
        <div className="feedback-scroll">
          <p className="feedback-intro">粘贴完整 traceback。分析在本地进行，保存前不会记录错误内容。</p>
          <label className="field-label">错误内容</label>
          <textarea className="error-input" value={errorText} onChange={(event) => { setErrorText(event.target.value); setDiagnosis(undefined); setReport(undefined); }} placeholder="Traceback (most recent call last): ..." />
          <label className="field-label">报错时所在目录</label>
          <input className="text-input" value={currentDirectory} onChange={(event) => setCurrentDirectory(event.target.value)} />
          <label className="check-row"><input type="checkbox" checked={usedOfficialSample} onChange={(event) => setUsedOfficialSample(event.target.checked)} /> 我使用了本步骤官方样板</label>
          <button className="button primary full" disabled={!errorText.trim() || busy} onClick={() => void analyze()}>{busy && !diagnosis ? <LoaderCircle className="spin" size={15} /> : <AlertCircle size={15} />}分析最后一行错误</button>
          {error && <div className="feedback-error">{error}</div>}

          {diagnosis && (
            <div className="diagnosis-card">
              <span className={`diagnosis-category category-${diagnosis.category}`}>{diagnosis.category}</span>
              <h3>{diagnosis.title}</h3>
              <code className="error-line">{diagnosis.errorLine}</code>
              <p>{diagnosis.summary}</p>
              <ol>{diagnosis.actions.map((action) => <li key={action}>{action}</li>)}</ol>
              {diagnosis.suggestedCommands.length > 0 && <pre>{diagnosis.suggestedCommands.join("\n")}</pre>}
            </div>
          )}

          {diagnosis && !report && (
            <div className="save-feedback">
              <label className="field-label">补充说明（可选）</label>
              <textarea className="note-input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="最近改了什么？官方样板是否也失败？" />
              <div className="privacy-note"><ShieldCheck size={14} /><span>仅保存最近 20 行，手机号、邮箱、令牌和本机用户目录会脱敏。最多本地保留 100 条，不会自动上传。</span></div>
              <button className="button primary full" disabled={busy} onClick={() => void save()}><Save size={15} /> 保存脱敏反馈</button>
            </div>
          )}

          {report && (
            <div className="feedback-saved">
              <Check size={18} /><strong>反馈已保存到本机</strong><span>{report.reportId}</span>
              <button className="button subtle full" onClick={copyReport}>{copied ? <Check size={14} /> : <Clipboard size={14} />}{copied ? "已复制报告" : "复制反馈报告"}</button>
              <p>可在设置中导出全部反馈，再发给教程作者。</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
