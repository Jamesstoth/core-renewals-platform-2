"use client";

import { useState, useEffect, useCallback } from "react";
import { QueueItem } from "@/types/renewals";
import { formatDate, formatCurrency, cn } from "@/lib/utils";

interface ExpandedDetailsProps {
  item: QueueItem;
}

const activityTypeBadge: Record<string, string> = {
  Call: "bg-blue-100 text-blue-700",
  Email: "bg-green-100 text-green-700",
  Meeting: "bg-purple-100 text-purple-700",
  "Internal Note": "bg-gray-100 text-gray-600",
};

const EMAIL_TYPES = [
  { value: "chase_quote_signature", label: "Chase quote signature" },
  { value: "request_followup_call", label: "Request follow-up call" },
  { value: "checkin_no_contact", label: "Check in — no recent contact" },
  { value: "chase_legal", label: "Chase legal/contract review" },
  { value: "renewal_reminder", label: "Renewal reminder" },
  { value: "post_call_summary", label: "Post-call follow-up summary" },
  { value: "escalation", label: "Escalation — no response" },
] as const;

const SUGGESTED_QUESTIONS = [
  "What are the main risks with this deal?",
  "What should I say on the next call?",
  "Summarise the customer's key concerns",
];

// ---------------------------------------------------------------------------
// AI generation hook
// ---------------------------------------------------------------------------

function useGenerate(
  type: "email" | "summary" | "call_objective",
  item: QueueItem,
  emailType?: string
) {
  const [data, setData] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          emailType,
          opportunity: item.opportunity,
          activityHistory: item.activityHistory,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error ?? "Generation failed");
      } else {
        setData(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }, [type, emailType, item]);

  return { data, loading, error, generate };
}

function Spinner() {
  return (
    <div className="flex items-center gap-2 py-3">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
      <span className="text-xs text-gray-500">Generating...</span>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-xs font-medium text-gray-500 hover:text-gray-700"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Generic collapsible section
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 hover:text-blue-700 cursor-pointer"
      >
        <svg
          className={cn(
            "h-4 w-4 text-gray-400 transition-transform",
            expanded && "rotate-90"
          )}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
        {title}
      </button>
      {expanded && <div className="mt-2">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity history — collapsed by default
// ---------------------------------------------------------------------------

function ActivityHistory({ entries }: { entries: QueueItem["activityHistory"] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 hover:text-blue-700 cursor-pointer"
      >
        <svg
          className={cn(
            "h-4 w-4 text-gray-400 transition-transform",
            expanded && "rotate-90"
          )}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
        Activity History
        <span className="text-xs font-normal text-gray-500">
          ({entries.length})
        </span>
      </button>
      {expanded && (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 mt-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Subject</th>
                  <th className="px-4 py-2.5">By</th>
                  <th className="px-4 py-2.5">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((entry) => (
                  <tr key={entry.id} className="bg-white hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                      {formatDate(entry.date)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                          activityTypeBadge[entry.type]
                        )}
                      >
                        {entry.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-900 font-medium">
                      {entry.subject}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                      {entry.performedBy}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 max-w-md">
                      {entry.notes}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={() => setExpanded(false)}
            className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-800"
          >
            Hide activity history
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ask AI about this deal
// ---------------------------------------------------------------------------

interface ChatExchange {
  question: string;
  answer: string;
}

function AskAI({ item }: { item: QueueItem }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [exchanges, setExchanges] = useState<ChatExchange[]>([]);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(
    async (question: string) => {
      if (!question.trim()) return;
      setInput("");
      setLoading(true);
      setError(null);

      // Keep last 3 exchanges for conversation context
      const recentHistory = exchanges.slice(-3);

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "question",
            question,
            opportunity: item.opportunity,
            activityHistory: item.activityHistory,
            conversationHistory: recentHistory,
          }),
        });
        const result = await res.json();
        if (!res.ok) {
          setError(result.error ?? "Failed to get answer");
        } else {
          setExchanges((prev) => [
            ...prev,
            { question, answer: result.text ?? "" },
          ]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Request failed");
      } finally {
        setLoading(false);
      }
    },
    [item, exchanges]
  );

  // Show last 3 exchanges
  const visibleExchanges = exchanges.slice(-3);

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-4">
      <h4 className="text-sm font-semibold text-purple-900 mb-3">
        Ask AI about this deal
      </h4>

      {/* Suggested questions */}
      {exchanges.length === 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => ask(q)}
              disabled={loading}
              className="rounded-full border border-purple-200 bg-white px-3 py-1.5 text-xs text-purple-700 hover:bg-purple-100 hover:border-purple-300 transition-colors disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Conversation history */}
      {visibleExchanges.length > 0 && (
        <div className="space-y-3 mb-3">
          {visibleExchanges.map((exchange, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex items-start gap-2">
                <span className="shrink-0 mt-0.5 rounded-full bg-purple-200 p-1">
                  <svg className="h-3 w-3 text-purple-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
                  </svg>
                </span>
                <p className="text-sm font-medium text-purple-900">
                  {exchange.question}
                </p>
              </div>
              <div className="flex items-start gap-2 ml-0.5">
                <span className="shrink-0 mt-0.5 rounded-full bg-blue-200 p-1">
                  <svg className="h-3 w-3 text-blue-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                  </svg>
                </span>
                <p className="text-sm text-gray-700 leading-relaxed">
                  {exchange.answer}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && <Spinner />}

      {/* Error */}
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !loading) ask(input);
          }}
          placeholder="Ask anything about this opportunity..."
          disabled={loading}
          className="flex-1 rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-purple-400 disabled:opacity-50"
        />
        <button
          onClick={() => ask(input)}
          disabled={loading || !input.trim()}
          className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ExpandedDetails({ item }: ExpandedDetailsProps) {
  const { opportunity, activityHistory } = item;

  // Overview — auto-loads on mount
  const overview = useGenerate("summary", item);
  useEffect(() => {
    overview.generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Call objective — auto-loads on mount
  const callObj = useGenerate("call_objective", item);
  useEffect(() => {
    callObj.generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Email — triggered by user
  const [emailType, setEmailType] = useState<string>(EMAIL_TYPES[0].value);
  const email = useGenerate("email", item, emailType);

  return (
    <div className="border-t border-gray-200 px-6 py-5 space-y-5 bg-gray-50/50">
      {/* Summary stats */}
      <div className="flex items-center gap-6 text-sm">
        <div>
          <span className="text-gray-500">ARR</span>{" "}
          <span className="font-semibold text-gray-900">
            {formatCurrency(opportunity.arr)}
          </span>
        </div>
        <div className="h-4 w-px bg-gray-300" />
        <div>
          <span className="text-gray-500">Last Contact</span>{" "}
          <span className="font-semibold text-gray-900">
            {formatDate(opportunity.lastContactDate)}
          </span>
        </div>
        <div className="h-4 w-px bg-gray-300" />
        <div>
          <span className="text-gray-500">Next Step Owner</span>{" "}
          <span className="font-semibold text-gray-900">
            {opportunity.nextStepOwner}
          </span>
        </div>
      </div>

      {/* Opportunity overview — AI generated */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-sm font-semibold text-blue-900">
            Opportunity Overview
          </h4>
          <div className="flex items-center gap-2">
            {overview.data?.text && <CopyButton text={overview.data.text} />}
            <button
              onClick={overview.generate}
              disabled={overview.loading}
              className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:text-blue-400"
            >
              Regenerate
            </button>
          </div>
        </div>
        {overview.loading ? (
          <Spinner />
        ) : overview.error ? (
          <p className="text-sm text-red-600">{overview.error}</p>
        ) : overview.data?.text ? (
          <p className="text-sm text-blue-800 leading-relaxed">
            {overview.data.text}
          </p>
        ) : null}
      </div>

      {/* Why this is flagged */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h4 className="text-sm font-semibold text-amber-900 mb-1">
          Why this is flagged
        </h4>
        <p className="text-sm text-amber-800">{opportunity.flagReason}</p>
      </div>

      {/* Opportunity Description — collapsed by default */}
      {opportunity.description ? (
        <CollapsibleSection title="Opportunity Description">
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
            {opportunity.description}
          </div>
        </CollapsibleSection>
      ) : null}

      {/* Activity history — collapsed by default */}
      <ActivityHistory entries={activityHistory} />

      {/* AI suggestions — email draft + call objective */}
      <div className="grid grid-cols-2 gap-4">
        {/* Email draft */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-900">
              Email Draft
            </h4>
            <div className="flex items-center gap-2">
              {email.data?.body && (
                <CopyButton
                  text={`Subject: ${email.data.subject}\n\n${email.data.body}`}
                />
              )}
              <button
                onClick={email.generate}
                disabled={email.loading}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:text-blue-400"
              >
                {email.data ? "Regenerate" : "Generate"}
              </button>
            </div>
          </div>

          {/* Email type selector */}
          <select
            value={emailType}
            onChange={(e) => setEmailType(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {EMAIL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          {email.loading ? (
            <Spinner />
          ) : email.error ? (
            <p className="text-sm text-red-600">{email.error}</p>
          ) : email.data ? (
            <>
              <p className="text-xs font-medium text-gray-500 mb-1">
                Subject:{" "}
                <span className="text-gray-900">{email.data.subject}</span>
              </p>
              <div className="mt-2 rounded border border-gray-100 bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-wrap">
                {email.data.body}
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-400 py-3">
              Select an email type and click Generate
            </p>
          )}
        </div>

        {/* Call objective */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-900">
              Call Objective
            </h4>
            <div className="flex items-center gap-2">
              {callObj.data?.text && <CopyButton text={callObj.data.text} />}
              <button
                onClick={callObj.generate}
                disabled={callObj.loading}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:text-blue-400"
              >
                Regenerate
              </button>
            </div>
          </div>
          {callObj.loading ? (
            <Spinner />
          ) : callObj.error ? (
            <p className="text-sm text-red-600">{callObj.error}</p>
          ) : callObj.data?.text ? (
            <p className="text-sm text-gray-700 leading-relaxed">
              {callObj.data.text}
            </p>
          ) : null}
        </div>
      </div>

      {/* Ask AI about this deal */}
      <AskAI item={item} />

      {/* Action buttons */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={() => alert("Action: Approve email draft")}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          Approve Email Draft
        </button>
        <button
          onClick={() => alert("Action: Create call task")}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Create Call Task
        </button>
        <button
          onClick={() => alert("Action: Snooze 7 days")}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Snooze 7 Days
        </button>
        <button
          onClick={() => alert("Action: Log blocker")}
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors"
        >
          Log Blocker
        </button>
        <button
          onClick={() => alert("Action: No action needed")}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          No Action Needed
        </button>
      </div>
    </div>
  );
}
