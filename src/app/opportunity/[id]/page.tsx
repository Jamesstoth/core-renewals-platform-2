"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { QueueItem, ActivityEntry } from "@/types/renewals";
import { getStatusConfig, formatDate, formatCurrency, cn } from "@/lib/utils";
import ExpandedDetails from "@/components/ExpandedDetails";

export default function OpportunityPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [item, setItem] = useState<QueueItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Activity loading state
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);

  // Fetch opportunity data from Supabase
  useEffect(() => {
    async function fetchOpportunity() {
      try {
        const res = await fetch("/api/opportunities");
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed to load opportunity");
          return;
        }
        const found = (data.items as QueueItem[])?.find(
          (i) => i.opportunity.id === id
        );
        if (!found) {
          setError("Opportunity not found");
          return;
        }
        setItem(found);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    fetchOpportunity();
  }, [id]);

  // Fetch activities on-demand via Anthropic MCP
  useEffect(() => {
    if (!item) return;

    async function fetchActivities() {
      setActivitiesLoading(true);
      setActivitiesError(null);
      try {
        const res = await fetch(
          `/api/opportunity-activities?id=${encodeURIComponent(id)}`
        );
        const data = await res.json();
        if (!res.ok) {
          setActivitiesError(data.error ?? "Failed to load activities");
          return;
        }
        setItem((prev) =>
          prev
            ? { ...prev, activityHistory: data.activities as ActivityEntry[] }
            : prev
        );
      } catch (err) {
        setActivitiesError(
          err instanceof Error ? err.message : "Failed to load activities"
        );
      } finally {
        setActivitiesLoading(false);
      }
    }
    fetchActivities();
  }, [id, item?.opportunity.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
          <p className="text-sm text-gray-500">Loading opportunity...</p>
        </div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white border border-red-200 rounded-xl p-8 max-w-md text-center">
          <h2 className="text-lg font-semibold text-red-900 mb-2">
            {error ?? "Opportunity not found"}
          </h2>
          <button
            onClick={() => router.push("/")}
            className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Back to queue
          </button>
        </div>
      </div>
    );
  }

  const { opportunity } = item;
  const status = getStatusConfig(opportunity.queueStatus);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Back button */}
        <button
          onClick={() => router.push("/")}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
            />
          </svg>
          Back to queue
        </button>

        {/* Header card */}
        <div className="bg-white border border-gray-200 rounded-xl px-6 py-5">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold text-gray-900">
                  {opportunity.accountName}
                </h1>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                    status.bgColor,
                    status.textColor
                  )}
                >
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", status.dotColor)}
                  />
                  {status.label}
                </span>
              </div>
              <p className="text-sm text-gray-500">
                {opportunity.opportunityName}
              </p>
            </div>
          </div>

          {/* Key metrics row */}
          <div className="mt-4 flex items-center gap-6 text-sm flex-wrap">
            <div>
              <span className="text-gray-500">ARR</span>{" "}
              <span className="font-semibold text-gray-900">
                {formatCurrency(opportunity.arr)}
              </span>
            </div>
            <div className="h-4 w-px bg-gray-300" />
            <div>
              <span className="text-gray-500">Close Date</span>{" "}
              <span className="font-semibold text-gray-900">
                {formatDate(opportunity.closeDate)}
              </span>
            </div>
            <div className="h-4 w-px bg-gray-300" />
            <div>
              <span className="text-gray-500">Rep</span>{" "}
              <span className="font-semibold text-gray-900">
                {opportunity.owner}
              </span>
            </div>
            <div className="h-4 w-px bg-gray-300" />
            <div>
              <span className="text-gray-500">Stage</span>{" "}
              <span className="font-semibold text-gray-900">
                {opportunity.stage}
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
        </div>

        {/* Activities loading banner */}
        {activitiesLoading && (
          <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
            <span className="text-sm text-blue-700">
              Loading activity history from Salesforce...
            </span>
          </div>
        )}

        {activitiesError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <span className="text-sm text-amber-700">
              Could not load activity history: {activitiesError}
            </span>
          </div>
        )}

        {/* Main details — reuse ExpandedDetails component */}
        <div className="bg-white border border-gray-200 rounded-xl">
          <ExpandedDetails item={item} />
        </div>
      </div>
    </div>
  );
}
