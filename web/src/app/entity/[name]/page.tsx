"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { searchEntities, getEntityClaims, getEntityMetrics } from "@/lib/api";

export default function EntityPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const entityName = decodeURIComponent(name);

  const [entity, setEntity] = useState<any>(null);
  const [claims, setClaims] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await searchEntities(entityName, undefined, 1);
        const entities = res.entities || [];
        if (entities.length > 0) {
          const e = entities[0].entity || entities[0];
          setEntity(e);
          if (e.entity_id) {
            const [c, m] = await Promise.all([
              getEntityClaims(e.entity_id).catch(() => ({ claims: [] })),
              getEntityMetrics(e.entity_id).catch(() => ({ metrics: [] })),
            ]);
            setClaims(c.claims || []);
            setMetrics(m.metrics || []);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [entityName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Loading...
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-gray-500">Entity &quot;{entityName}&quot; not found.</p>
        <Link href="/" className="text-blue-400 hover:underline mt-4 inline-block">
          Back to graph
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Link href="/" className="text-blue-400 hover:underline text-sm">
        Back to graph
      </Link>

      <div className="mt-4">
        <h1 className="text-3xl font-bold">
          {entity.canonical_name || entity.name}
        </h1>
        <span className="text-sm px-2 py-0.5 bg-blue-900 text-blue-200 rounded mt-2 inline-block">
          {entity.entity_type}
        </span>
        {entity.description && (
          <p className="text-gray-400 mt-3">{entity.description}</p>
        )}
      </div>

      {/* Claims */}
      <div className="mt-8">
        <h2 className="text-xl font-semibold mb-4">
          Claims ({claims.length})
        </h2>
        <div className="space-y-2">
          {claims.map((c: any, i: number) => {
            const claim = c.claim || c;
            return (
              <div
                key={i}
                className="bg-gray-900 border border-gray-800 rounded-lg p-3"
              >
                <p className="text-sm text-gray-200">{claim.text}</p>
                <div className="flex gap-2 mt-2">
                  {claim.claim_type && (
                    <span className="text-xs bg-yellow-900 text-yellow-200 px-2 py-0.5 rounded">
                      {claim.claim_type}
                    </span>
                  )}
                  {claim.confidence && (
                    <span className="text-xs text-gray-500">
                      confidence: {claim.confidence}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {claims.length === 0 && (
            <p className="text-gray-500 text-sm">No claims found</p>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="mt-8">
        <h2 className="text-xl font-semibold mb-4">
          Metrics ({metrics.length})
        </h2>
        <div className="space-y-2">
          {metrics.map((m: any, i: number) => {
            const mv = m.metric_value || m;
            const metric = m.metric || {};
            return (
              <div
                key={i}
                className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex justify-between items-center"
              >
                <span className="text-sm text-gray-200">
                  {metric.name || "Metric"}
                </span>
                <div className="text-right">
                  <span className="text-lg font-semibold text-white">
                    {mv.value}
                  </span>
                  {mv.unit && (
                    <span className="text-sm text-gray-400 ml-1">
                      {mv.unit}
                    </span>
                  )}
                  {mv.period && (
                    <span className="text-xs text-gray-500 ml-2">
                      {mv.period}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {metrics.length === 0 && (
            <p className="text-gray-500 text-sm">No metrics found</p>
          )}
        </div>
      </div>
    </div>
  );
}
