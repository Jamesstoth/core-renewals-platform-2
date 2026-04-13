"use client";

import { QueueItem } from "@/types/renewals";
import { getStatusConfig, formatDate, cn } from "@/lib/utils";
import ExpandedDetails from "./ExpandedDetails";

interface OpportunityCardProps {
  item: QueueItem;
  isExpanded: boolean;
  onToggle: () => void;
}

export default function OpportunityCard({
  item,
  isExpanded,
  onToggle,
}: OpportunityCardProps) {
  const { opportunity } = item;
  const status = getStatusConfig(opportunity.queueStatus);

  return (
    <div
      className={cn(
        "bg-white border rounded-xl transition-shadow",
        isExpanded
          ? "border-gray-300 shadow-md"
          : "border-gray-200 hover:shadow-md"
      )}
    >
      {/* Collapsed header — always visible */}
      <button
        onClick={onToggle}
        className="w-full text-left px-6 py-4 flex items-center gap-4"
      >
        {/* Status pill */}
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
            status.bgColor,
            status.textColor
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", status.dotColor)} />
          {status.label}
        </span>

        {/* Account & opportunity name */}
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-gray-900">
            {opportunity.accountName}
          </span>
          <span className="text-gray-400 mx-1.5">·</span>
          <span className="text-sm text-gray-600 truncate">
            {opportunity.opportunityName}
          </span>
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-4 text-sm text-gray-500 shrink-0">
          <span>{opportunity.owner}</span>
          <span className="hidden xl:inline">{opportunity.stage}</span>
          <span className="hidden xl:inline">
            {formatDate(opportunity.renewalDate)}
          </span>
          <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {opportunity.daysSinceLastRenewalCall}d since call
          </span>
          <svg
            className={cn(
              "h-5 w-5 text-gray-400 transition-transform duration-200",
              isExpanded && "rotate-180"
            )}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m19.5 8.25-7.5 7.5-7.5-7.5"
            />
          </svg>
        </div>
      </button>

      {/* Expanded details */}
      {isExpanded && <ExpandedDetails item={item} />}
    </div>
  );
}
