import { del, get, put } from "./api.services";
import { Notification } from "@/types/notification.type";

export const notificationServices = {
  getNotifications: () => get<Notification[]>("/notifications"),

  getUnreadCount: () => get<{ count: number }>("/notifications/unread-count"),

  markAsRead: (id: string) => put(`/notifications/${id}/read`),

  markAllAsRead: () => put("/notifications/read-all"),

  deleteNotification: (id: string) => del(`/notifications/${id}`)
};
