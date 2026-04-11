"use client";

import ChatWindow from "@/components/ChatWindow";

export default function ChatPage() {
  return (
    <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-2xl font-bold">Agent Chat</h1>
        <p className="text-sm text-gray-500 mt-1">
          Ask questions about your knowledge graph. The agent uses graph
          traversal, semantic search, and LLM analysis.
        </p>
      </div>
      <div className="flex-1 flex flex-col min-h-0">
        <ChatWindow />
      </div>
    </div>
  );
}
