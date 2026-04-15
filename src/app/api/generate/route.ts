import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const EMAIL_TYPE_LABELS: Record<string, string> = {
  chase_quote_signature: "Chase quote signature",
  request_followup_call: "Request follow-up call",
  checkin_no_contact: "Check in — no recent contact",
  chase_legal: "Chase legal/contract review",
  renewal_reminder: "Renewal reminder",
  post_call_summary: "Post-call follow-up summary",
  escalation: "Escalation — no response",
};

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return new OpenAI({ apiKey });
}

function buildContext(opp: Record<string, unknown>, activityHistory: Record<string, unknown>[]): string {
  const activityLines = (activityHistory ?? [])
    .map((a) => {
      const notes = (a.notes as string) ?? "";
      const truncNotes = notes.length > 300 ? notes.slice(0, 300) + "..." : notes;
      return `  - ${a.date}: [${a.type}] ${a.subject} (by ${a.performedBy})${truncNotes ? `\n    Notes: ${truncNotes}` : ""}`;
    })
    .join("\n");

  const description          = (opp.description as string) ?? null;
  const accountReport        = (opp.accountReport as string) ?? null;
  const opportunityReport    = (opp.opportunityReport as string) ?? null;
  const supportTicketsSummary = (opp.supportTicketsSummary as string) ?? null;

  return `OPPORTUNITY DETAILS:
- Account: ${opp.accountName}
- Opportunity: ${opp.opportunityName}
- Owner/Rep: ${opp.owner}
- Stage: ${opp.stage}
- Product Family: ${opp.productFamily ?? "N/A"}
- ARR: $${Number(opp.arr ?? 0).toLocaleString()}
- Renewal Date: ${opp.renewalDate ?? "N/A"}
- Close Date: ${opp.closeDate ?? "N/A"}
- Last Contact: ${opp.lastContactDate ?? "N/A"}
- Days Since Renewal Call: ${opp.daysSinceLastRenewalCall ?? "N/A"}
- Renewal Call Logged: ${opp.renewalCallLogged ? "Yes" : "No"}
- Has Open Activity: ${opp.hasOpenActivity ? "Yes" : "No"}
- Has Overdue Task: ${opp.hasOverdueTask ? "Yes" : "No"}
- Next Step: ${opp.nextStepOwner ?? "N/A"}
- Queue Status: ${opp.queueStatus}
- Flag Reason: ${opp.flagReason}
- Health Score: ${opp.healthScore ?? "N/A"}
- Churn Risk: ${opp.churnRiskCategory ?? "N/A"}
${description ? `\nDESCRIPTION/NOTES:\n${description}` : ""}
${opportunityReport ? `\nOPPORTUNITY REPORT (SF Opportunity_Report__c):\n${opportunityReport}` : ""}
${accountReport ? `\nACCOUNT REPORT (SF Account.Account_Report__c):\n${accountReport}` : ""}
${supportTicketsSummary ? `\nSUPPORT TICKETS SUMMARY (SF Account.Support_Tickets_Summary__c):\n${supportTicketsSummary}` : ""}

ACTIVITY HISTORY (${activityHistory?.length ?? 0} entries):
${activityLines || "  No activity recorded."}`;
}

// ---------------------------------------------------------------------------
// POST /api/generate
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, emailType, opportunity, activityHistory } = body;

    if (!type || !opportunity) {
      return NextResponse.json({ error: "Missing type or opportunity" }, { status: 400 });
    }

    const openai = getOpenAI();
    const context = buildContext(opportunity, activityHistory ?? []);

    if (type === "email") {
      const label = EMAIL_TYPE_LABELS[emailType] ?? emailType;

      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        messages: [
          {
            role: "system",
            content: `You are a renewals account executive writing follow-up emails. Write professional but warm emails that reference specific details from the opportunity and activity history. Be concise — 3-5 short paragraphs max. Never invent facts not in the context. Sign off with just the rep's first name.

Return your response as JSON with exactly two fields:
{"subject": "...", "body": "..."}`,
          },
          {
            role: "user",
            content: `Write a "${label}" email for this opportunity. The email should be from ${opportunity.owner} to the customer contact at ${opportunity.accountName}.

${context}`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(content);

      return NextResponse.json({
        subject: parsed.subject ?? "Follow-up",
        body: parsed.body ?? "",
      });
    }

    if (type === "summary") {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        reasoning_effort: "high",
        messages: [
          {
            role: "system",
            content: "You are a renewals intelligence analyst. Write a concise 3-4 sentence briefing note in plain English. Cover: where the deal stands, any risks or urgency, and what the rep should focus on next. Do not use bullet points — write flowing sentences.",
          },
          {
            role: "user",
            content: `Write an opportunity overview briefing for this renewal:\n\n${context}`,
          },
        ],
      });

      return NextResponse.json({
        text: response.choices[0]?.message?.content ?? "",
      });
    }

    if (type === "call_objective") {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        reasoning_effort: "high",
        messages: [
          {
            role: "system",
            content: "You are a renewals coach. Write a concise paragraph (3-5 sentences) on what the rep should achieve on the next call with this customer. Be specific and actionable based on the deal context.",
          },
          {
            role: "user",
            content: `Write a call objective for the next call on this opportunity:\n\n${context}`,
          },
        ],
      });

      return NextResponse.json({
        text: response.choices[0]?.message?.content ?? "",
      });
    }

    if (type === "signals") {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        reasoning_effort: "high",
        messages: [
          {
            role: "system",
            content: `You are a renewals intelligence analyst. Examine the Salesforce data for this renewal opportunity and extract concrete positive and negative signals.

Positive signals = evidence the deal is healthy and likely to renew (engagement, advocacy, product adoption, timely next steps, clean support history, recent meaningful activity).
Negative signals = evidence of churn risk or stalling (gaps in engagement, missed follow-ups, support escalations, unresolved tickets, silence from the customer, MEDDPICCS gaps, pricing pushback).

Ground every signal in specific evidence from the context — do NOT speculate or invent facts not in the data. If something is absent from the data, either skip it or note it as a gap.

Each signal must have:
- label: a short phrase (≤ 8 words)
- evidence: one sentence citing the specific data point (dates, field names, activity subjects)
- severity: "high" | "medium" | "low"
- category: one of "engagement" | "stakeholder" | "product" | "support" | "pricing" | "timing" | "risk_flag"

Return strict JSON with this exact shape:
{"positiveSignals": [{"label": "...", "evidence": "...", "severity": "...", "category": "..."}], "negativeSignals": [...]}

Aim for 2–5 signals per side. If there's genuinely nothing to report on one side, return an empty array for that side.`,
          },
          {
            role: "user",
            content: `Extract positive and negative signals from this opportunity:\n\n${context}`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(content);

      return NextResponse.json({
        positiveSignals: Array.isArray(parsed.positiveSignals) ? parsed.positiveSignals : [],
        negativeSignals: Array.isArray(parsed.negativeSignals) ? parsed.negativeSignals : [],
      });
    }

    if (type === "question") {
      const question = body.question;
      if (!question) {
        return NextResponse.json({ error: "Missing question" }, { status: 400 });
      }

      const priorMessages = (body.conversationHistory ?? []).flatMap(
        (exchange: { question: string; answer: string }) => [
          { role: "user" as const, content: exchange.question },
          { role: "assistant" as const, content: exchange.answer },
        ]
      );

      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        reasoning_effort: "high",
        messages: [
          {
            role: "system",
            content: `You are a renewals intelligence analyst helping a rep understand a specific opportunity. Answer questions concisely and specifically using only the opportunity context provided. Be direct and actionable. Use plain English, not jargon. Keep answers to 2-4 sentences unless the question requires more detail.

${context}`,
          },
          ...priorMessages,
          { role: "user", content: question },
        ],
      });

      return NextResponse.json({
        text: response.choices[0]?.message?.content ?? "",
      });
    }

    return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[/api/generate] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
