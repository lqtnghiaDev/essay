import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Assignment } from 'src/assignments/entities/assignment.entity';
import { Attendance } from 'src/attendance/entities/attendance.entity';
import { InternInformation } from 'src/interns-information/entities/intern-information.entity';
import { Skill } from 'src/skills/entities/skill.entity';
import { Task } from 'src/tasks/entities/task.entity';
import { TrainingPlan } from 'src/training-plans/entities/training-plan.entity';
import { User } from 'src/users/entities/user.entity';
import { Repository } from 'typeorm';
import type {
  RagDocument,
  RagDocumentMetadata,
} from '../interfaces/rag-document.interface';

@Injectable()
export class DocumentExtractorService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(InternInformation)
    private internInfoRepo: Repository<InternInformation>,
    @InjectRepository(TrainingPlan)
    private planRepo: Repository<TrainingPlan>,
    @InjectRepository(Task)
    private taskRepo: Repository<Task>,
    @InjectRepository(Attendance)
    private attendanceRepo: Repository<Attendance>,
    @InjectRepository(Skill)
    private skillRepo: Repository<Skill>,
    @InjectRepository(Assignment)
    private assignmentRepo: Repository<Assignment>,
  ) { }

  /**
   * Extract documents visible to admin (full system data)
   */
  async extractForAdmin(): Promise<RagDocument[]> {
    const docs: RagDocument[] = [];
    const meta: RagDocumentMetadata = {
      scope: 'admin',
      type: 'system',
      entityId: 'admin',
    };

    const [users, plans, tasks, skills, attendances, assignments, internInfos] =
      await Promise.all([
        this.userRepo.find({
          where: { isDeleted: false },
          select: ['id', 'fullName', 'email', 'username', 'role', 'status'],
        }),
        this.planRepo.find({
          where: { isDeleted: false },
          relations: ['skills', 'skills.skill'],
          select: ['id', 'name', 'description', 'createdBy'],
        }),
        this.taskRepo.find({
          where: { isDeleted: false },
          select: ['id', 'name', 'description', 'createdBy'],
        }),
        this.skillRepo.find({
          where: { isDeleted: false },
          select: ['id', 'name', 'description'],
        }),
        this.attendanceRepo.find({
          relations: ['user'],
          take: 5000,
          order: { date: 'DESC' },
        }),
        this.assignmentRepo.find({
          where: { isDeleted: false },
          relations: [
            'task',
            'trainingPlan',
            'assignee',
            'skills',
            'skills.skill',
          ],
        }),
        this.internInfoRepo.find({
          where: { isDeleted: false },
          relations: ['intern', 'mentor', 'plan'],
        }),
      ]);

    for (const u of users) {
      docs.push({
        content: `User: ${u.fullName} (${u.email}), username: ${u.username}, role: ${u.role}, status: ${u.status}.`,
        metadata: { ...meta, type: 'user', entityId: u.id },
      });
    }
    for (const p of plans) {
      const skillNames =
        p.skills
          ?.map((ps) => ps.skill?.name)
          .filter(Boolean)
          .join(', ') || '—';
      docs.push({
        content: `Kế hoạch đào tạo: ${p.name}. Mô tả: ${p.description || '—'}. Kỹ năng: ${skillNames}.`,
        metadata: { ...meta, type: 'training_plan', entityId: p.id },
      });
    }
    for (const t of tasks) {
      docs.push({
        content: `Task: ${t.name}. Mô tả: ${t.description || '—'}.`,
        metadata: { ...meta, type: 'task', entityId: t.id },
      });
    }
    for (const s of skills) {
      docs.push({
        content: `Kỹ năng: ${s.name}. Mô tả: ${s.description || '—'}.`,
        metadata: { ...meta, type: 'skill', entityId: s.id },
      });
    }
    for (const a of attendances) {
      const uname = a.user?.fullName || a.userId;
      docs.push({
        content: `Điểm danh: ${a.date}, user: ${uname}, hình thức: ${a.workLocation}.`,
        metadata: { ...meta, type: 'attendance', entityId: a.id },
      });
    }
    for (const ii of internInfos) {
      const internName = ii.intern?.fullName || ii.internId;
      const mentorName = ii.mentor?.fullName || ii.mentorId || '—';
      const planName = ii.plan?.name || '—';
      docs.push({
        content: `Thực tập sinh: ${internName}, mentor: ${mentorName}, kế hoạch: ${planName}, lĩnh vực: ${ii.field || '—'}, trạng thái: ${ii.status}, từ ${ii.startDate.toLocaleDateString()} đến ${ii.endDate.toLocaleDateString()}.`,
        metadata: { ...meta, type: 'intern_info', entityId: ii.id },
      });
    }
    for (const a of assignments) {
      const assigneeName = a.assignee?.fullName || a.assignedTo || '—';
      const taskName = a.task?.name || '—';
      const planName = a.trainingPlan?.name || '—';
      const skillNames =
        a.skills
          ?.map((as) => (as as { skill?: { name: string } })?.skill?.name)
          .filter(Boolean)
          .join(', ') || '—';
      docs.push({
        content: `Bài tập: ${taskName}, kế hoạch: ${planName}, giao cho: ${assigneeName}, ước lượng: ${a.estimatedTime}h, trạng thái: ${a.status}, hạn: ${a.dueDate.toLocaleDateString() || '—'}. Kỹ năng: ${skillNames}.`,
        metadata: { ...meta, type: 'assignment', entityId: a.id },
      });
    }

    return docs;
  }

  /**
   * Extract documents visible to a mentor (their interns, plans, tasks, attendance of those interns)
   */
  async extractForMentor(mentorId: string): Promise<RagDocument[]> {
    const docs: RagDocument[] = [];
    const meta: RagDocumentMetadata = {
      scope: 'mentor',
      mentorId,
      type: 'mentor_view',
      entityId: mentorId,
    };

    const internInfos = await this.internInfoRepo.find({
      where: { mentorId, isDeleted: false },
      relations: ['intern', 'plan'],
    });

    const internIds = internInfos.map((ii) => ii.internId);

    for (const ii of internInfos) {
      const internName = ii.intern?.fullName || ii.internId;
      const planName = ii.plan?.name || '—';
      docs.push({
        content: `Thực tập sinh (nhóm của mentor): ${internName}, kế hoạch: ${planName}, lĩnh vực: ${ii.field || '—'}, trạng thái: ${ii.status}, từ ${ii.startDate.toLocaleDateString()} đến ${ii.endDate.toLocaleDateString()}.`,
        metadata: {
          ...meta,
          type: 'intern_info',
          entityId: ii.id,
          internId: ii.internId,
        },
      });
    }

    if (internIds.length === 0) return docs;

    const [attendances, assignments] = await Promise.all([
      this.attendanceRepo
        .createQueryBuilder('a')
        .leftJoinAndSelect('a.user', 'u')
        .where('a.userId IN (:...ids)', { ids: internIds })
        .orderBy('a.date', 'DESC')
        .take(1000)
        .getMany(),
      this.assignmentRepo
        .createQueryBuilder('a')
        .leftJoinAndSelect('a.task', 't')
        .leftJoinAndSelect('a.trainingPlan', 'p')
        .leftJoinAndSelect('a.assignee', 'u')
        .leftJoinAndSelect('a.skills', 'as')
        .leftJoinAndSelect('as.skill', 'sk')
        .where('a.assignedTo IN (:...ids)', { ids: internIds })
        .andWhere('a.isDeleted = :del', { del: false })
        .getMany(),
    ]);

    for (const a of attendances) {
      const uname = a.user?.fullName || a.userId;
      docs.push({
        content: `Điểm danh (nhóm mentor): ${a.date}, thực tập sinh: ${uname}, hình thức: ${a.workLocation}.`,
        metadata: {
          ...meta,
          type: 'attendance',
          entityId: a.id,
          internId: a.userId,
        },
      });
    }
    for (const a of assignments) {
      const assigneeName = a.assignee?.fullName || a.assignedTo || '—';
      const taskName = a.task?.name || '—';
      const planName = a.trainingPlan?.name || '—';
      const skillNames =
        (a.skills as Array<{ skill?: { name: string } }>)
          ?.map((as) => as?.skill?.name)
          .filter(Boolean)
          .join(', ') || '—';
      docs.push({
        content: `Bài tập (nhóm mentor): ${taskName}, kế hoạch: ${planName}, giao cho: ${assigneeName}, ước lượng: ${a.estimatedTime}h, trạng thái: ${a.status}. Kỹ năng: ${skillNames}.`,
        metadata: {
          ...meta,
          type: 'assignment',
          entityId: a.id,
          internId: a.assignedTo,
        },
      });
    }

    return docs;
  }

  /**
   * Extract documents visible to an intern (only their own data)
   */
  async extractForIntern(internId: string): Promise<RagDocument[]> {
    const docs: RagDocument[] = [];
    const meta: RagDocumentMetadata = {
      scope: 'intern',
      internId,
      type: 'intern_view',
      entityId: internId,
    };

    const [internInfo, attendances, assignments] = await Promise.all([
      this.internInfoRepo.findOne({
        where: { internId, isDeleted: false },
        relations: ['intern', 'mentor', 'plan'],
      }),
      this.attendanceRepo.find({
        where: { userId: internId },
        order: { date: 'DESC' },
        take: 500,
      }),
      this.assignmentRepo.find({
        where: { assignedTo: internId, isDeleted: false },
        relations: ['task', 'trainingPlan', 'skills', 'skills.skill'],
      }),
    ]);

    if (internInfo) {
      const mentorName =
        internInfo.mentor?.fullName || internInfo.mentorId || '—';
      const planName = internInfo.plan?.name || '—';
      docs.push({
        content: `Thông tin thực tập của tôi: mentor: ${mentorName}, kế hoạch: ${planName}, lĩnh vực: ${internInfo.field || '—'}, trạng thái: ${internInfo.status}, từ ${internInfo.startDate.toLocaleDateString()} đến ${internInfo.endDate.toLocaleDateString()}.`,
        metadata: { ...meta, type: 'intern_info', entityId: internInfo.id },
      });
    }

    for (const a of attendances) {
      docs.push({
        content: `Điểm danh của tôi: ngày ${a.date}, hình thức: ${a.workLocation}.`,
        metadata: { ...meta, type: 'attendance', entityId: a.id },
      });
    }
    for (const a of assignments) {
      const taskName = a.task?.name || '—';
      const planName = a.trainingPlan?.name || '—';
      const skillNames =
        (a.skills as Array<{ skill?: { name: string } }>)
          ?.map((as) => as?.skill?.name)
          .filter(Boolean)
          .join(', ') || '—';
      docs.push({
        content: `Bài tập của tôi: ${taskName}, kế hoạch: ${planName}, ước lượng: ${a.estimatedTime}h, trạng thái: ${a.status}, hạn: ${a.dueDate.toLocaleDateString() || '—'}. Kỹ năng: ${skillNames}. ${a.feedback ? `Phản hồi: ${a.feedback}` : ''}`,
        metadata: { ...meta, type: 'assignment', entityId: a.id },
      });
    }

    return docs;
  }

  /**
   * Get all mentor IDs (users with role mentor)
   */
  async getAllMentorIds(): Promise<string[]> {
    const users = await this.userRepo.find({
      where: { role: 'mentor', isDeleted: false },
      select: ['id'],
    });
    return users.map((u) => u.id);
  }

  /**
   * Get all intern IDs
   */
  async getAllInternIds(): Promise<string[]> {
    const infos = await this.internInfoRepo.find({
      where: { isDeleted: false },
      select: ['internId'],
    });
    return [...new Set(infos.map((i) => i.internId))];
  }
}
