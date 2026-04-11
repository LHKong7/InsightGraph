"use client";

import { useState, useCallback } from "react";
import GraphViewer from "@/components/GraphViewer";
import NodePanel from "@/components/NodePanel";
import SearchBar from "@/components/SearchBar";
import { getSubgraph } from "@/lib/api";
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

export default function GraphExplorer() {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const raw = await getSubgraph(query);
      setGraphData(apiToGraphData(raw));
      setSelectedNode(null);
    } catch (err) {
      console.error("Subgraph fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="flex-1 flex flex-col relative">
      <div className="p-4 border-b border-gray-800">
        <SearchBar
          onSearch={handleSearch}
          placeholder="Search graph... (e.g. NVIDIA, revenue, AI market)"
          loading={loading}
        />
        <div className="mt-2 text-xs text-gray-500">
          {graphData.nodes.length} nodes, {graphData.links.length} edges
        </div>
      </div>
      <div className="flex-1 relative">
        {graphData.nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-xl mb-2">Knowledge Graph Explorer</p>
              <p className="text-sm">Search for an entity to visualize its neighborhood</p>
            </div>
          </div>
        ) : (
          <GraphViewer data={graphData} onNodeClick={(node) => setSelectedNode(node)} />
        )}
        <NodePanel node={selectedNode} onClose={() => setSelectedNode(null)} />
      </div>
    </div>
  );
}
