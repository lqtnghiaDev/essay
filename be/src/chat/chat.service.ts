import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
