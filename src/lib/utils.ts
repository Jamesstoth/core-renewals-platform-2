import { QueueStatus } from "@/types/renewals";

export function getStatusConfig(status: QueueStatus) {
  const map: Record<
    QueueStatus,
    { label: string; bgColor: string; textColor: string; dotColor: string }
  > = {
    [QueueStatus.OverdueFollowUp]: {
      label: "Overdue follow-up",
      bgColor: "bg-red-100",
      textColor: "text-red-800",
      dotColor: "bg-red-500",
    },
    [QueueStatus.NeedsFollowUpThisWeek]: {
      label: "Needs follow-up this week",
      bgColor: "bg-amber-100",
      textColor: "text-amber-800",
      dotColor: "bg-amber-500",
    },
    [QueueStatus.RecentlyContacted]: {
      label: "Recently contacted",
      bgColor: "bg-green-100",
      textColor: "text-green-800",
      dotColor: "bg-green-500",
    },
    [QueueStatus.WaitingOnCustomer]: {
      label: "Waiting on customer",
      bgColor: "bg-blue-100",
      textColor: "text-blue-800",
      dotColor: "bg-blue-500",
    },
    [QueueStatus.WaitingOnInternalAction]: {
      label: "Waiting on internal action",
      bgColor: "bg-purple-100",
      textColor: "text-purple-800",
      dotColor: "bg-purple-500",
    },
    [QueueStatus.NoActionNeeded]: {
      label: "No action needed",
      bgColor: "bg-gray-100",
      textColor: "text-gray-700",
      dotColor: "bg-gray-400",
    },
    [QueueStatus.NeedsRepReview]: {
      label: "Needs rep review",
      bgColor: "bg-orange-100",
      textColor: "text-orange-800",
      dotColor: "bg-orange-500",
    },
  };
  return map[status];
}

export function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function cn(
  ...classes: (string | false | undefined | null)[]
): string {
  return classes.filter(Boolean).join(" ");
}
