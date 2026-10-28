import { useEffect, useId, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "dark",
  suppressErrorRendering: true,
  flowchart: { htmlLabels: false },
});

interface Props {
  source: string;
  highlightMessages: number[];
}

export function MermaidDiagram(props: Props) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expanded]);

  return (
    <div className="diagram-view">
      <div className="diagram-toolbar">
        <button title="放大图" aria-label="放大图" onClick={() => setExpanded(true)}><Maximize2 size={14} /> 放大</button>
      </div>
      <MermaidSvg {...props} />
      {expanded && (
        <div className="diagram-modal-backdrop" onClick={(event) => {
          if (event.target === event.currentTarget) setExpanded(false);
        }}>
          <section className="diagram-modal" role="dialog" aria-modal="true" aria-label="放大的步骤图">
            <header><strong>步骤图</strong><button autoFocus title="关闭大图" aria-label="关闭大图" onClick={() => setExpanded(false)}><X size={17} /></button></header>
            <div className="diagram-modal-content"><MermaidSvg {...props} expanded /></div>
          </section>
        </div>
      )}
    </div>
  );
}

function MermaidSvg({ source, highlightMessages, expanded = false }: Props & { expanded?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setError("");
    void mermaid
      .render(`coach-${id}`, source)
      .then(({ svg }) => {
        if (!active || !container.current) return;
        container.current.innerHTML = svg;
        const svgElement = container.current.querySelector("svg");
        svgElement?.setAttribute("role", "img");
        svgElement?.setAttribute("aria-label", "当前步骤图");
        if (expanded && svgElement) {
          const viewBoxWidth = svgElement.viewBox.baseVal.width;
          svgElement.style.maxWidth = "none";
          svgElement.style.width = `${Math.max(800, Math.ceil(viewBoxWidth))}px`;
        }
        for (const message of highlightMessages) {
          const line = container.current.querySelector(`.messageLine${message - 1}`);
          if (line instanceof SVGElement) {
            line.style.stroke = "#7c9cff";
            line.style.strokeWidth = "3px";
          }
          const text = container.current.querySelectorAll(".messageText")[message - 1];
          if (text instanceof SVGElement) text.style.fill = "#b7c8ff";
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [source, highlightMessages, id, expanded]);

  if (error) return <div className="diagram-error">图无法渲染：{error}</div>;
  return <div className={`mermaid ${expanded ? "mermaid-expanded" : ""}`} ref={container} />;
}
