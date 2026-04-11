"use client";

import { useState, useEffect, useCallback } from "react";
import { listReports, uploadReport } from "@/lib/api";

export default function ReportsPage() {
  const [reports, setReports] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    try {
      const data = await listReports();
      setReports(data.reports || []);
    } catch {
      // API not available
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const res = await uploadReport(file);
      setUploadResult(`Uploaded: ${res.report_id} (${res.status})`);
      loadReports();
    } catch (err: any) {
      setUploadResult(`Error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Reports</h1>

      {/* Upload */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold mb-3">Upload Report</h2>
        <p className="text-sm text-gray-400 mb-4">
          Supports PDF, CSV, JSON, DOCX, HTML, Markdown, and TXT files.
        </p>
        <label className="inline-block px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium cursor-pointer">
          {uploading ? "Uploading..." : "Choose File"}
          <input
            type="file"
            accept=".pdf,.csv,.json,.docx,.html,.md,.txt"
            onChange={handleUpload}
            disabled={uploading}
            className="hidden"
          />
        </label>
        {uploadResult && (
          <p className="mt-3 text-sm text-gray-300">{uploadResult}</p>
        )}
      </div>

      {/* Report list */}
      <div className="space-y-3">
        {reports.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            No reports ingested yet. Upload a document to get started.
          </p>
        ) : (
          reports.map((r: any, i: number) => {
            const report = r.report || r;
            return (
              <div
                key={i}
                className="bg-gray-900 border border-gray-800 rounded-lg p-4"
              >
                <h3 className="font-semibold text-white">
                  {report.title || report.source_filename || "Untitled"}
                </h3>
                <div className="flex gap-4 mt-2 text-xs text-gray-400">
                  {report.report_id && <span>ID: {report.report_id}</span>}
                  {report.num_pages && <span>{report.num_pages} pages</span>}
                  {report.date && <span>{report.date}</span>}
                  {report.source_filename && (
                    <span>{report.source_filename}</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
