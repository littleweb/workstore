import {
  PlusOutlined,
  MinusOutlined,
  ColumnHeightOutlined,
} from "@ant-design/icons";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ReactFlow,
  Panel,
  PanOnScrollMode,
  type ReactFlowInstance,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { pageStripWidth, visibleViewport } from "./viewport";
import { comicNodes, type ComicNode } from "./canvasNodes";
const nodeTypes = {
  comic: ({ data }: NodeProps<ComicNode>) => (
    <div className="nodrag">{data.content}</div>
  ),
};
const heightZoom = (height: number) =>
  Math.max(0.2, Math.min(1.5, (height - 48) / 640));
export default function ComicCanvas({
  children,
  ratio = 3 / 4,
}: {
  children: ReactNode[];
  ratio?: number;
}) {
  const pageWidth = 560 * ratio;
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [flow, setFlow] = useState<ReactFlowInstance<ComicNode> | null>(null);
  const lastSize = useRef({ width: 0, height: 0 });
  const count = children.length;
  const measure = () => {
    const el = host.current;
    if (!el || el.clientWidth < 1 || el.clientHeight < 1) return;
    const next = { width: el.clientWidth, height: el.clientHeight };
    setSize((previous) =>
      previous.width === next.width && previous.height === next.height
        ? previous
        : next
    );
  };
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (host.current) observer.observe(host.current);
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    document.addEventListener("visibilitychange", measure);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", measure);
    };
  }, []);
  useEffect(() => {
    if (!flow || !size.width || !size.height) return;
    const previous = flow.getViewport();
    const resized = lastSize.current.height !== size.height;
    const zoom = resized ? heightZoom(size.height) : previous.zoom;
    void flow.setViewport(
      visibleViewport(
        {
          x: 24 + ((previous.x - 24) * zoom) / (previous.zoom || 1),
          y: resized ? 24 : previous.y,
          zoom,
        },
        size.width,
        size.height,
        count,
        pageWidth
      )
    );
    lastSize.current = size;
  }, [flow, size, count, pageWidth]);
  const fitHeight = () => {
    measure();
    if (!flow || !host.current?.clientHeight || !host.current.clientWidth)
      return;
    void flow.setViewport({
      x: 24,
      y: 24,
      zoom: heightZoom(host.current.clientHeight),
    });
  };
  return (
    <div className="story-pages story-canvas" ref={host}>
      {size.width > 0 && size.height > 0 ? (
        <ReactFlow<ComicNode>
          width={size.width}
          height={size.height}
          nodes={comicNodes(children, pageWidth)}
          edges={[]}
          nodeTypes={nodeTypes}
          onInit={setFlow}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          minZoom={0.2}
          maxZoom={2}
          panOnScroll
          panOnScrollMode={PanOnScrollMode.Horizontal}
          translateExtent={[
            [-24, -24],
            [pageStripWidth(count, pageWidth) + 24, 664],
          ]}
          zoomOnScroll={false}
          zoomOnPinch
          preventScrolling
          panOnDrag
          paneClickDistance={5}
          proOptions={{ hideAttribution: true }}
        >
          <Panel position="bottom-left" className="story-canvas-tools">
            <button
              aria-label="放大"
              title="放大"
              onClick={() => void flow?.zoomIn()}
            >
              <PlusOutlined />
            </button>
            <button
              aria-label="缩小"
              title="缩小"
              onClick={() => void flow?.zoomOut()}
            >
              <MinusOutlined />
            </button>
            <button aria-label="适应高度" title="适应高度" onClick={fitHeight}>
              <ColumnHeightOutlined />
            </button>
          </Panel>
        </ReactFlow>
      ) : (
        <span role="status">正在准备漫画画布…</span>
      )}
    </div>
  );
}
