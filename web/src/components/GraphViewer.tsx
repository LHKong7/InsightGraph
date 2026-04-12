"use client";

import { useCallback, useRef, useEffect, useState } from "react";
import type { GraphData, GraphNode, GraphLink } from "@/types";

// Dynamic import since react-force-graph-2d requires browser APIs
let ForceGraph2D: any = null;

const NODE_COLORS: Record<string, string> = {
  Entity: "#3b82f6",
  Claim: "#eab308",
  Metric: "#22c55e",
  MetricValue: "#16a34a",
  Report: "#6b7280",
  Section: "#9ca3af",
  Paragraph: "#d1d5db",
  SourceSpan: "#f97316",
};

function getNodeColor(type: string): string {
  return NODE_COLORS[type] || "#8b5cf6";
}

function getNodeSize(type: string): number {
  if (type === "Entity") return 8;
  if (type === "Report") return 10;
  if (type === "Claim") return 6;
  return 4;
}

interface Props {
  data: GraphData;
  onNodeClick?: (node: GraphNode) => void;
  width?: number;
  height?: number;
}

export default function GraphViewer({
  data,
  onNodeClick,
  width,
  height,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [FG, setFG] = useState<any>(null);
  const [dims, setDims] = useState({ w: width || 0, h: height || 0 });

  useEffect(() => {
    import("react-force-graph-2d").then((mod) => setFG(() => mod.default));
  }, []);

  useEffect(() => {
    if (width && height) return;
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setDims({
        w: Math.max(1, Math.floor(rect.width)),
        h: Math.max(1, Math.floor(rect.height)),
      });
    };

    // Initial measurement (next tick to catch post-layout)
    measure();
    const raf = requestAnimationFrame(measure);

    const ro = new ResizeObserver(() => measure());
    ro.observe(el);

    window.addEventListener("resize", measure);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [width, height]);

  const handleNodeClick = useCallback(
    (node: any) => {
      if (onNodeClick) onNodeClick(node as GraphNode);
    },
    [onNodeClick]
  );

  const graphData = {
    nodes: data.nodes.map((n) => ({
      ...n,
      color: n.color || getNodeColor(n.type),
      val: n.size || getNodeSize(n.type),
    })),
    links: data.links.map((l) => ({
      ...l,
      color: "#94a3b8",
    })),
  };

  const w = width ?? dims.w;
  const h = height ?? dims.h;
  const ready = FG && w > 0 && h > 0;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 bg-gray-950 overflow-hidden"
    >
      {ready ? (
        <FG
          graphData={graphData}
          width={w}
          height={h}
          nodeLabel={(n: any) => `${n.label} (${n.type})`}
          nodeColor={(n: any) => n.color}
          nodeVal={(n: any) => n.val}
          linkLabel={(l: any) => l.type}
          linkColor={(l: any) => l.color}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          onNodeClick={handleNodeClick}
          backgroundColor="#030712"
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const label = node.label || "";
            const fontSize = 12 / globalScale;
            const r = Math.sqrt(node.val || 4) * 2;

            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = node.color || "#3b82f6";
            ctx.fill();

            if (globalScale > 0.8) {
              ctx.font = `${fontSize}px sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillStyle = "#e5e7eb";
              ctx.fillText(label.substring(0, 20), node.x, node.y + r + 2);
            }
          }}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-gray-500">
          Loading graph...
        </div>
      )}
    </div>
  );
}
