import type { ReactNode } from "react";
import type { Node } from "@xyflow/react";
export type ComicNode = Node<{ content: ReactNode }, "comic">;
/** Fixed page geometry must be part of node data, not only CSS/ResizeObserver. */
export const comicNodes = (
  children: ReactNode[],
  pageWidth = 420
): ComicNode[] =>
  children.map((content, i) => ({
    id: String(i),
    type: "comic",
    position: { x: i * (pageWidth + 28), y: 0 },
    data: { content },
    width: pageWidth,
    height: 640,
    initialWidth: pageWidth,
    initialHeight: 640,
    measured: { width: pageWidth, height: 640 },
    style: { width: pageWidth, height: 640, pointerEvents: "all" },
    draggable: false,
    selectable: false,
  }));
