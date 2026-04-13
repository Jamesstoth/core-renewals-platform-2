// Reads from Supabase — no MCP dependency at runtime
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { FilterOptions } from "@/types/renewals";

export const dynamic = "force-dynamic";

const EMPTY_FILTER_OPTIONS: FilterOptions = {
  owners: [],
  stages: [],
  productFamilies: [],
  churnRiskCategories: [],
};

// ---------------------------------------------------------------------------
// GET /api/opportunities
//
// Reads pre-synced data from Supabase. The sync script (scripts/sync.ts)
// runs locally and populates this table from Salesforce via the MCP server.
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url) {
      console.error("[/api/opportunities] SUPABASE_URL is not set");
      return NextResponse.json(
        { error: "Server config error: SUPABASE_URL is not set", items: [], filterOptions: EMPTY_FILTER_OPTIONS },
        { status: 500 }
      );
    }
    if (!key) {
      console.error("[/api/opportunities] SUPABASE_SERVICE_KEY is not set");
      return NextResponse.json(
        { error: "Server config error: SUPABASE_SERVICE_KEY is not set", items: [], filterOptions: EMPTY_FILTER_OPTIONS },
        { status: 500 }
      );
    }

    const supabase = createClient(url, key);

    const { data: rows, error } = await supabase
      .from("opportunities")
      .select("*")
      .eq("is_closed", false)
      .order("close_date", { ascending: true });

    if (error) {
      console.error("[/api/opportunities] Supabase query error:", error);
      return NextResponse.json(
        {
          error: `Supabase query failed: ${error.message} (code: ${error.code ?? "unknown"})`,
          items: [],
          filterOptions: EMPTY_FILTER_OPTIONS,
        },
        { status: 500 }
      );
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ items: [], filterOptions: EMPTY_FILTER_OPTIONS });
    }

    // Shape rows into the QueueItem format the frontend expects
    const items = rows.map((row) => ({
      opportunity: {
        id: row.sf_opportunity_id,
        accountName: row.account_name,
        opportunityName: row.opportunity_name,
        owner: row.owner_name,
        stage: row.stage,
        renewalDate: row.renewal_date ?? row.close_date,
        closeDate: row.close_date,
        arr: row.arr ?? 0,
        amount: row.amount ?? 0,
        queueStatus: row.queue_status,
        daysSinceLastRenewalCall: row.days_since_renewal_call ?? 0,
        flagReason: row.flag_reason,
        lastContactDate: row.last_contact_date ?? row.last_activity_date ?? "",
        nextStepOwner: row.next_step ?? row.owner_name,
        renewalCallLogged: row.renewal_call_logged ?? false,
        healthScore: row.health_score,
        churnRiskCategory: row.churn_risk_category,
        productFamily: row.product_family,
        hasOpenActivity: row.has_open_activity ?? false,
        hasOverdueTask: row.has_overdue_task ?? false,
        description: row.description ?? null,
      },
      activityHistory: row.activity_history ?? [],
      aiSuggestions: {
        emailDraft: {
          subject: "AI draft pending",
          body: "Email draft will be generated when the Anthropic API integration is connected.",
        },
        callObjective:
          "Call objective will be generated when the Anthropic API integration is connected.",
      },
    }));

    // Extract filter options from the data
    const owners = new Set<string>();
    const stages = new Set<string>();
    const productFamilies = new Set<string>();
    const churnRiskCategories = new Set<string>();

    for (const row of rows) {
      if (row.owner_name) owners.add(row.owner_name);
      if (row.stage) stages.add(row.stage);
      if (row.product_family) productFamilies.add(row.product_family);
      if (row.churn_risk_category) churnRiskCategories.add(row.churn_risk_category);
    }

    const sort = (s: Set<string>) =>
      Array.from(s).sort((a, b) => a.localeCompare(b));

    const filterOptions: FilterOptions = {
      owners: sort(owners),
      stages: sort(stages),
      productFamilies: sort(productFamilies),
      churnRiskCategories: sort(churnRiskCategories),
    };

    // Get the most recent synced_at timestamp
    const syncedAt = rows.reduce((latest: string | null, row) => {
      if (!row.synced_at) return latest;
      if (!latest || row.synced_at > latest) return row.synced_at;
      return latest;
    }, null);

    return NextResponse.json({ items, filterOptions, syncedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[/api/opportunities] Error:", message);
    return NextResponse.json(
      { error: message, items: [], filterOptions: EMPTY_FILTER_OPTIONS },
      { status: 500 }
    );
  }
}
