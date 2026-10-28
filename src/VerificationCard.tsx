import { useState } from "react";
import { AlertCircle, Check, Clipboard, TerminalSquare } from "lucide-react";
import type { Verification } from "../shared/types";

export function VerificationCard({ verification, workspacePath, onFeedback }: {
  verification: Verification;
  workspacePath: string;
  onFeedback: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const commands = [`Set-Location "${workspacePath}"`, verification.command.join(" ")];
  const copy = (): void => {
    void navigator.clipboard.writeText(commands.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <section className="verification-card">
      <div className="verification-title"><TerminalSquare size={15} /><strong>手动运行验收</strong><span>文件检查 ≠ 运行通过</span></div>
      <label>在此工作区执行</label>
      <div className="workspace-path">{workspacePath}</div>
      <pre>{commands.join("\n")}</pre>
      <div className="verification-expected">通过标志：<code>{verification.expectedOutput}</code></div>
      <div className="verification-actions">
        <button className="button subtle" onClick={copy}>{copied ? <Check size={14} /> : <Clipboard size={14} />}{copied ? "已复制" : "复制目录与命令"}</button>
        <button className="feedback-link" onClick={onFeedback}><AlertCircle size={14} /> 运行后报错？</button>
      </div>
    </section>
  );
}
