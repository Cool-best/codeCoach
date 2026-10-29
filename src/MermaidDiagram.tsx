import { useEffect, useId, useRef, useState } from "react";
import { Maximize2, Minus, Plus, RotateCcw, X } from "lucide-react";
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
  const [scale, setScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | undefined>(undefined);

  const close = (): void => {
    dragState.current = undefined;
    setDragging(false);
    setExpanded(false);
  };

  useEffect(() => {
    if (!expanded) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expanded]);

  const adjustScale = (amount: number): void => {
    setScale((value) => Math.min(3, Math.max(0.5, value + amount)));
  };

  const resetView = (): void => {
    setScale(1);
    const viewport = document.querySelector<HTMLDivElement>(".diagram-modal-content");
    viewport?.scrollTo({ left: 0, top: 0 });
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: event.currentTarget.scrollLeft,
      top: event.currentTarget.scrollTop,
    };
    setDragging(true);
  };

  const drag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const start = dragState.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.currentTarget.scrollLeft = start.left - (event.clientX - start.x);
    event.currentTarget.scrollTop = start.top - (event.clientY - start.y);
  };

  const stopDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    dragState.current = undefined;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="diagram-view">
      <div className="diagram-toolbar">
        <button title="放大图" aria-label="放大图" onClick={() => { setScale(1); setExpanded(true); }}><Maximize2 size={14} /> 放大</button>
      </div>
      <MermaidSvg {...props} />
      {expanded && (
        <div className="diagram-modal-backdrop" onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}>
          <section className="diagram-modal" role="dialog" aria-modal="true" aria-label="放大的步骤图">
            <header>
              <strong>步骤图</strong>
              <div className="diagram-zoom-controls">
                <button title="缩小" aria-label="缩小" disabled={scale <= 0.5} onClick={() => adjustScale(-0.25)}><Minus size={14} /></button>
                <span aria-live="polite">{Math.round(scale * 100)}%</span>
                <button title="放大比例" aria-label="放大比例" disabled={scale >= 3} onClick={() => adjustScale(0.25)}><Plus size={14} /></button>
                <button title="重置为 100%" aria-label="重置为 100%" onClick={resetView}><RotateCcw size={14} /></button>
              </div>
              <button autoFocus title="关闭大图" aria-label="关闭大图" onClick={close}><X size={17} /></button>
            </header>
            <div
              className={`diagram-modal-content ${dragging ? "is-dragging" : ""}`}
              onPointerDown={startDrag}
              onPointerMove={drag}
              onPointerUp={stopDrag}
              onPointerCancel={stopDrag}
            >
              <MermaidSvg {...props} expanded scale={scale} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function MermaidSvg({ source, highlightMessages, expanded = false, scale = 1 }: Props & { expanded?: boolean; scale?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "");
  const [error, setError] = useState("");
  const [baseWidth, setBaseWidth] = useState(800);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

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
          const width = Math.max(800, Math.ceil(svgElement.viewBox.baseVal.width));
          svgElement.style.maxWidth = "none";
          svgElement.style.width = `${Math.round(width * scaleRef.current)}px`;
          setBaseWidth(width);
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

  useEffect(() => {
    if (!expanded) return;
    const svgElement = container.current?.querySelector("svg");
    if (svgElement) svgElement.style.width = `${Math.round(baseWidth * scale)}px`;
  }, [expanded, scale, baseWidth]);

  if (error) return <div className="diagram-error">图无法渲染：{error}</div>;
  return <div className={`mermaid ${expanded ? "mermaid-expanded" : ""}`} ref={container} />;
}
