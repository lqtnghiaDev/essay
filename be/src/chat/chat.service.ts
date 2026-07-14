import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Attendance } from '../attendance/entities/attendance.entity';
import { Assignment } from '../assignments/entities/assignment.entity';
import { ChatSession } from './entities/chat-session.entity';
import { Message, SenderRole } from './entities/message.entity';
import { LlmService, ChatMessage } from '../llm/llm.service';
import { RetrievalService } from '../rag/services/retrieval.service';
import { RAG_MEMORY_MESSAGE_LIMIT } from '../rag/rag.constants';
import { InternsInformationService } from '../interns-information/interns-information.service';
import { SimpleUserDto } from '../users/dto/simple-user.dto';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatSession)
    private chatSessionRepository: Repository<ChatSession>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(Attendance)
    private attendanceRepository: Repository<Attendance>,
    @InjectRepository(Assignment)
    private assignmentRepository: Repository<Assignment>,
    private llmService: LlmService,
    private retrievalService: RetrievalService,
    private internsInformationService: InternsInformationService,
  ) {}

  /**
   * Tạo phiên chat mới
   */
  async createSession(userId: string, role: string): Promise<ChatSession> {
    const session = this.chatSessionRepository.create({
      userId,
      role,
    });
    return this.chatSessionRepository.save(session);
  }

  /**
   * Lấy thông tin phiên chat kèm toàn bộ tin nhắn
   */
  async getSession(sessionId: string): Promise<ChatSession> {
    const session = await this.chatSessionRepository.findOne({
      where: { id: sessionId },
      relations: ['messages'],
      order: { messages: { createdAt: 'ASC' } },
    });

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên chat');
    }

    return session;
  }

  /**
   * Lấy tất cả phiên chat của user
   */
  async getUserSessions(userId: string): Promise<ChatSession[]> {
    return this.chatSessionRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Gửi tin nhắn và nhận phản hồi từ AI (hybrid RAG + memory theo role)
   */
  async sendMessage(
    sessionId: string,
    content: string,
    user: SimpleUserDto,
  ): Promise<{ userMessage: Message; assistantMessage: Message }> {
    const session = await this.chatSessionRepository.findOne({
      where: { id: sessionId },
      relations: ['messages'],
      order: { messages: { createdAt: 'ASC' } },
    });

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên chat');
    }
    if (session.userId !== user.id) {
      throw new ForbiddenException(
        'Bạn không có quyền gửi tin nhắn trong phiên này',
      );
    }

    const directAnswer = await this.buildDirectAnswer(content, user);

    const userMessage = this.messageRepository.create({
      sessionId,
      sender: SenderRole.USER,
      content,
    });
    await this.messageRepository.save(userMessage);

    if (directAnswer) {
      const assistantMessage = this.messageRepository.create({
        sessionId,
        sender: SenderRole.ASSISTANT,
        content: directAnswer,
      });
      await this.messageRepository.save(assistantMessage);

      return { userMessage, assistantMessage };
    }

    const dataContext = await this.buildDataContext(user);
    const role = user.role;

    const filter: { scope: string; mentorId?: string; internId?: string } = {
      scope:
        role === 'admin' ? 'admin' : role === 'mentor' ? 'mentor' : 'intern',
    };
    if (role === 'mentor') filter.mentorId = user.id;
    if (role === 'intern') filter.internId = user.id;

    const ragContext = await this.retrievalService.retrieveContext(
      content,
      filter,
    );

    const messages = this.buildMessagesForLlm(
      session.messages || [],
      content,
      user,
      dataContext,
      ragContext,
    );
    const aiResponse = await this.llmService.generateResponse(messages);

    const assistantMessage = this.messageRepository.create({
      sessionId,
      sender: SenderRole.ASSISTANT,
      content: aiResponse,
    });
    await this.messageRepository.save(assistantMessage);

    return { userMessage, assistantMessage };
  }

  /**
   * Xây dựng messages cho LLM: system (role + RAG context) + memory + query
   */
  private buildMessagesForLlm(
    previousMessages: Message[],
    currentMessage: string,
    user: SimpleUserDto,
    dataContext?: string,
    ragContext?: string,
  ): ChatMessage[] {
    const systemContent = this.llmService.getSystemPrompt({
      role: user.role,
      userContext: this.buildUserContext(user),
      dataContext,
      ragContext: ragContext || undefined,
    });
    const messages: ChatMessage[] = [
      { role: 'system', content: systemContent },
    ];

    const recentMessages = previousMessages.slice(-RAG_MEMORY_MESSAGE_LIMIT);
    for (const msg of recentMessages) {
      messages.push({
        role: msg.sender === SenderRole.USER ? 'user' : 'assistant',
        content: msg.content,
      });
    }
    messages.push({ role: 'user', content: currentMessage });
    return messages;
  }

  private buildUserContext(user: SimpleUserDto): string {
    const lines = [
      `- ID: ${user.id}`,
      `- Họ tên: ${user.fullName || '—'}`,
      `- Username: ${user.username || '—'}`,
      `- Email: ${user.email || '—'}`,
      `- Vai trò: ${user.role}`,
      `- Trạng thái: ${user.status || '—'}`,
    ];

    return lines.join('\n');
  }

  private async buildDataContext(user: SimpleUserDto): Promise<string> {
    if (user.role === 'mentor') {
      const interns = await this.internsInformationService.findByMentorId(
        user.id,
      );

      if (interns.length === 0) {
        return 'Mentor hiện chưa có thực tập sinh nào trong cơ sở dữ liệu.';
      }

      return [
        'Danh sách thực tập sinh của mentor:',
        ...interns.map((internInfo, index) => {
          const internName = internInfo.intern?.fullName || internInfo.internId;
          const planName = internInfo.plan?.name || '—';
          const status = internInfo.status || '—';
          return `${index + 1}. ${internName} | kế hoạch: ${planName} | trạng thái: ${status}`;
        }),
      ].join('\n');
    }

    if (user.role === 'intern') {
      try {
        const internResult =
          await this.internsInformationService.findOneForIntern(user);
        const internInfo = internResult.internInformation;

        return [
          'Thông tin thực tập sinh hiện tại:',
          `- Tên: ${user.fullName || internInfo.intern?.fullName || user.id}`,
          `- Lĩnh vực: ${internInfo.field || '—'}`,
          `- Mentor: ${internInfo.mentor?.fullName || internInfo.mentorId || '—'}`,
          `- Kế hoạch: ${internInfo.plan?.name || internInfo.planId || '—'}`,
          `- Trạng thái: ${internInfo.status || '—'}`,
          `- Từ: ${this.formatDate(internInfo.startDate)}`,
          `- Đến: ${this.formatDate(internInfo.endDate)}`,
          `- Số bài tập: ${internResult.countAssignments.total}`,
          `- Đang làm: ${internResult.countAssignments.inProgress}`,
          `- Đã nộp: ${internResult.countAssignments.submitted}`,
        ].join('\n');
      } catch {
        return 'Chưa có bản ghi thực tập sinh trong cơ sở dữ liệu.';
      }
    }

    return '';
  }

  private async buildDirectAnswer(
    content: string,
    user: SimpleUserDto,
  ): Promise<string | null> {
    const normalized = this.normalizeText(content);

    if (this.isIdentityQuestion(normalized)) {
      return [
        `Bạn là ${user.fullName || user.username || user.email || user.id}.`,
        `Username: ${user.username || '—'}.`,
        `Vai trò: ${user.role}.`,
        `Trạng thái: ${user.status || '—'}.`,
      ].join(' ');
    }

    const attendanceAnswer = await this.buildTodayAttendanceAnswer(
      normalized,
      user,
    );
    if (attendanceAnswer) {
      return attendanceAnswer;
    }

    const assignmentAnswer = await this.buildIncompleteAssignmentsAnswer(
      normalized,
      user,
    );
    if (assignmentAnswer) {
      return assignmentAnswer;
    }

    if (user.role === 'mentor' && this.isMentorInternListQuestion(normalized)) {
      const interns = await this.internsInformationService.findByMentorId(
        user.id,
      );

      if (interns.length === 0) {
        return 'Hiện bạn chưa có thực tập sinh nào trong hệ thống.';
      }

      return [
        'Danh sách thực tập sinh của bạn:',
        ...interns.map((internInfo, index) => {
          const internName = internInfo.intern?.fullName || internInfo.internId;
          const planName = internInfo.plan?.name || '—';
          const status = internInfo.status || '—';
          return `${index + 1}. ${internName} - ${planName} - ${status}`;
        }),
      ].join('\n');
    }

    return null;
  }

  private async buildTodayAttendanceAnswer(
    normalized: string,
    user: SimpleUserDto,
  ): Promise<string | null> {
    if (!this.isTodayAttendanceQuestion(normalized)) {
      return null;
    }

    const today = new Date().toISOString().split('T')[0];

    if (user.role === 'mentor') {
      const internInfos = await this.internsInformationService.findByMentorId(
        user.id,
      );
      const internIds = internInfos.map((info) => info.internId);

      if (internIds.length === 0) {
        return 'Hiện bạn chưa có thực tập sinh nào trong hệ thống.';
      }

      const attendances = await this.attendanceRepository.find({
        where: {
          userId: In(internIds),
          date: today,
        },
        relations: ['user'],
        order: { createdAt: 'ASC' },
      });

      if (attendances.length === 0) {
        return 'Hôm nay chưa có thực tập sinh nào của bạn chấm công.';
      }

      const lines = attendances.map((attendance, index) => {
        const internName = attendance.user?.fullName || attendance.userId;
        const location =
          attendance.workLocation === 'office' ? 'tại công ty' : 'từ xa';
        return `${index + 1}. ${internName} - ${location}`;
      });

      return [`Hôm nay đã chấm công:`, ...lines].join('\n');
    }

    if (user.role === 'intern') {
      const attendance = await this.attendanceRepository.findOne({
        where: {
          userId: user.id,
          date: today,
        },
      });

      if (!attendance) {
        return 'Hôm nay bạn chưa chấm công.';
      }

      const location =
        attendance.workLocation === 'office' ? 'tại công ty' : 'từ xa';
      return `Hôm nay bạn đã chấm công ${location}.`;
    }

    if (user.role === 'admin') {
      const internInfos = await this.internsInformationService.findAll();
      const internIds = internInfos.map((info) => info.internId);

      if (internIds.length === 0) {
        return 'Hiện chưa có thực tập sinh nào trong hệ thống.';
      }

      const attendances = await this.attendanceRepository.find({
        where: {
          userId: In(internIds),
          date: today,
        },
        relations: ['user'],
        order: { createdAt: 'ASC' },
      });

      if (attendances.length === 0) {
        return 'Hôm nay chưa có thực tập sinh nào chấm công.';
      }

      return [
        'Hôm nay đã chấm công:',
        ...attendances.map((attendance, index) => {
          const internName = attendance.user?.fullName || attendance.userId;
          const location =
            attendance.workLocation === 'office' ? 'tại công ty' : 'từ xa';
          return `${index + 1}. ${internName} - ${location}`;
        }),
      ].join('\n');
    }

    return null;
  }

  private async buildIncompleteAssignmentsAnswer(
    normalized: string,
    user: SimpleUserDto,
  ): Promise<string | null> {
    if (!this.isIncompleteAssignmentsQuestion(normalized)) {
      return null;
    }

    if (user.role === 'mentor') {
      const internInfos = await this.internsInformationService.findByMentorId(
        user.id,
      );
      const internIds = internInfos.map((info) => info.internId);

      if (internIds.length === 0) {
        return 'Hiện bạn chưa có thực tập sinh nào trong hệ thống.';
      }

      const assignments = await this.assignmentRepository.find({
        where: {
          assignedTo: In(internIds),
          isDeleted: false,
        },
        relations: ['task', 'assignee'],
        order: { dueDate: 'ASC' },
      });

      const pendingAssignments = assignments.filter(
        (assignment) =>
          assignment.status === 'Todo' || assignment.status === 'InProgress',
      );

      if (pendingAssignments.length === 0) {
        return 'Hiện không có bài tập nào chưa hoàn thành.';
      }

      const internNameById = new Map(
        internInfos.map((info) => [
          info.internId,
          info.intern?.fullName || info.internId,
        ]),
      );

      return [
        'Các bài tập chưa hoàn thành:',
        ...pendingAssignments.map((assignment, index) => {
          const internName =
            internNameById.get(assignment.assignedTo || '') ||
            assignment.assignedTo ||
            '—';
          const taskName = assignment.task?.name || '—';
          return `${index + 1}. ${internName} - ${taskName} - ${assignment.status}`;
        }),
      ].join('\n');
    }

    if (user.role === 'intern') {
      const assignments = await this.assignmentRepository.find({
        where: {
          assignedTo: user.id,
          isDeleted: false,
        },
        relations: ['task'],
        order: { dueDate: 'ASC' },
      });

      const pendingAssignments = assignments.filter(
        (assignment) =>
          assignment.status === 'Todo' || assignment.status === 'InProgress',
      );

      if (pendingAssignments.length === 0) {
        return 'Bạn không còn bài tập nào chưa hoàn thành.';
      }

      return [
        'Các bài tập bạn chưa hoàn thành:',
        ...pendingAssignments.map((assignment, index) => {
          const taskName = assignment.task?.name || '—';
          return `${index + 1}. ${taskName} - ${assignment.status}`;
        }),
      ].join('\n');
    }

    return null;
  }

  private isIdentityQuestion(normalized: string): boolean {
    return (
      normalized.includes('toi la ai') ||
      normalized.includes('who am i') ||
      normalized.includes('ban la ai') ||
      normalized.includes('minh la ai')
    );
  }

  private isMentorInternListQuestion(normalized: string): boolean {
    return (
      normalized.includes('danh sach thuc tap sinh') ||
      normalized.includes('danh sach intern') ||
      normalized.includes('intern cua toi') ||
      normalized.includes('thuc tap sinh cua toi')
    );
  }

  private isTodayAttendanceQuestion(normalized: string): boolean {
    return (
      normalized.includes('hom nay') &&
      (normalized.includes('cham cong') || normalized.includes('diem danh'))
    );
  }

  private isIncompleteAssignmentsQuestion(normalized: string): boolean {
    return (
      normalized.includes('bai tap') &&
      (normalized.includes('chua hoan thanh') ||
        normalized.includes('chua xong') ||
        normalized.includes('chua nop') ||
        normalized.includes('dang lam'))
    );
  }

  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private formatDate(date: Date | string | undefined): string {
    if (!date) return '—';
    const value = typeof date === 'string' ? new Date(date) : date;
    if (Number.isNaN(value.getTime())) return '—';
    return value.toLocaleDateString('vi-VN');
  }
}
