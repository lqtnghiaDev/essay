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

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatSession)
    private chatSessionRepository: Repository<ChatSession>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    private llmService: LlmService,
    private retrievalService: RetrievalService,
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
    userId: string,
    role: string,
  ): Promise<{ userMessage: Message; assistantMessage: Message }> {
    const session = await this.chatSessionRepository.findOne({
      where: { id: sessionId },
      relations: ['messages'],
      order: { messages: { createdAt: 'ASC' } },
    });

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên chat');
    }
    if (session.userId !== userId) {
      throw new ForbiddenException(
        'Bạn không có quyền gửi tin nhắn trong phiên này',
      );
    }

    const userMessage = this.messageRepository.create({
      sessionId,
      sender: SenderRole.USER,
      content,
    });
    await this.messageRepository.save(userMessage);

    const filter: { scope: string; mentorId?: string; internId?: string } = {
      scope:
        role === 'admin' ? 'admin' : role === 'mentor' ? 'mentor' : 'intern',
    };
    if (role === 'mentor') filter.mentorId = userId;
    if (role === 'intern') filter.internId = userId;

    const ragContext = await this.retrievalService.retrieveContext(
      content,
      filter,
    );

    const messages = this.buildMessagesForLlm(
      session.messages || [],
      content,
      role,
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
    role: string,
    ragContext?: string,
  ): ChatMessage[] {
    const systemContent = this.llmService.getSystemPrompt({
      role,
      ragContext: ragContext || undefined,
    });
    const messages: ChatMessage[] = [{ role: 'system', content: systemContent }];

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
}
