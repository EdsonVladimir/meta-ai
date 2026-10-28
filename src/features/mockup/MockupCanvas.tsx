// Lienzo interactivo de mockups sobre React Flow (carga diferida: este
// módulo solo se importa desde el editor, en su propio chunk). Espeja el
// lienzo de diseños: zoom con rueda centrado en el cursor, arrastre del
// fondo para desplazar, botones acercar/alejar/ajustar/restablecer con
// porcentaje. Sin aristas: los componentes se seleccionan, mueven y
// redimensionan; mover o redimensionar solo toca la disposición, nunca
// la semántica. La tecla de borrado está desactivada: eliminar pasa por
// el inspector con confirmación de consecuencias.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  useViewport,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { MOCKUP_NODE_TYPES } from "./MockupNodes";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const FIT_PADDING = 0.2;

export interface MockupCanvasProps {
  nodes: Node[];
  readOnly: boolean;
  /** Incrementar para reajustar la vista al contenido. */
  fitSignal: number;
  /** Movimiento de un componente: solo disposición, nunca semántica. */
  onMoveNode?: (id: string, x: number, y: number) => void;
  /** Tamaño nuevo al soltar el redimensionado: solo disposición. */
  onResizeNode?: (id: string, w: number, h: number) => void;
  onSelectNode?: (id: string | null) => void;
  ariaLabel: string;
}

function CanvasToolbar({ readOnly }: { readOnly: boolean }) {
  const { zoom } = useViewport();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const percent = Math.round(zoom * 100);
  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Controles del lienzo">
      {!readOnly && <span className="canvas-hint">Arrastra para mover; tira de las esquinas para redimensionar</span>}
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
  readOnly,
  fitSignal,
  onMoveNode,
  onResizeNode,
  onSelectNode,
  ariaLabel,
}: MockupCanvasProps) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useStore((state) => state.nodesInitialized);
  const fittedSignal = useRef(fitSignal);
  const didInitialFit = useRef(false);
  const nodeTypes = useMemo(() => MOCKUP_NODE_TYPES, []);
  const resizeRef = useRef(onResizeNode);
  resizeRef.current = onResizeNode;

  // Dimensiones medidas por React Flow (modo controlado: hay que
  // devolverlas para que el ajuste inicial mida en estable).
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const idsSignature = useMemo(() => nodes.map((node) => node.id).sort().join("|"), [nodes]);
  useEffect(() => {
    setMeasured({});
  }, [idsSignature]);
  const measuredNodes = useMemo(
    () =>
      nodes.map((node) => {
        const withResize = {
          ...node,
          data: {
            ...(node.data as Record<string, unknown>),
            onResizeEnd: (id: string, w: number, h: number) => resizeRef.current?.(id, w, h),
          },
        };
        const dims = measured[node.id];
        return dims === undefined ? withResize : { ...withResize, measured: dims };
      }),
    [nodes, measured],
  );

  // Ajuste inicial único cuando los nodos ya están medidos.
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

  return (
    <div className={`design-canvas mockup-canvas${readOnly ? " readonly" : ""}`}>
      <ReactFlow
        nodes={measuredNodes}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        nodesDraggable={!readOnly}
        nodesConnectable={false}
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

export function MockupCanvas(props: MockupCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
