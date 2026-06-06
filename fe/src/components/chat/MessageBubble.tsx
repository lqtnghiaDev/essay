"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Message, SenderRole } from "@/types/chat.type";
import { useAuthStore } from "@/store/useAuthStore";
import { formatChatMessageTime, getUserInitial } from "@/lib/helper";
import styles from "./MessageBubble.module.css";

interface MessageBubbleProps {
  message: Message;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const { userDetails } = useAuthStore();
  const isUser = message.sender === SenderRole.USER;

  return (
    <div
      className={`${styles.bubble} ${isUser ? styles.user : styles.assistant}`}
    >
      <Avatar className={`${styles.avatar} w-10 h-10 shrink-0`}>
        <AvatarImage src="" />
        <AvatarFallback
          className={
            isUser
              ? "bg-blue-300 border text-sm font-medium"
              : "bg-blue-600 text-white text-sm font-medium"
          }
        >
          {isUser ? getUserInitial(userDetails?.name) : "AI"}
        </AvatarFallback>
      </Avatar>
      <div className={styles.content}>
        <p className={styles.messageText}>{message.content}</p>
        <span className={styles.time}>
          {formatChatMessageTime(message.createdAt)}
        </span>
      </div>
    </div>
  );
}
