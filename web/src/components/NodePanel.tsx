"use client";

import type { GraphNode } from "@/types";

interface Props {
  node: GraphNode | null;
  onClose: () => void;
}

export default function NodePanel({ node, onClose }: Props) {
  if (!node) return null;

  const { label, type, props } = node;

  return (
    <div className="absolute top-4 right-4 w-96 max-h-[80vh] bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-y-auto z-50">
      <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-4 flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-white">{label}</h3>
          <span className="text-xs px-2 py-0.5 bg-blue-900 text-blue-200 rounded">
            {type}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-xl"
        >
          x
        </button>
      </div>

      <div className="p-4 space-y-3">
        {Object.entries(props).map(([key, value]) => {
          if (key === "embedding" || value === null || value === undefined)
            return null;

          const display =
            typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);

          return (
            <div key={key}>
              <dt className="text-xs text-gray-400 uppercase tracking-wide">
                {key}
              </dt>
              <dd className="text-sm text-gray-200 mt-0.5 whitespace-pre-wrap break-words">
                {display.length > 300 ? display.slice(0, 300) + "..." : display}
              </dd>
            </div>
          );
        })}
      </div>
    </div>
  );
}
