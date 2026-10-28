// Grafo de impacto en SVG: lectura con selección, zoom y ajuste.
// Sin dependencias: pan con arrastre del fondo (nunca modifica nada),
// zoom con rueda o botones, nodos clicables y navegables por teclado.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  NODE_H,
  NODE_W,
  type ImpactGraphLayout,
  type ImpactNodeStatus,
} from "./layout";

interface View {
  scale: number;
  tx: number;
  ty: number;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;

function statusMeta(status: ImpactNodeStatus): { glyph: string; label: string } {
  switch (status) {
    case "origin":
      return { glyph: "◉", label: "Origen del cambio" };
    case "pending":
      return { glyph: "!", label: "Requiere revisión" };
    case "awaiting":
      return { glyph: "◷", label: "Fuentes al día, pendiente de revisión" };
    case "updated":
      return { glyph: "✓", label: "Al día" };
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "requirement":
      return "REQ";
    case "flow":
      return "FLUJO";
    case "data_model":
      return "MER";
    case "mockup":
      return "MOCKUP";
    default:
      return kind.toUpperCase();
  }
}

interface Props {
  layout: ImpactGraphLayout;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function ImpactGraph({ layout, selectedId, onSelect }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 640, h: 360 });
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setBox({ w: rect.width, h: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => {
    const pad = 24;
    const w = Math.max(1, layout.width);
    const h = Math.max(1, layout.height);
    const scale = Math.min((box.w - pad) / w, (box.h - pad) / h, MAX_SCALE);
    const clamped = Math.max(MIN_SCALE, scale);
    setView({
      scale: clamped,
      tx: (box.w - w * clamped) / 2,
      ty: (box.h - h * clamped) / 2,
    });
  }, [box.h, box.w, layout.height, layout.width]);

  // Al cambiar el informe, reencuadrar. El zoom manual posterior es local
  // y efímero: no se guarda en ningún sitio.
  useEffect(() => {
    fit();
  }, [fit]);

  function zoomAt(clientX: number, clientY: number, factor: number) {
    const el = boxRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const k = scale / v.scale;
      return { scale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
    });
  }

  function zoomStep(factor: number) {
    const el = boxRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  return (
    <div className="impact-graph">
      <div className="graph-toolbar" role="toolbar" aria-label="Controles del mapa">
        <button type="button" className="secondary small" onClick={() => zoomStep(1.25)}>
          Acercar
        </button>
        <button type="button" className="secondary small" onClick={() => zoomStep(1 / 1.25)}>
          Alejar
        </button>
        <button type="button" className="secondary small" onClick={fit}>
          Ajustar
        </button>
        <span className="hint" aria-live="polite">
          {Math.round(view.scale * 100)} %
        </span>
      </div>
      <div
        ref={boxRef}
        className="graph-canvas"
        onWheel={(e) => {
          e.preventDefault();
          zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
        }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d === null) return;
          setView((v) => ({ ...v, tx: d.tx + e.clientX - d.x, ty: d.ty + e.clientY - d.y }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <svg
          width={box.w}
          height={box.h}
          role="img"
          aria-label={`Mapa de impacto con ${layout.shown} nodos visibles de ${layout.total}`}
        >
          <defs>
            <marker
              id="impact-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0L10 5L0 10z" className="edge-head" />
            </marker>
          </defs>
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
            {layout.edges.map((edge) => (
              <ImpactEdge
                key={`${edge.from}\n${edge.to}`}
                layout={layout}
                from={edge.from}
                to={edge.to}
              />
            ))}
            {layout.nodes.map((node) => {
              const meta = statusMeta(node.status);
              const selected = node.id === selectedId;
              const shown = node.title ?? node.id;
              const full = node.title === null ? node.id : `${node.title} — ${node.id}`;
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  className={`graph-node status-${node.status}${selected ? " selected" : ""}`}
                  tabIndex={0}
                  role="button"
                  aria-pressed={selected}
                  aria-label={`${full}: ${meta.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(selected ? null : node.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(selected ? null : node.id);
                    }
                  }}
                >
                  <title>{`${full} — ${meta.label}`}</title>
                  <rect width={NODE_W} height={NODE_H} rx={8} className="node-box" />
                  <text x={12} y={21} className="node-kind">
                    {kindLabel(node.kind)} · {meta.glyph} {meta.label}
                  </text>
                  <text x={12} y={41} className="node-id">
                    {shown.length > 22 ? `${shown.slice(0, 21)}…` : shown}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <ul className="graph-legend" aria-label="Leyenda">
        <li>
          <span className="legend-swatch status-origin" aria-hidden="true">
            ◉
          </span>{" "}
          Origen del cambio
        </li>
        <li>
          <span className="legend-swatch status-pending" aria-hidden="true">
            !
          </span>{" "}
          Requiere revisión
        </li>
        <li>
          <span className="legend-swatch status-awaiting" aria-hidden="true">
            ◷
          </span>{" "}
          Fuentes al día, pendiente de revisión
        </li>
        <li>
          <span className="legend-swatch status-updated" aria-hidden="true">
            ✓
          </span>{" "}
          Al día (relacionado, sin pendiente)
        </li>
      </ul>
      <p className="hint">Las flechas van de la fuente al dependiente: el impacto fluye con ellas.</p>
    </div>
  );
}

function ImpactEdge({
  layout,
  from,
  to,
}: {
  layout: ImpactGraphLayout;
  from: string;
  to: string;
}) {
  const a = layout.nodes.find((n) => n.id === from);
  const b = layout.nodes.find((n) => n.id === to);
  if (a === undefined || b === undefined) return null;
  const x1 = a.x + NODE_W;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x;
  const y2 = b.y + NODE_H / 2;
  const mx = (x1 + x2) / 2;
  return <path d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} className="edge-line" />;
}
