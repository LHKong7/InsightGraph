"use client";

import { useState } from "react";
import { searchDocuments } from "@/lib/api";
import type { SearchResult } from "@/types";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"hybrid" | "vector" | "graph">("hybrid");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await searchDocuments(query, mode);
      setResults(data.results || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Search</h1>

      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents..."
          className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as any)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
        >
          <option value="hybrid">Hybrid</option>
          <option value="vector">Vector</option>
          <option value="graph">Graph</option>
        </select>
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white rounded-lg font-medium"
        >
          {loading ? "..." : "Search"}
        </button>
      </form>

      <div className="space-y-3">
        {results.map((r, i) => (
          <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs px-2 py-0.5 rounded ${
                r.result_type === "paragraph"
                  ? "bg-gray-700 text-gray-300"
                  : r.result_type === "claim"
                  ? "bg-yellow-900 text-yellow-200"
                  : "bg-blue-900 text-blue-200"
              }`}>
                {r.result_type}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded ${
                r.source === "both"
                  ? "bg-purple-900 text-purple-200"
                  : r.source === "graph"
                  ? "bg-green-900 text-green-200"
                  : "bg-orange-900 text-orange-200"
              }`}>
                {r.source}
              </span>
              <span className="text-xs text-gray-500">
                score: {r.score?.toFixed(3)}
              </span>
              {r.page && (
                <span className="text-xs text-gray-500">p.{r.page}</span>
              )}
            </div>
            <p className="text-sm text-gray-200">
              {(r.text || "").substring(0, 300)}
              {(r.text || "").length > 300 ? "..." : ""}
            </p>
            {r.report_title && (
              <p className="text-xs text-gray-500 mt-2">
                {r.report_title}
                {r.section_title ? ` / ${r.section_title}` : ""}
              </p>
            )}
          </div>
        ))}
        {results.length === 0 && !loading && query && (
          <p className="text-gray-500 text-center py-8">No results found</p>
        )}
      </div>
      </div>
    </div>
  );
}
