import { Shell } from "@/components/layout/shell";
import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bot, User, Send, Loader2, Trash2, MessageSquare } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const SUGGESTIONS = [
  "How many unsafe detections are there?",
  "What is the current safety score?",
  "Give me safety improvement recommendations",
  "Which workers had violations?",
  "Summarize recent activity",
];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hello! I'm your Worker Safety AI Assistant. I have access to real-time detection data from your surveillance system. Ask me anything — safety scores, violation summaries, worker stats, or recommendations.",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
        timestamp: new Date(),
      };

      const assistantId = crypto.randomUUID();
      const assistantMsg: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      setStreaming(true);

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const response = await fetch(`${BASE}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed }),
          signal: abort.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.done) break;
              if (parsed.error) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: `Error: ${parsed.error}` }
                      : m
                  )
                );
                break;
              }
              if (parsed.content) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: m.content + parsed.content }
                      : m
                  )
                );
              }
            } catch {
              // ignore malformed SSE lines
            }
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      "Sorry, I could not connect to the AI service. Please try again.",
                  }
                : m
            )
          );
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        textareaRef.current?.focus();
      }
    },
    [streaming]
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function clearChat() {
    abortRef.current?.abort();
    setStreaming(false);
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content:
          "Hello! I'm your Worker Safety AI Assistant. I have access to real-time detection data from your surveillance system. Ask me anything — safety scores, violation summaries, worker stats, or recommendations.",
        timestamp: new Date(),
      },
    ]);
  }

  const showSuggestions = messages.length <= 1;

  return (
    <Shell>
      <div className="flex flex-col h-[calc(100vh-2rem)] max-h-[900px]">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 shrink-0">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <Bot className="w-8 h-8 text-primary" />
              Safety Assistant
            </h1>
            <p className="text-muted-foreground font-mono text-sm">
              AI CHAT // POWERED BY LIVE DETECTION DATA
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearChat}
            className="text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear
          </Button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1 mb-4 min-h-0">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} streaming={streaming && msg.role === "assistant" && msg === messages[messages.length - 1] && msg.content === ""} />
          ))}

          {/* Suggestion chips */}
          {showSuggestions && (
            <div className="pt-4">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">
                Suggested Questions
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    disabled={streaming}
                    className="text-sm px-4 py-2 rounded-full border border-border/50 bg-card/50 text-muted-foreground hover:text-foreground hover:bg-card hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input Area */}
        <div className="shrink-0 border border-border/50 rounded-xl bg-card/50 backdrop-blur p-3 flex gap-3 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about safety data, violations, worker stats..."
            className="resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 min-h-[44px] max-h-[160px] text-sm p-0 pt-1"
            rows={1}
            disabled={streaming}
          />
          <Button
            size="icon"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || streaming}
            className="shrink-0 w-10 h-10 rounded-lg"
          >
            {streaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground/50 mt-2 font-mono">
          Press Enter to send, Shift+Enter for newline
        </p>
      </div>
    </Shell>
  );
}

function MessageBubble({
  message,
  streaming,
}: {
  message: Message;
  streaming: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted border border-border"
        }`}
      >
        {isUser ? (
          <User className="w-4 h-4" />
        ) : (
          <Bot className="w-4 h-4 text-primary" />
        )}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-card border border-border/50 text-card-foreground rounded-tl-sm"
        }`}
      >
        {streaming && message.content === "" ? (
          <div className="flex gap-1 items-center py-1">
            <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
        ) : (
          <div className="text-sm whitespace-pre-wrap leading-relaxed">
            {message.content}
            {!isUser && streaming && (
              <span className="inline-block w-1 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
            )}
          </div>
        )}
        <p
          className={`text-xs mt-1.5 ${
            isUser ? "text-primary-foreground/60" : "text-muted-foreground"
          }`}
        >
          {message.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}
