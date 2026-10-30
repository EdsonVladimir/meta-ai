// Mermaid diagram viewer: loads the library on demand, client-side
// only (local rendering, no API) and with strict security. The source
// is always derived by Rust from validated JSON; even so, any render
// failure shows as an error without breaking the app, keeping the last
// valid diagram.
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
  /** Rust-derived Mermaid source. */
  source: string;
  /** Prefix for unique render ids. */
  diagramId: string;
  /** Notifies the review whether the current render is valid. */
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
        const detail = raw instanceof Error ? raw.message : "Render error";
        dispatch({ type: "fail", error: `Could not draw the diagram: ${detail}` });
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
        <p className="hint">Drawing diagram…</p>
      )}
      {render.error !== null && (
        <p className="error" role="alert">
          {render.error}
          {render.svg !== null && " The last valid diagram is kept."}
        </p>
      )}
      {render.svg !== null && (
        // SVG generated locally by Mermaid in strict mode from a
        // Rust-derived source of validated, escaped JSON.
        <div
          className="diagram-canvas"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: render.svg }}
        />
      )}
    </div>
  );
}
