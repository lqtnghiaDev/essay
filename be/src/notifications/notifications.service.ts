import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Notification, NotificationType } from './entities/notification.entity';
import { NotificationsGateway } from './notifications.gateway';

export interface CreateNotificationDto {
  recipientId: string;
  senderId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
}

/** Số ms coi là trùng (cùng 1 hành động gửi 2 lần) */
const DEDUP_WINDOW_MS = 120000; // 2 phút

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  /**
   * Kiểm tra đã có thông báo trùng (cùng recipient, type, và business key) trong thời gian gần đây chưa
   */
  private async findRecentDuplicate(
    dto: CreateNotificationDto,
  ): Promise<Notification | null> {
    const since = new Date(Date.now() - DEDUP_WINDOW_MS);
    const key =
      dto.data?.assignmentId ??
      dto.data?.attendanceId ??
      dto.data?.trainingPlanId;
    if (key == null) return null;

    const recent = await this.notificationRepository.find({
      where: {
        recipientId: dto.recipientId,
        type: dto.type,
        createdAt: MoreThanOrEqual(since),
      },
      order: { createdAt: 'DESC' },
      take: 20,
    });

    const sameKey = (n: Notification) => {
      const k =
        n.data?.assignmentId ?? n.data?.attendanceId ?? n.data?.trainingPlanId;
      return (
        k != null &&
        k === key &&
        new Date(n.createdAt).getTime() >= since.getTime()
      );
    };
    return recent.find(sameKey) ?? null;
  }

  /**
   * Tạo thông báo trong DB và gửi realtime qua WebSocket.
   * Nếu đã có thông báo trùng (cùng type + assignmentId/attendanceId/trainingPlanId) trong 2 phút thì bỏ qua.
   */
  async createAndSend(
    dto: CreateNotificationDto,
  ): Promise<Notification | null> {
    const duplicate = await this.findRecentDuplicate(dto);
    if (duplicate) {
      return duplicate;
    }

    const notification = this.notificationRepository.create(dto);
    const saved = await this.notificationRepository.save(notification);

    // Gửi realtime qua WebSocket
    this.notificationsGateway.sendNotificationToUser(dto.recipientId, saved);

    return saved;
  }

  /**
   * Lấy danh sách thông báo của user (50 gần nhất)
   */
  async findAllByUser(userId: string): Promise<Notification[]> {
    return this.notificationRepository.find({
      where: { recipientId: userId },
      relations: ['sender'],
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  /**
   * Đếm số thông báo chưa đọc
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationRepository.count({
      where: { recipientId: userId, isRead: false },
    });
  }

  /**
   * Đánh dấu đã đọc 1 thông báo
   */
  async markAsRead(id: string, userId: string): Promise<void> {
    const notification = await this.notificationRepository.findOne({
      where: { id, recipientId: userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    notification.isRead = true;
    await this.notificationRepository.save(notification);
  }

  /**
   * Đánh dấu tất cả thông báo đã đọc
   */
  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationRepository.update(
      { recipientId: userId, isRead: false },
      { isRead: true },
    );
  }

  /**
   * Delete a notification for the recipient
   */
  async remove(id: string, userId: string): Promise<void> {
    const notification = await this.notificationRepository.findOne({
      where: { id, recipientId: userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.notificationRepository.remove(notification);
  }
}
