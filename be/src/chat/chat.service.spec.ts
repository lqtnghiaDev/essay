import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChatService } from './chat.service';
import { ChatSession } from './entities/chat-session.entity';
import { Message, SenderRole } from './entities/message.entity';
import { LlmService } from '../llm/llm.service';
import { RetrievalService } from '../rag/services/retrieval.service';
import { InternsInformationService } from '../interns-information/interns-information.service';

describe('ChatService', () => {
  let chatService: ChatService;
  let llmService: {
    getSystemPrompt: jest.Mock;
    generateResponse: jest.Mock;
  };
  let retrievalService: {
    retrieveContext: jest.Mock;
  };
  let internsInformationService: {
    findByMentorId: jest.Mock;
    findOneForIntern: jest.Mock;
  };
  let chatSessionRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let messageRepository: {
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    llmService = {
      getSystemPrompt: jest.fn().mockReturnValue('system prompt'),
      generateResponse: jest.fn().mockResolvedValue('LLM answer'),
    };
    retrievalService = {
      retrieveContext: jest.fn().mockResolvedValue('retrieved rag context'),
    };
    internsInformationService = {
      findByMentorId: jest.fn().mockResolvedValue([]),
      findOneForIntern: jest.fn().mockResolvedValue({
        internInformation: null,
        countAssignments: {
          total: 0,
          todo: 0,
          inProgress: 0,
          submitted: 0,
          reviewed: 0,
        },
      }),
    };
    chatSessionRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    messageRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: getRepositoryToken(ChatSession), useValue: chatSessionRepository },
        { provide: getRepositoryToken(Message), useValue: messageRepository },
        { provide: LlmService, useValue: llmService },
        { provide: RetrievalService, useValue: retrievalService },
        { provide: InternsInformationService, useValue: internsInformationService },
      ],
    }).compile();

    chatService = moduleRef.get(ChatService);
  });

  it('returns a direct identity answer without calling retrieval or LLM', async () => {
    chatSessionRepository.findOne.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      messages: [],
    });

    const result = await chatService.sendMessage('session-1', 'tôi là ai', {
      id: 'user-1',
      username: 'mentor1',
      fullName: 'Nguyễn Văn Mentor',
      email: 'mentor@example.com',
      role: 'mentor',
      status: 'active',
    });

    expect(result.assistantMessage.content).toContain('Nguyễn Văn Mentor');
    expect(retrievalService.retrieveContext).not.toHaveBeenCalled();
    expect(llmService.generateResponse).not.toHaveBeenCalled();
  });

  it('returns the mentor intern list from the database', async () => {
    chatSessionRepository.findOne.mockResolvedValue({
      id: 'session-1',
      userId: 'mentor-1',
      messages: [],
    });
    internsInformationService.findByMentorId.mockResolvedValue([
      {
        internId: 'intern-1',
        intern: { fullName: 'Nguyễn Văn A' },
        plan: { name: 'Plan A' },
        status: 'InProgress',
      },
      {
        internId: 'intern-2',
        intern: { fullName: 'Trần Thị B' },
        plan: { name: 'Plan B' },
        status: 'Onboarding',
      },
    ]);

    const result = await chatService.sendMessage(
      'session-1',
      'danh sách thực tập sinh của tôi',
      {
        id: 'mentor-1',
        username: 'mentor1',
        fullName: 'Mentor A',
        email: 'mentor@example.com',
        role: 'mentor',
        status: 'active',
      },
    );

    expect(result.assistantMessage.content).toContain('Nguyễn Văn A');
    expect(result.assistantMessage.content).toContain('Trần Thị B');
    expect(retrievalService.retrieveContext).not.toHaveBeenCalled();
    expect(llmService.generateResponse).not.toHaveBeenCalled();
  });

  it('injects user and DB context into the prompt for normal questions', async () => {
    chatSessionRepository.findOne.mockResolvedValue({
      id: 'session-1',
      userId: 'intern-1',
      messages: [
        { sender: SenderRole.USER, content: 'Xin chào' },
        { sender: SenderRole.ASSISTANT, content: 'Chào bạn' },
      ],
    });
    internsInformationService.findOneForIntern.mockResolvedValue({
      internInformation: {
        field: 'Web',
        mentor: { fullName: 'Mentor B' },
        plan: { name: 'Plan X' },
        status: 'InProgress',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-06-01'),
      },
      countAssignments: {
        total: 4,
        todo: 1,
        inProgress: 2,
        submitted: 1,
        reviewed: 0,
      },
    });

    await chatService.sendMessage('session-1', 'kế hoạch của tôi là gì?', {
      id: 'intern-1',
      username: 'intern1',
      fullName: 'Lê Văn C',
      email: 'intern@example.com',
      role: 'intern',
      status: 'active',
    });

    expect(retrievalService.retrieveContext).toHaveBeenCalledWith(
      'kế hoạch của tôi là gì?',
      expect.objectContaining({ scope: 'intern', internId: 'intern-1' }),
    );
    expect(llmService.generateResponse).toHaveBeenCalledTimes(1);
    const messages = llmService.generateResponse.mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;
    expect(messages[0].content).toContain('Thông tin người dùng hiện tại');
    expect(messages[0].content).toContain('Lê Văn C');
    expect(messages[0].content).toContain('Dữ liệu nghiệp vụ trực tiếp từ DB');
    expect(messages[0].content).toContain('Mentor B');
  });
});