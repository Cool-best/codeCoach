import { useEffect, useId, useRef, useState } from "react";
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

export function MermaidDiagram({ source, highlightMessages }: Props) {
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
        svgElement?.setAttribute("aria-label", "当前步骤时序图");
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
  }, [source, highlightMessages, id]);

  if (error) return <div className="diagram-error">时序图无法渲染：{error}</div>;
  return <div className="mermaid" ref={container} />;
}
