import {
  Injectable,
  InternalServerErrorException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Attendance } from './entities/attendance.entity';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { User } from 'src/users/entities/user.entity';
import { InternInformation } from 'src/interns-information/entities/intern-information.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { NotificationType } from 'src/notifications/entities/notification.entity';

const OFFICE_LOCATION = {
  latitude: 16.464306999999998, // Vĩ độ công ty
  longitude: 107.59534983333333, // Kinh độ công ty
  radiusMeters: 100, // Bán kính cho phép (mét)
};

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(Attendance)
    private readonly attendanceRepository: Repository<Attendance>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(InternInformation)
    private readonly internInfoRepository: Repository<InternInformation>,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Tính khoảng cách giữa 2 tọa độ GPS bằng công thức Haversine
   * @returns khoảng cách tính bằng mét
   */
  private haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371000; // Bán kính Trái Đất (mét)
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Intern đăng ký chấm công
  async registerAttendance(userId: string, dto: CreateAttendanceDto) {
    try {
      // Nếu chọn "office", kiểm tra vị trí GPS
      if (dto.workLocation === 'office') {
        if (dto.latitude == null || dto.longitude == null) {
          throw new BadRequestException(
            'Cần cung cấp vị trí GPS để chấm công tại công ty',
          );
        }

        const distance = this.haversineDistance(
          dto.latitude,
          dto.longitude,
          OFFICE_LOCATION.latitude,
          OFFICE_LOCATION.longitude,
        );

        if (distance > OFFICE_LOCATION.radiusMeters) {
          throw new BadRequestException(
            `Bạn đang ở cách công ty ${Math.round(distance)}m. Cần ở trong phạm vi ${OFFICE_LOCATION.radiusMeters}m để chấm công tại công ty.`,
          );
        }
      }

      // Kiểm tra đã đăng ký chưa
      const existing = await this.attendanceRepository.findOne({
        where: { userId, date: dto.date },
      });

      if (existing) {
        // Cập nhật nếu đã tồn tại
        existing.workLocation = dto.workLocation;
        return await this.attendanceRepository.save(existing);
      }

      // Tạo mới
      const attendance = this.attendanceRepository.create({
        userId,
        date: dto.date,
        workLocation: dto.workLocation,
      });
      const savedAttendance = await this.attendanceRepository.save(attendance);

      // Gửi thông báo cho mentor (có tên intern)
      try {
        const internInfo = await this.internInfoRepository.findOne({
          where: { internId: userId, isDeleted: false },
        });
        if (internInfo?.mentorId) {
          const intern = await this.userRepository.findOne({
            where: { id: userId },
            select: ['fullName', 'username'],
          });
          const senderName = intern?.fullName || intern?.username || 'Intern';
          await this.notificationsService.createAndSend({
            recipientId: internInfo.mentorId,
            senderId: userId,
            type: NotificationType.ATTENDANCE_REGISTERED,
            title: 'New attendance record',
            message: `${senderName} checked in for ${dto.date}`,
            data: {
              attendanceId: savedAttendance.id,
              date: dto.date,
              workLocation: dto.workLocation,
            },
          });
        }
      } catch (notifError) {
        console.error('Failed to send notification:', notifError.message);
      }

      return savedAttendance;
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException
      )
        throw error;
      throw new InternalServerErrorException(
        'Error registering attendance: ' + error.message,
      );
    }
  }

  // Lấy chấm công theo tuần cho intern
  async getMyWeekAttendance(userId: string, weekStart: string) {
    try {
      const startDate = new Date(weekStart);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);

      const attendances = await this.attendanceRepository.find({
        where: {
          userId,
          date: Between(
            startDate.toISOString().split('T')[0],
            endDate.toISOString().split('T')[0],
          ),
        },
        order: { date: 'ASC' },
      });

      return this.buildWeekView(startDate, attendances);
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching week attendance: ' + error.message,
      );
    }
  }

  // Mentor xem chấm công intern của mình
  async getMentorWeekView(mentorId: string, weekStart: string) {
    try {
      const startDate = new Date(weekStart);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);

      // Lấy danh sách intern của mentor
      const internInfos = await this.internInfoRepository.find({
        where: { mentorId, isDeleted: false },
        relations: ['intern'],
      });

      const internIds = internInfos.map((info) => info.internId);

      if (internIds.length === 0) {
        return [];
      }

      // Lấy attendance của tất cả intern
      const attendances = await this.attendanceRepository
        .createQueryBuilder('attendance')
        .leftJoinAndSelect('attendance.user', 'user')
        .where('attendance.userId IN (:...internIds)', { internIds })
        .andWhere('attendance.date BETWEEN :start AND :end', {
          start: startDate.toISOString().split('T')[0],
          end: endDate.toISOString().split('T')[0],
        })
        .orderBy('attendance.date', 'ASC')
        .getMany();

      // Nhóm theo intern
      return internInfos.map((info) => {
        const internAttendances = attendances.filter(
          (a) => a.userId === info.internId,
        );
        return {
          internId: info.internId,
          internName: info.intern?.fullName || 'Unknown',
          field: info.field,
          weekData: this.buildWeekView(startDate, internAttendances),
        };
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching mentor week view: ' + error.message,
      );
    }
  }

  // Admin xem tất cả chấm công
  async getAdminWeekView(weekStart: string) {
    try {
      const startDate = new Date(weekStart);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);

      // Lấy tất cả intern
      const internInfos = await this.internInfoRepository.find({
        where: { isDeleted: false },
        relations: ['intern', 'mentor'],
      });

      const internIds = internInfos.map((info) => info.internId);

      if (internIds.length === 0) {
        return { interns: [], stats: this.getEmptyStats() };
      }

      // Lấy tất cả attendance trong tuần
      const attendances = await this.attendanceRepository
        .createQueryBuilder('attendance')
        .leftJoinAndSelect('attendance.user', 'user')
        .where('attendance.userId IN (:...internIds)', { internIds })
        .andWhere('attendance.date BETWEEN :start AND :end', {
          start: startDate.toISOString().split('T')[0],
          end: endDate.toISOString().split('T')[0],
        })
        .orderBy('attendance.date', 'ASC')
        .getMany();

      const todayStr = new Date().toISOString().split('T')[0];

      const interns = internInfos.map((info) => {
        const internAttendances = attendances.filter(
          (a) => a.userId === info.internId,
        );
        return {
          internId: info.internId,
          internName: info.intern?.fullName || 'Unknown',
          mentorName: info.mentor?.fullName || 'Chưa phân công',
          field: info.field,
          weekData: this.buildWeekView(startDate, internAttendances),
        };
      });

      // Stats cho dashboard
      const todayAttendances = attendances.filter((a) => a.date === todayStr);
      const stats = {
        totalInterns: internInfos.length,
        registeredToday: todayAttendances.length,
        officeToday: todayAttendances.filter((a) => a.workLocation === 'office')
          .length,
        remoteToday: todayAttendances.filter((a) => a.workLocation === 'remote')
          .length,
        notRegisteredToday: internInfos.length - todayAttendances.length,
        weeklyRegistrationRate:
          internInfos.length > 0
            ? Math.round((attendances.length / (internInfos.length * 7)) * 100)
            : 0,
      };

      return { interns, stats };
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching admin week view: ' + error.message,
      );
    }
  }

  // Thống kê chấm công
  async getAttendanceStats(
    userId?: string,
    startDate?: string,
    endDate?: string,
  ) {
    try {
      const query = this.attendanceRepository.createQueryBuilder('attendance');

      if (userId) {
        query.where('attendance.userId = :userId', { userId });
      }

      if (startDate && endDate) {
        query.andWhere('attendance.date BETWEEN :start AND :end', {
          start: startDate,
          end: endDate,
        });
      }

      const attendances = await query.getMany();

      const totalDays =
        startDate && endDate
          ? this.getDaysBetween(new Date(startDate), new Date(endDate))
          : 0;

      return {
        totalRegistered: attendances.length,
        officeDays: attendances.filter((a) => a.workLocation === 'office')
          .length,
        remoteDays: attendances.filter((a) => a.workLocation === 'remote')
          .length,
        notRegistered: totalDays > 0 ? totalDays - attendances.length : 0,
        totalDays,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching attendance stats: ' + error.message,
      );
    }
  }

  // Xóa chấm công
  async deleteAttendance(id: string, userId: string) {
    const attendance = await this.attendanceRepository.findOne({
      where: { id },
    });

    if (!attendance) {
      throw new NotFoundException('Attendance record not found');
    }

    if (attendance.userId !== userId) {
      throw new ForbiddenException(
        'You can only delete your own attendance records',
      );
    }

    await this.attendanceRepository.remove(attendance);
    return { message: 'Attendance deleted successfully' };
  }

  // Lấy chấm công theo tháng cho intern (calendar view)
  async getMyMonthAttendance(userId: string, month: string) {
    try {
      const [year, monthNum] = month.split('-').map(Number);
      const startDate = new Date(year, monthNum - 1, 1);
      const endDate = new Date(year, monthNum, 0);

      const attendances = await this.attendanceRepository.find({
        where: {
          userId,
          date: Between(
            startDate.toISOString().split('T')[0],
            endDate.toISOString().split('T')[0],
          ),
        },
        order: { date: 'ASC' },
      });

      return this.buildMonthView(startDate, endDate, attendances);
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching month attendance: ' + error.message,
      );
    }
  }

  // Mentor xem chấm công intern theo tháng
  async getMentorMonthView(mentorId: string, month: string) {
    try {
      const [year, monthNum] = month.split('-').map(Number);
      const startDate = new Date(year, monthNum - 1, 1);
      const endDate = new Date(year, monthNum, 0);

      const internInfos = await this.internInfoRepository.find({
        where: { mentorId, isDeleted: false },
        relations: ['intern'],
      });
      const internIds = internInfos.map((info) => info.internId);

      if (internIds.length === 0) return [];

      const attendances = await this.attendanceRepository
        .createQueryBuilder('attendance')
        .leftJoinAndSelect('attendance.user', 'user')
        .where('attendance.userId IN (:...internIds)', { internIds })
        .andWhere('attendance.date BETWEEN :start AND :end', {
          start: startDate.toISOString().split('T')[0],
          end: endDate.toISOString().split('T')[0],
        })
        .orderBy('attendance.date', 'ASC')
        .getMany();

      return internInfos.map((info) => {
        const internAttendances = attendances.filter(
          (a) => a.userId === info.internId,
        );
        return {
          internId: info.internId,
          internName: info.intern?.fullName || 'Unknown',
          field: info.field,
          monthData: this.buildMonthView(startDate, endDate, internAttendances),
        };
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching mentor month view: ' + error.message,
      );
    }
  }

  // Admin xem tất cả chấm công theo tháng
  async getAdminMonthView(month: string) {
    try {
      const [year, monthNum] = month.split('-').map(Number);
      const startDate = new Date(year, monthNum - 1, 1);
      const endDate = new Date(year, monthNum, 0);

      const internInfos = await this.internInfoRepository.find({
        where: { isDeleted: false },
        relations: ['intern', 'mentor'],
      });
      const internIds = internInfos.map((info) => info.internId);

      if (internIds.length === 0) {
        return { interns: [], stats: this.getEmptyStats() };
      }

      const attendances = await this.attendanceRepository
        .createQueryBuilder('attendance')
        .leftJoinAndSelect('attendance.user', 'user')
        .where('attendance.userId IN (:...internIds)', { internIds })
        .andWhere('attendance.date BETWEEN :start AND :end', {
          start: startDate.toISOString().split('T')[0],
          end: endDate.toISOString().split('T')[0],
        })
        .orderBy('attendance.date', 'ASC')
        .getMany();

      const todayStr = new Date().toISOString().split('T')[0];

      const interns = internInfos.map((info) => {
        const internAttendances = attendances.filter(
          (a) => a.userId === info.internId,
        );
        return {
          internId: info.internId,
          internName: info.intern?.fullName || 'Unknown',
          mentorName: info.mentor?.fullName || 'Chưa phân công',
          field: info.field,
          monthData: this.buildMonthView(startDate, endDate, internAttendances),
        };
      });

      const totalDays = endDate.getDate();
      const totalSlots = internInfos.length * totalDays;
      const registeredCount = attendances.length;
      const monthlyRate =
        totalSlots > 0 ? Math.round((registeredCount / totalSlots) * 100) : 0;
      const todayAttendances = attendances.filter((a) => a.date === todayStr);
      const stats = {
        ...this.getEmptyStats(),
        totalInterns: internInfos.length,
        registeredToday: todayAttendances.length,
        officeToday: todayAttendances.filter((a) => a.workLocation === 'office')
          .length,
        remoteToday: todayAttendances.filter((a) => a.workLocation === 'remote')
          .length,
        notRegisteredToday: internInfos.length - todayAttendances.length,
        weeklyRegistrationRate: monthlyRate,
      };

      return { interns, stats };
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching admin month view: ' + error.message,
      );
    }
  }

  private buildMonthView(
    startDate: Date,
    endDate: Date,
    attendances: Attendance[],
  ) {
    const days: Array<{
      date: string;
      dayOfWeek: string;
      dayNumber: number;
      attendance: { id: string; workLocation: string; createdAt: Date } | null;
    }> = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const attendance = attendances.find((a) => a.date === dateStr);
      days.push({
        date: dateStr,
        dayOfWeek: current.toLocaleDateString('en-US', { weekday: 'short' }),
        dayNumber: current.getDate(),
        attendance: attendance
          ? {
              id: attendance.id,
              workLocation: attendance.workLocation,
              createdAt: attendance.createdAt,
            }
          : null,
      });
      current.setDate(current.getDate() + 1);
    }
    return days;
  }

  // Helper: Build 7 ngày cho tuần
  private buildWeekView(startDate: Date, attendances: Attendance[]) {
    const days: Array<{
      date: string;
      dayOfWeek: string;
      dayNumber: number;
      attendance: { id: string; workLocation: string; createdAt: Date } | null;
    }> = [];
    for (let i = 0; i < 7; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(currentDate.getDate() + i);
      const dateStr = currentDate.toISOString().split('T')[0];

      const attendance = attendances.find((a) => a.date === dateStr);
      days.push({
        date: dateStr,
        dayOfWeek: currentDate.toLocaleDateString('en-US', {
          weekday: 'short',
        }),
        dayNumber: currentDate.getDate(),
        attendance: attendance
          ? {
              id: attendance.id,
              workLocation: attendance.workLocation,
              createdAt: attendance.createdAt,
            }
          : null,
      });
    }
    return days;
  }

  private getEmptyStats() {
    return {
      totalInterns: 0,
      registeredToday: 0,
      officeToday: 0,
      remoteToday: 0,
      notRegisteredToday: 0,
      weeklyRegistrationRate: 0,
    };
  }

  private getDaysBetween(start: Date, end: Date): number {
    const diffTime = Math.abs(end.getTime() - start.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  }
}
