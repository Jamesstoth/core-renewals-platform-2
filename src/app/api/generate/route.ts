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

  const description = (opp.description as string) ?? null;

  return `OPPORTUNITY DETAILS:
- Account: ${opp.accountName}
- Opportunity: ${opp.opportunityName}
- Owner/Rep: ${opp.owner}
- Stage: ${opp.stage}
- ARR: $${Number(opp.arr ?? 0).toLocaleString()}
- Renewal Date: ${opp.renewalDate ?? "N/A"}
- Close Date: ${opp.closeDate ?? "N/A"}
- Last Contact: ${opp.lastContactDate ?? "N/A"}
- Days Since Renewal Call: ${opp.daysSinceLastRenewalCall ?? "N/A"}
- Next Step: ${opp.nextStepOwner ?? "N/A"}
- Queue Status: ${opp.queueStatus}
- Flag Reason: ${opp.flagReason}
- Health Score: ${opp.healthScore ?? "N/A"}
- Churn Risk: ${opp.churnRiskCategory ?? "N/A"}
${description ? `\nDESCRIPTION/NOTES:\n${description}` : ""}

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
