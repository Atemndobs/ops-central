"use client";

import { useState, useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { useConvexAuth, useQuery } from "convex/react";
import { Send, X, Loader2, Square, CheckCircle2 } from "lucide-react";
import Markdown from "react-markdown";
import { api } from "@convex/_generated/api";

const SUGGESTED_QUERIES = [
  "What's open today?",
  "What needs attention?",
  "Who last cleaned Dallas?",
  "Show me the review queue",
  "Who are my cleaners?",
];

// Only these roles get the AI assistant. Managers and cleaners are hidden.
const ALLOWED_ROLES = new Set(["admin", "property_ops"]);

export function AiChatPanel() {
  const { isAuthenticated } = useConvexAuth();
  const profile = useQuery(
    api.users.queries.getMyProfile,
    isAuthenticated ? {} : "skip",
  ) as { role?: string } | null | undefined;
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, stop, status, error, setMessages } = useChat({
    onError(err) {
      console.error("[OpsBot] Chat error:", err);
    },
  });
  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage({ text }).catch((err) => {
      console.error("[OpsBot] sendMessage failed:", err);
    });
  }

  function handleSuggestion(query: string) {
    setInput("");
    sendMessage({ text: query }).catch((err) => {
      console.error("[OpsBot] sendMessage failed:", err);
    });
  }

  function handleClear() {
    setMessages([]);
  }

  // Gate the whole panel to admins and ops only. Managers and cleaners
  // don't see it. While the profile query is loading we hide it too to
  // avoid a flash before role is known.
  if (!profile || !profile.role || !ALLOWED_ROLES.has(profile.role)) {
    return null;
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 9999,
          width: 56,
          height: 56,
          borderRadius: "50%",
          backgroundColor: "#7c3aed",
          color: "white",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
        }}
        aria-label="Open AI assistant"
      >
        <img src="/chezsoi-logo.svg" alt="ChezSoi" style={{ width: 56, height: 56, borderRadius: "50%" }} />
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9999,
        width: 384,
        height: 520,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 16,
        border: "1px solid var(--border)",
        backgroundColor: "var(--card)",
        color: "var(--card-foreground)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--border)",
          padding: "12px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src="/chezsoi-logo.svg" alt="ChezSoi" style={{ width: 24, height: 24, borderRadius: 6 }} />
          <span style={{ fontWeight: 600 }}>ChezSoi</span>
          <span
            style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 999,
              backgroundColor: "var(--muted)",
              color: "var(--muted-foreground)",
            }}
          >
            AI
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {isStreaming && (
            <button
              onClick={() => stop()}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 8,
                border: "none",
                background: "none",
                color: "var(--destructive, #ef4444)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Square style={{ width: 10, height: 10 }} />
              Stop
            </button>
          )}
          {messages.length > 0 && !isStreaming && (
            <button
              onClick={handleClear}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 8,
                border: "none",
                background: "none",
                color: "var(--muted-foreground)",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
          <button
            onClick={() => setIsOpen(false)}
            style={{
              padding: 6,
              borderRadius: 8,
              border: "none",
              background: "none",
              color: "var(--muted-foreground)",
              cursor: "pointer",
            }}
            aria-label="Close AI assistant"
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 16px",
        }}
        role="log"
      >
        {messages.length === 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              paddingTop: 16,
            }}
          >
            <p
              style={{
                textAlign: "center",
                fontSize: 14,
                color: "var(--muted-foreground)",
              }}
            >
              Ask me about your operations
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {SUGGESTED_QUERIES.map((query) => (
                <button
                  key={query}
                  onClick={() => handleSuggestion(query)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    backgroundColor: "transparent",
                    color: "var(--foreground)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {query}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            style={{
              marginBottom: 12,
              display: "flex",
              justifyContent:
                message.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "85%",
                borderRadius: 16,
                padding: "10px 14px",
                fontSize: 14,
                lineHeight: 1.6,
                ...(message.role === "user"
                  ? {
                      backgroundColor: "var(--primary)",
                      color: "var(--primary-foreground)",
                    }
                  : {
                      backgroundColor: "var(--muted)",
                      color: "var(--foreground)",
                    }),
              }}
            >
              <MessageContent
                parts={message.parts}
                role={message.role}
              />
            </div>
          </div>
        ))}

        {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
          <div
            style={{
              marginBottom: 12,
              display: "flex",
              justifyContent: "flex-start",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 16,
                padding: "10px 14px",
                fontSize: 14,
                backgroundColor: "var(--muted)",
                color: "var(--muted-foreground)",
              }}
            >
              <Loader2
                style={{
                  width: 14,
                  height: 14,
                  animation: "spin 1s linear infinite",
                }}
              />
              Thinking...
            </div>
          </div>
        )}

        {error && (
          <div
            style={{
              marginBottom: 12,
              padding: "8px 12px",
              borderRadius: 12,
              backgroundColor: "var(--destructive, #ef4444)",
              color: "white",
              fontSize: 13,
            }}
          >
            Error: {error.message || "Something went wrong"}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderTop: "1px solid var(--border)",
          padding: "12px 16px",
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about jobs, properties, inventory..."
          disabled={isStreaming}
          style={{
            flex: 1,
            borderRadius: 12,
            border: "1px solid var(--border)",
            backgroundColor: "var(--background)",
            color: "var(--foreground)",
            padding: "8px 14px",
            // iOS Safari zooms inputs with font-size < 16px; keep at 16 to prevent auto-zoom.
            fontSize: 16,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={!input.trim() || isStreaming}
          style={{
            width: 36,
            height: 36,
            borderRadius: 12,
            border: "none",
            backgroundColor: "var(--primary)",
            color: "var(--primary-foreground)",
            cursor: !input.trim() || isStreaming ? "default" : "pointer",
            opacity: !input.trim() || isStreaming ? 0.4 : 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-label="Send message"
        >
          <Send style={{ width: 16, height: 16 }} />
        </button>
      </form>
    </div>
  );
}

function isToolPart(type: string): boolean {
  return type.startsWith("tool-") || type === "dynamic-tool";
}

function isToolDone(part: Record<string, unknown>): boolean {
  const state = part.state as string | undefined;
  return state === "output-available" || state === "error";
}

function MessageContent({
  parts,
  role,
}: {
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
  role: string;
}) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === "text" && part.text) {
          return (
            <div key={i} className="opsbot-markdown">
              <Markdown>{part.text}</Markdown>
            </div>
          );
        }
        if (isToolPart(part.type) && role === "assistant") {
          if (isToolDone(part)) {
            return (
              <span
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "var(--muted-foreground)",
                  margin: "2px 0",
                  opacity: 0.6,
                }}
              >
                <CheckCircle2 style={{ width: 12, height: 12 }} />
                Data loaded
              </span>
            );
          }
          return (
            <span
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "var(--muted-foreground)",
                margin: "4px 0",
              }}
            >
              <Loader2
                style={{
                  width: 12,
                  height: 12,
                  animation: "spin 1s linear infinite",
                }}
              />
              Looking up data...
            </span>
          );
        }
        return null;
      })}
    </>
  );
}
