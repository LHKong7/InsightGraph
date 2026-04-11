"use client";

import { useState, useRef, useEffect } from "react";
import { agentQuery, createSession } from "@/lib/api";
import type { ChatMessage } from "@/types";

export default function ChatWindow() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const initSession = async () => {
    if (!sessionId) {
      try {
        const s = await createSession();
        setSessionId(s.session_id);
        return s.session_id;
      } catch {
        return undefined;
      }
    }
    return sessionId;
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const question = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setLoading(true);

    try {
      const sid = await initSession();
      const res = await agentQuery(question, sid || undefined);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.answer,
          findings: res.key_findings,
          evidence: res.evidence,
          confidence: res.confidence,
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${err.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-20">
            <p className="text-lg">Ask a question about your knowledge graph</p>
            <p className="text-sm mt-2">
              e.g. &quot;What drove revenue growth?&quot; or &quot;Compare NVIDIA and AMD&quot;
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg p-3 ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-200"
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
              {msg.findings && msg.findings.length > 0 && (
                <div className="mt-3 border-t border-gray-700 pt-2">
                  <p className="text-xs text-gray-400 uppercase">Key Findings</p>
                  <ul className="list-disc list-inside text-sm mt-1 space-y-1">
                    {msg.findings.map((f, j) => (
                      <li key={j}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              {msg.confidence !== undefined && (
                <div className="mt-2 text-xs text-gray-400">
                  Confidence: {(msg.confidence * 100).toFixed(0)}%
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 rounded-lg p-3 text-gray-400 animate-pulse">
              Thinking...
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-700 p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..."
            className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white rounded-lg font-medium"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
