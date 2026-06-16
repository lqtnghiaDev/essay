import { AssignmentStatus } from "@/types/trainingPlan.type";
import { PayloadGet } from "./../types/common.type";

export const getStatusColor = (status: AssignmentStatus): string => {
  switch (status) {
    case "Todo":
      return "bg-gray-100 text-gray-800 border border-gray-200";
    case "InProgress":
      return "bg-blue-100 text-blue-800 border border-blue-200";
    case "Submitted":
      return "bg-yellow-100 text-yellow-800 border border-yellow-200";
    case "Reviewed":
      return "bg-green-100 text-green-800 border border-green-200";
    default:
      return "bg-gray-100 text-gray-800 border border-gray-200";
  }
};

export const buildPagingUrlQuery = <
  T extends Record<string, string | number | boolean | undefined | null>
>(
  payload: PayloadGet<T>
): string => {
  const baseParams = new URLSearchParams();

  const { page, limit } = payload;

  baseParams.set("page", String(page));
  baseParams.set("limit", String(limit));

  if (payload.search) {
    baseParams.set("search", payload.search);
  }
  if (payload.filter) {
    Object.entries(payload.filter).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        baseParams.set(key, encodeURIComponent(String(value)));
      }
    });
  }
  return `?${baseParams.toString()}`;
};

export const formatTimeOnly = (time: string) => {
  return new Date(time).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
};

export const formatDateTime = (timestamp: string) => {
  const date = new Date(timestamp);
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  // const hours = date.getHours().toString().padStart(2, "0");
  // const minutes = date.getMinutes().toString().padStart(2, "0");
  // return `${day}/${month}/${year} ${hours}:${minutes}`;
  return `${day}/${month}/${year}`;
};

export const formatMonth = (
  timestamp: string,
  format: "number" | "name" = "name"
) => {
  const date = new Date(timestamp);
  if (format === "number") {
    return (date.getMonth() + 1).toString().padStart(2, "0");
  }
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];
  return months[date.getMonth()];
};

const CHAT_TIMEZONE = "Asia/Ho_Chi_Minh";

/** Parse API timestamps as UTC instants (Nest/Postgres typically store UTC). */
export const parseApiDateTime = (value: string | Date): Date => {
  if (value instanceof Date) return value;
  let s = String(value).trim();
  if (!s) return new Date(NaN);

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
    s = s.replace(" ", "T");
  }

  const hasTimezone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasTimezone && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    s = `${s}Z`;
  }

  return new Date(s);
};

export const getUserInitial = (name?: string | null): string => {
  if (!name?.trim()) return "?";
  return name.trim().charAt(0);
};

export const formatChatMessageTime = (value: string | Date): string => {
  const date = parseApiDateTime(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: CHAT_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
};

export const convertTimeToLocal = (timeString: string): string => {
  return formatChatMessageTime(timeString);
};

export const formatDateForInput = (
  dateString: string | null | undefined
): string => {
  if (!dateString) return "";
  try {
    return new Date(dateString).toISOString().split("T")[0];
  } catch {
    return "";
  }
};
