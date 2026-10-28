// Lienzo interactivo de diseños sobre React Flow (carga diferida: este
// módulo solo se importa desde el editor, en su propio chunk).
//
// Navegación: zoom con rueda centrado en el cursor, arrastre del fondo para
// desplazar, botones acercar/alejar/ajustar/restablecer con porcentaje.
// La rueda solo actúa dentro del lienzo: fuera sigue desplazando la
// interfaz y los formularios del inspector no se ven afectados.
// Selección y movimiento de elementos en modo edición; en lectura se puede
// navegar y seleccionar, pero no mover ni conectar.
// La tecla de borrado está desactivada: eliminar pasa por el inspector con
// confirmación de consecuencias.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  useViewport,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { DecisionNodeView, ErNodeView, FlowNodeView } from "./canvasNodes";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const FIT_PADDING = 0.2;

const NODE_TYPES = { flowNode: FlowNodeView, decisionNode: DecisionNodeView, erNode: ErNodeView } as const;

export interface DesignCanvasProps {
  nodes: Node[];
  edges: Edge[];
  /** "flowNode" | "erNode": lo elige el editor según el tipo. */
  readOnly: boolean;
  /** Incrementar para reajustar la vista al contenido. */
  fitSignal: number;
  /** Movimiento de un elemento: solo disposición, nunca semántica. */
  onMoveNode?: (id: string, x: number, y: number) => void;
  /** Nueva conexión arrastrada entre elementos (solo edición). */
  onConnectElements?: (from: string, to: string) => void;
  onSelectNode?: (id: string | null) => void;
  onSelectEdge?: (id: string | null) => void;
  ariaLabel: string;
}

function CanvasToolbar({ readOnly }: { readOnly: boolean }) {
  const { zoom } = useViewport();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const percent = Math.round(zoom * 100);
  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Controles del lienzo">
      {!readOnly && <span className="canvas-hint">Arrastra desde un punto para conectar</span>}
      <div className="canvas-toolbar-group">
        <button type="button" className="secondary small" onClick={() => zoomOut()} aria-label="Alejar">
          −
        </button>
        <span className="canvas-zoom" aria-live="polite" aria-label={`Zoom ${percent} por ciento`}>
          {percent} %
        </span>
        <button type="button" className="secondary small" onClick={() => zoomIn()} aria-label="Acercar">
          +
        </button>
        <button
          type="button"
          className="secondary small"
          onClick={() => fitView({ padding: FIT_PADDING, duration: 200 })}
          aria-label="Ajustar al contenido"
        >
          Ajustar
        </button>
        <button
          type="button"
          className="secondary small"
          onClick={() => fitView({ padding: FIT_PADDING, minZoom: 1, maxZoom: 1, duration: 200 })}
          aria-label="Restablecer vista al cien por cien"
          title="Centra el contenido al 100 %"
        >
          100 %
        </button>
      </div>
    </div>
  );
}

function CanvasInner({
  nodes,
  edges,
  readOnly,
  fitSignal,
  onMoveNode,
  onConnectElements,
  onSelectNode,
  onSelectEdge,
  ariaLabel,
}: DesignCanvasProps) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useStore((state) => state.nodesInitialized);
  const fittedSignal = useRef(fitSignal);
  const didInitialFit = useRef(false);
  const nodeTypes = useMemo(() => NODE_TYPES, []);

  // Dimensiones medidas por React Flow. En modo controlado hay que
  // devolverlas en el prop `nodes` (si no, `nodesInitialized` jamás se
  // activa y el ajuste inicial no sabe cuándo medir es estable).
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const idsSignature = useMemo(() => nodes.map((node) => node.id).sort().join("|"), [nodes]);
  useEffect(() => {
    setMeasured({});
  }, [idsSignature]);
  const measuredNodes = useMemo(
    () =>
      nodes.map((node) => {
        const dims = measured[node.id];
        return dims === undefined ? node : { ...node, measured: dims };
      }),
    [nodes, measured],
  );

  // Ajuste inicial único cuando los nodos ya están medidos. A propósito NO
  // se usa el prop `fitView` ni `onInit` ciego: ajustar antes de medir da
  // un encuadre distinto en cada apertura y compite con el zoom manual.
  useEffect(() => {
    if (!nodesInitialized || didInitialFit.current) return;
    didInitialFit.current = true;
    fitView({ padding: FIT_PADDING, maxZoom: 1 });
  }, [nodesInitialized, fitView]);

  useEffect(() => {
    if (fittedSignal.current === fitSignal) return;
    fittedSignal.current = fitSignal;
    fitView({ padding: FIT_PADDING, maxZoom: 1, duration: 200 });
  }, [fitSignal, fitView]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === "position" && change.position !== undefined && onMoveNode !== undefined) {
          onMoveNode(change.id, Math.round(change.position.x), Math.round(change.position.y));
        } else if (change.type === "select" && onSelectNode !== undefined) {
          onSelectNode(change.selected ? change.id : null);
        } else if (change.type === "dimensions" && change.dimensions !== undefined) {
          const { width, height } = change.dimensions;
          setMeasured((prev) => {
            const known = prev[change.id];
            if (known !== undefined && known.width === width && known.height === height) return prev;
            return { ...prev, [change.id]: { width, height } };
          });
        }
      }
    },
    [onMoveNode, onSelectNode],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === "select" && onSelectEdge !== undefined) {
          onSelectEdge(change.selected ? change.id : null);
        }
      }
    },
    [onSelectEdge],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.source !== null && connection.target !== null) {
        onConnectElements?.(connection.source, connection.target);
      }
    },
    [onConnectElements],
  );

  return (
    <div className={`design-canvas${readOnly ? " readonly" : ""}`}>
      <ReactFlow
        nodes={measuredNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={readOnly ? undefined : handleConnect}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable
        selectionOnDrag={false}
        panOnDrag
        zoomOnScroll
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        deleteKeyCode={null}
        colorMode="dark"
        aria-label={ariaLabel}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <CanvasToolbar readOnly={readOnly} />
      </ReactFlow>
    </div>
  );
}

export function DesignCanvas(props: DesignCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
