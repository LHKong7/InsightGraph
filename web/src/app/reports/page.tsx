"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  listReports,
  uploadReport,
  listJobs,
  type JobInfo,
} from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-500",
  parsing: "bg-blue-500",
  extracting: "bg-yellow-500",
  resolving: "bg-purple-500",
  writing: "bg-indigo-500",
  completed: "bg-green-600",
  failed: "bg-red-600",
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "bg-gray-500";
  const spinning = !["completed", "failed"].includes(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-white ${color}`}
    >
      {spinning && (
        <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
      )}
      {status}
    </span>
  );
}

export default function ReportsPage() {
  const [reports, setReports] = useState<any[]>([]);
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [jobSummary, setJobSummary] = useState({
    total: 0,
    active: 0,
    completed: 0,
    failed: 0,
  });
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    try {
      const data = await listReports();
      setReports((data as any).reports ?? (Array.isArray(data) ? data : []));
    } catch {
      // API not available
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const data = await listJobs();
      setJobs(data.jobs);
      setJobSummary(data.summary);
    } catch {
      // API not available
    }
  }, []);

  useEffect(() => {
    loadReports();
    loadJobs();
  }, [loadReports, loadJobs]);

  // Auto-poll jobs every 3s while there are active jobs
  useEffect(() => {
    if (jobSummary.active === 0) return;
    const interval = setInterval(() => {
      loadJobs();
      if (jobSummary.active > 0) loadReports();
    }, 3000);
    return () => clearInterval(interval);
  }, [jobSummary.active, loadJobs, loadReports]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const res = await uploadReport(file);
      setUploadResult(`Uploaded: ${res.report_id} — background job started`);
      loadJobs();
    } catch (err: any) {
      setUploadResult(`Error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Reports & Jobs</h1>

      {/* Upload */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold mb-3">Upload Report</h2>
        <p className="text-sm text-gray-400 mb-4">
          Supports PDF, CSV, JSON, Markdown, and Excel (.xlsx) files.
        </p>
        <label className="inline-block px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium cursor-pointer">
          {uploading ? "Uploading..." : "Choose File"}
          <input
            type="file"
            accept=".pdf,.csv,.json,.md,.xlsx,.xls"
            onChange={handleUpload}
            disabled={uploading}
            className="hidden"
          />
        </label>
        {uploadResult && (
          <p className="mt-3 text-sm text-gray-300">{uploadResult}</p>
        )}
      </div>

      {/* Jobs status */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Graph Builder Jobs</h2>
          <div className="flex gap-3 text-xs">
            <span className="text-gray-400">Total: {jobSummary.total}</span>
            <span className="text-yellow-400">Active: {jobSummary.active}</span>
            <span className="text-green-400">Done: {jobSummary.completed}</span>
            <span className="text-red-400">Failed: {jobSummary.failed}</span>
            <button
              onClick={loadJobs}
              className="text-blue-400 hover:text-blue-300"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {jobs.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">No jobs yet.</p>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div
                key={job.task_id}
                className="flex items-center gap-3 py-2 px-3 bg-gray-950 rounded border border-gray-800 text-sm"
              >
                <StatusBadge status={job.status} />
                <span className="font-mono text-xs text-gray-400 flex-shrink-0">
                  {job.report_id.slice(0, 8)}
                </span>
                <span className="text-xs text-gray-500 uppercase flex-shrink-0">
                  {job.source_type}
                </span>
                <div className="flex-1 text-xs text-gray-400 truncate">
                  {job.error ? (
                    <span className="text-red-400">{job.error}</span>
                  ) : job.result ? (
                    <span>
                      {job.result.entities != null && (
                        <span className="mr-3">
                          entities=<span className="text-white">{job.result.entities}</span>
                        </span>
                      )}
                      {job.result.claims != null && (
                        <span className="mr-3">
                          claims=<span className="text-white">{job.result.claims}</span>
                        </span>
                      )}
                      {job.result.relationships != null && (
                        <span className="mr-3">
                          rels=<span className="text-white">{job.result.relationships}</span>
                        </span>
                      )}
                      {job.result.edges != null && (
                        <span className="mr-3">
                          edges=<span className="text-white">{job.result.edges}</span>
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-gray-500 italic">processing…</span>
                  )}
                </div>
                {job.status === "completed" && (
                  <Link
                    href={`/reports/${job.report_id}`}
                    className="text-xs text-blue-400 hover:text-blue-300 flex-shrink-0"
                  >
                    View graph →
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Report list */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Ingested Reports</h2>
        <div className="space-y-3">
          {reports.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No reports ingested yet. Upload a document to get started.
            </p>
          ) : (
            reports.map((r: any, i: number) => {
              const report = r.report || r;
              const reportId = report.report_id;
              const cardContent = (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-white">
                      {report.title || report.source_filename || "Untitled"}
                    </h3>
                    {reportId && (
                      <span className="text-xs text-blue-400">View graph →</span>
                    )}
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-gray-400">
                    {reportId && <span>ID: {reportId}</span>}
                    {report.num_pages && <span>{report.num_pages} pages</span>}
                    {report.date && <span>{report.date}</span>}
                    {report.source_filename && (
                      <span>{report.source_filename}</span>
                    )}
                  </div>
                </>
              );
              return reportId ? (
                <Link
                  key={i}
                  href={`/reports/${reportId}`}
                  className="block bg-gray-900 border border-gray-800 hover:border-blue-600 rounded-lg p-4 transition-colors"
                >
                  {cardContent}
                </Link>
              ) : (
                <div
                  key={i}
                  className="bg-gray-900 border border-gray-800 rounded-lg p-4"
                >
                  {cardContent}
                </div>
              );
            })
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
