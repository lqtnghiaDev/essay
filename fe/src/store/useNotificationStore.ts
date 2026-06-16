"use client";

import { Notification } from "@/types/notification.type";
import { create } from "zustand";

type NotificationState = {
  notifications: Notification[];
  unreadCount: number;
};

type NotificationActions = {
  setNotifications: (notifications: Notification[]) => void;
  addNotification: (notification: Notification) => void;
  setUnreadCount: (count: number) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
};

export const useNotificationStore = create<
  NotificationState & NotificationActions
>((set) => ({
  notifications: [],
  unreadCount: 0,

  setNotifications: (notifications) =>
    set({
      notifications,
      unreadCount: notifications.filter((n) => !n.isRead).length
    }),

  addNotification: (notification) =>
    set((state) => {
      // Tránh thêm trùng: cùng id (socket gửi 2 lần) hoặc cùng type + data trong 5s (backend/API gọi 2 lần)
      if (state.notifications.some((n) => n.id === notification.id)) {
        return state;
      }
      const now = Date.now();
      const isDuplicateByTypeAndData = state.notifications.some((n) => {
        if (n.type !== notification.type) return false;
        const key = n.data?.assignmentId ?? n.data?.attendanceId ?? n.data?.trainingPlanId;
        const newKey = notification.data?.assignmentId ?? notification.data?.attendanceId ?? notification.data?.trainingPlanId;
        if (key != null && newKey != null && key === newKey) {
          const nTime = new Date(n.createdAt).getTime();
          return Math.abs(now - nTime) < 5000;
        }
        return false;
      });
      if (isDuplicateByTypeAndData) return state;
      return {
        notifications: [notification, ...state.notifications],
        unreadCount: state.unreadCount + 1
      };
    }),

  setUnreadCount: (count) => set({ unreadCount: count }),

  markAsRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, isRead: true } : n
      ),
      unreadCount: Math.max(0, state.unreadCount - 1)
    })),

  markAllAsRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0
    })),

  removeNotification: (id) =>
    set((state) => {
      const notification = state.notifications.find((n) => n.id === id);
      return {
        notifications: state.notifications.filter((n) => n.id !== id),
        unreadCount:
          notification && !notification.isRead
            ? Math.max(0, state.unreadCount - 1)
            : state.unreadCount
      };
    })
}));
