// Interactive mockup canvas on React Flow (lazy loaded: this module is
// only imported from the editor, in its own chunk). Mirrors the design
// canvas: cursor-centered wheel zoom, background drag to pan, zoom
// in/out/fit/reset buttons with percentage. No edges: components are
// selected, moved and resized; moving or resizing only touches layout,
// never semantics. The delete key is disabled: deletion goes through
// the inspector with a consequences confirmation.
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
  /** Increment to refit the view to the content. */
  fitSignal: number;
  /** Visible dot grid (optional, presentation only). */
  grid?: boolean;
  /** Component move: layout only, never semantics. */
  onMoveNode?: (id: string, x: number, y: number) => void;
  /** New size on resize release: layout only. */
  onResizeNode?: (id: string, w: number, h: number) => void;
  onSelectNode?: (id: string | null) => void;
  ariaLabel: string;
}

function CanvasToolbar({ readOnly }: { readOnly: boolean }) {
  const { zoom } = useViewport();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const percent = Math.round(zoom * 100);
  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas controls">
      {!readOnly && <span className="canvas-hint">Drag to move; pull the corners to resize</span>}
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
  readOnly,
  fitSignal,
  grid = true,
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

  // Dimensions measured by React Flow (controlled mode: they must
  // flow back so the initial fit measures on stable ground).
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

  // Single initial fit once nodes are measured.
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
        {grid && <Background variant={BackgroundVariant.Dots} gap={24} size={1} />}
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
