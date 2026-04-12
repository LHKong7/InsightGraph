"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import GraphViewer from "@/components/GraphViewer";
import NodePanel from "@/components/NodePanel";
import { getReportGraph } from "@/lib/api";
import type { GraphData, GraphNode } from "@/types";

function apiToGraphData(raw: { nodes: any[]; edges: any[] }): GraphData {
  const nodes: GraphNode[] = (raw.nodes || []).map((n: any) => {
    const props = n.props || n;
    const labels = n.labels || [];
    const type = labels[0] || props.entity_type || "Unknown";
    const id =
      n.id ||
      props.entity_id ||
      props.report_id ||
      props.claim_id ||
      props.paragraph_id ||
      props.span_id ||
      props.metric_id ||
      props.value_id ||
      props.section_id ||
      String(Math.random());
    const label =
      props.canonical_name ||
      props.name ||
      props.title ||
      (props.text || "").substring(0, 40) ||
      type;
    return { id, label, type, props };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const links = (raw.edges || [])
    .filter((e: any) => {
      const src = e.startId || e.source;
      const tgt = e.endId || e.target;
      return nodeIds.has(src) && nodeIds.has(tgt);
    })
    .map((e: any) => ({
      source: e.startId || e.source,
      target: e.endId || e.target,
      type: e.type || "RELATED",
      props: e.props || {},
    }));

  return { nodes, links };
}

export default function ReportGraphPage() {
  const params = useParams();
  const router = useRouter();
  const reportId = String(params.reportId);

  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [depth, setDepth] = useState(3);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await getReportGraph(reportId, depth);
      setGraphData(apiToGraphData(raw));
      setSelectedNode(null);
    } catch (err: any) {
      setError(err.message ?? "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, [reportId, depth]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  const nodeCountsByType = graphData.nodes.reduce<Record<string, number>>(
    (acc, n) => {
      acc[n.type] = (acc[n.type] ?? 0) + 1;
      return acc;
    },
    {},
  );

  return (
    <div className="flex-1 flex flex-col relative min-h-0">
      <div className="p-4 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => router.push("/reports")}
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            ← Reports
          </button>
          <h1 className="text-lg font-semibold">Report Graph</h1>
          <span className="font-mono text-xs text-gray-400">{reportId}</span>
          <div className="flex-1" />
          <label className="text-xs text-gray-400">
            Depth:
            <select
              value={depth}
              onChange={(e) => setDepth(parseInt(e.target.value))}
              className="ml-2 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
            </select>
          </label>
          <button
            onClick={loadGraph}
            className="text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50"
            disabled={loading}
          >
            ↻ {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="mt-2 flex items-center gap-3 text-xs text-gray-400 flex-wrap">
          <span>{graphData.nodes.length} nodes</span>
          <span>{graphData.links.length} edges</span>
          {Object.entries(nodeCountsByType).map(([type, count]) => (
            <span key={type} className="px-2 py-0.5 rounded bg-gray-800">
              {type}: {count}
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1 relative min-h-0">
        {error ? (
          <div className="flex items-center justify-center h-full text-red-400">
            {error}
          </div>
        ) : loading && graphData.nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            Loading graph…
          </div>
        ) : graphData.nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-xl mb-2">No graph data</p>
              <p className="text-sm">
                This report has no entities or relationships yet.
              </p>
            </div>
          </div>
        ) : (
          <GraphViewer
            data={graphData}
            onNodeClick={(node) => setSelectedNode(node)}
          />
        )}
        <NodePanel node={selectedNode} onClose={() => setSelectedNode(null)} />
      </div>
    </div>
  );
}
