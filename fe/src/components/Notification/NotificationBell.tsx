"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bell, Trash2 } from "lucide-react";
import React, { useState } from "react";
import { useNotificationStore } from "@/store/useNotificationStore";
import { notificationServices } from "@/services/notification.services";
import { Notification } from "@/types/notification.type";
import { formatDistanceToNow } from "date-fns";
import { enUS } from "date-fns/locale";

const NotificationBell = () => {
  const [open, setOpen] = useState(false);
  const {
    notifications,
    unreadCount,
    markAsRead: markAsReadStore,
    markAllAsRead: markAllAsReadStore,
    removeNotification: removeNotificationStore,
  } = useNotificationStore();

  const handleMarkAsRead = async (id: string) => {
    try {
      await notificationServices.markAsRead(id);
      markAsReadStore(id);
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationServices.markAllAsRead();
      markAllAsReadStore();
    } catch (error) {
      console.error("Failed to mark all as read:", error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await notificationServices.deleteNotification(id);
      removeNotificationStore(id);
    } catch (error) {
      console.error("Failed to delete notification:", error);
    }
  };

  const formatTime = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), {
        addSuffix: true,
        locale: enUS,
      });
    } catch {
      return dateStr;
    }
  };

  const getInitials = (name?: string) => {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 min-w-5 h-5 px-1 flex items-center justify-center text-xs"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-96 p-0 z-[9999] rounded-lg shadow-lg border border-gray-200"
        align="end"
      >
        <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
          <h3 className="text-lg font-semibold">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-blue-600 hover:text-blue-700"
              onClick={handleMarkAllAsRead}
            >
              Mark all as read
            </Button>
          )}
        </div>

        <ScrollArea className="h-[400px]">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              No notifications yet
            </div>
          ) : (
            notifications.map((notification: Notification) => (
              <div
                key={notification.id}
                className={`flex items-start gap-3 px-4 py-3 hover:bg-gray-100 cursor-pointer transition border-b border-gray-100 last:border-0 ${
                  !notification.isRead ? "bg-blue-50/50" : ""
                }`}
                onClick={() => {
                  if (!notification.isRead) {
                    handleMarkAsRead(notification.id);
                  }
                }}
              >
                <Avatar className="w-10 h-10 shrink-0">
                  <AvatarImage src="" />
                  <AvatarFallback className="bg-blue-600 text-white text-sm">
                    {getInitials(notification.sender?.fullName)}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0 text-sm">
                  <p className="font-medium text-gray-900">
                    {notification.title}
                  </p>
                  <p className="text-gray-600 mt-0.5">{notification.message}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {formatTime(notification.createdAt)}
                  </p>
                </div>

                <div className="flex flex-col items-center gap-1 shrink-0 mt-1">
                  {!notification.isRead && (
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-gray-400 hover:text-red-600 hover:bg-red-50"
                    aria-label="Delete notification"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(notification.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
