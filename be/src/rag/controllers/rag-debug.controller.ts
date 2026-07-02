import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { RetrievalService } from '../services/retrieval.service';
import { LlmService } from 'src/llm/llm.service';

@Controller('rag')
export class RagDebugController {
  constructor(
    private readonly retrievalService: RetrievalService,
    private readonly llmService: LlmService,
  ) {}

  @Post('debug')
  async debug(
    @Body() body: { role?: string; userId?: string; message: string },
  ) {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Not available in production');
    }
    if (!body?.message) {
      throw new BadRequestException('Missing message');
    }

    const filter: { scope: string; mentorId?: string; internId?: string } = {
      scope:
        body.role === 'admin'
          ? 'admin'
          : body.role === 'mentor'
          ? 'mentor'
          : 'intern',
    };
    if (body.role === 'mentor' && body.userId) filter.mentorId = body.userId;
    if (body.role === 'intern' && body.userId) filter.internId = body.userId;

    const ragContext = await this.retrievalService.retrieveContext(
      body.message,
      filter,
    );

    const systemPrompt = this.llmService.getSystemPrompt({
      role: body.role,
      ragContext: ragContext || undefined,
    });

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: body.message },
    ];

    const aiResponse = await this.llmService.generateResponse(
      messages as any,
    );

    return { ragContext, aiResponse };
  }
}
