// Interactive design canvas on React Flow (lazy loaded: this module is
// only imported from the editor, in its own chunk). Navigation:
// cursor-centered wheel zoom, background drag to pan, zoom in/out/fit/
// reset buttons with percentage. The wheel only acts inside the canvas:
// outside it keeps scrolling the UI and the inspector forms are
// unaffected. Element selection and movement in edit mode; in read mode
// one can navigate and select, but not move or connect. The delete key
// is disabled: deletion goes through the inspector with a consequences
// confirmation.
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
  /** "flowNode" | "erNode": picked by the editor per kind. */
  readOnly: boolean;
  /** Increment to refit the view to the content. */
  fitSignal: number;
  /** Element move: layout only, never semantics. */
  onMoveNode?: (id: string, x: number, y: number) => void;
  /** New dragged connection between elements (editing only). */
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
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas controls">
      {!readOnly && <span className="canvas-hint">Drag from a handle to connect</span>}
      <div className="canvas-toolbar-group">
        <button type="button" className="secondary small" onClick={() => zoomOut()} aria-label="Zoom out">
          −
        </button>
        <span className="canvas-zoom" aria-live="polite" aria-label={`Zoom ${percent} percent`}>
          {percent} %
        </span>
        <button type="button" className="secondary small" onClick={() => zoomIn()} aria-label="Zoom in">
          +
        </button>
        <button
          type="button"
          className="secondary small"
          onClick={() => fitView({ padding: FIT_PADDING, duration: 200 })}
          aria-label="Fit to content"
        >
          Fit
        </button>
        <button
          type="button"
          className="secondary small"
          onClick={() => fitView({ padding: FIT_PADDING, minZoom: 1, maxZoom: 1, duration: 200 })}
          aria-label="Reset view to one hundred percent"
          title="Centers the content at 100%"
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

  // Dimensions measured by React Flow. In controlled mode they must be
  // returned in the `nodes` prop (otherwise `nodesInitialized` never
  // activates and the initial fit cannot tell when measuring is stable).
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

  // Single initial fit once nodes are measured. Deliberately NOT using
  // the `fitView` prop or a blind `onInit`: fitting before measuring
  // yields a different framing on each open and fights manual zoom.
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
