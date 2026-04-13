/**
 * GET /api/opportunity-activities?id=006...
 *
 * Fetches activity history (renewal calls + follow-ups) for a single
 * opportunity via the Anthropic API MCP connector. Called on-demand
 * when a rep opens an opportunity detail page.
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MCP_SERVER_URL = "https://mcp.csaiautomations.com/salesforce/mcp/";

// Lightweight field list — no Description to keep token count low
const TASK_FIELDS =
  "Id, Subject, Status, Type, ActivityDate, CreatedDate, Owner.Name, WhatId, Is_Renewal_Call__c";

async function sfQueryViaMcp(
  client: Anthropic,
  soql: string,
  mcpToken: string,
  label: string
): Promise<Record<string, unknown>[]> {
  console.log(`[opportunity-activities] sfQueryViaMcp(${label}): calling Anthropic API...`);

  const response = await (client.beta.messages.create as any)({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    betas: ["mcp-client-2025-11-20"],
    mcp_servers: [
      {
        type: "url",
        url: MCP_SERVER_URL,
        name: "salesforce",
        authorization_token: mcpToken,
      },
    ],
    tools: [{ type: "mcp_toolset", mcp_server_name: "salesforce" }],
    messages: [
      {
        role: "user",
        content: `Use the sf_query tool to run this exact SOQL query and return the raw JSON result with no commentary:\n${soql}`,
      },
    ],
  });

  for (const block of response.content) {
    if (block.type === "mcp_tool_result" && !block.is_error) {
      const items = Array.isArray(block.content) ? block.content : [];
      for (const item of items) {
        if (item.type === "text") {
          let parsed = JSON.parse(item.text);
          if (parsed.content && Array.isArray(parsed.content) && parsed.content[0]?.text) {
            parsed = JSON.parse(parsed.content[0].text);
          }
          return (parsed.records as Record<string, unknown>[]) ?? [];
        }
      }
    }
  }

  for (const block of response.content) {
    if (block.type === "text") {
      const jsonMatch = block.text.match(/\{[\s\S]*"records"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return (parsed.records as Record<string, unknown>[]) ?? [];
      }
    }
  }

  return [];
}

export async function GET(request: NextRequest) {
  try {
    const oppId = request.nextUrl.searchParams.get("id");
    if (!oppId) {
      return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    const mcpToken = process.env.SALESFORCE_MCP_TOKEN;

    if (!apiKey || apiKey === "your-anthropic-api-key") {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }
    if (!mcpToken) {
      return NextResponse.json({ error: "SALESFORCE_MCP_TOKEN not configured" }, { status: 500 });
    }

    const client = new Anthropic({ apiKey });

    // Fetch the 50 most recent tasks for this opportunity (lightweight fields, no Description)
    const soql = `SELECT ${TASK_FIELDS} FROM Task WHERE WhatId = '${oppId}' ORDER BY CreatedDate DESC LIMIT 50`;

    const tasks = await sfQueryViaMcp(client, soql, mcpToken, `activities-${oppId}`);

    const typeMap: Record<string, string> = { Call: "Call", Email: "Email", Meeting: "Meeting" };
    const activities = tasks.map((t) => ({
      id: t.Id as string,
      date: ((t.ActivityDate ?? t.CreatedDate) as string) ?? "",
      type: typeMap[(t.Type as string) ?? ""] ?? "Internal Note",
      subject: (t.Subject as string) ?? "(No subject)",
      performedBy: ((t.Owner as { Name?: string })?.Name) ?? "Unknown",
      notes: "",
      isRenewalCall: (t.Is_Renewal_Call__c as boolean) ?? false,
    }));

    return NextResponse.json({ activities });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[opportunity-activities] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
