// Visor de diagramas Mermaid: carga la librería bajo demanda, solo en el
// cliente (renderizado local, sin API) y con seguridad estricta. La fuente
// siempre la deriva Rust de JSON validado; aun así, cualquier fallo de
// renderizado se muestra como error sin romper la aplicación, conservando
// el último diagrama válido.
import { useEffect, useReducer, useRef } from "react";
import { EMPTY_RENDER, renderReducer } from "./coordination";

let configured = false;
let counter = 0;

async function renderMermaid(id: string, source: string): Promise<string> {
  const mermaid = (await import("mermaid")).default;
  if (!configured) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
    });
    configured = true;
  }
  const { svg } = await mermaid.render(id, source);
  return svg;
}

interface MermaidDiagramProps {
  /** Fuente Mermaid derivada en Rust. */
  source: string;
  /** Prefijo para ids únicos de renderizado. */
  diagramId: string;
  /** Avisa a la revisión si el render actual es válido. */
  onRenderState?: (ok: boolean) => void;
}

export function MermaidDiagram({ source, diagramId, onRenderState }: MermaidDiagramProps) {
  const [render, dispatch] = useReducer(renderReducer, EMPTY_RENDER);
  const cancelledRef = useRef(false);
  const notifyRef = useRef(onRenderState);
  notifyRef.current = onRenderState;

  useEffect(() => {
    cancelledRef.current = false;
    dispatch({ type: "start" });
    notifyRef.current?.(false);
    counter += 1;
    const id = `${diagramId}-${counter}`;
    void (async () => {
      try {
        const svg = await renderMermaid(id, source);
        if (cancelledRef.current) return;
        dispatch({ type: "ok", svg });
        notifyRef.current?.(true);
      } catch (raw) {
        if (cancelledRef.current) return;
        const detail = raw instanceof Error ? raw.message : "Error de renderizado";
        dispatch({ type: "fail", error: `No se pudo dibujar el diagrama: ${detail}` });
        notifyRef.current?.(false);
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [source, diagramId]);

  return (
    <div className="diagram">
      {render.status === "loading" && render.svg === null && (
        <p className="hint">Dibujando diagrama…</p>
      )}
      {render.error !== null && (
        <p className="error" role="alert">
          {render.error}
          {render.svg !== null && " Se conserva el último diagrama válido."}
        </p>
      )}
      {render.svg !== null && (
        // SVG generado localmente por Mermaid en modo estricto a partir de
        // una fuente derivada en Rust de JSON validado y escapado.
        <div
          className="diagram-canvas"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: render.svg }}
        />
      )}
    </div>
  );
}
