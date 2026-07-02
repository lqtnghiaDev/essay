import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Embeddings } from '@langchain/core/embeddings';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private embeddings: Embeddings | null = null;
  private model: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    this.model =
      this.configService.get<string>('OPENAI_EMBEDDING_MODEL') ||
      'text-embedding-3-small';

    if (apiKey) {
      try {
        this.embeddings = new OpenAIEmbeddings({
          openAIApiKey: apiKey,
          modelName: this.model,
        });
        this.logger.log(
          `Embeddings service được cấu hình thành công từ OPENAI_API_KEY. Model: ${this.model}`,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Lỗi khởi tạo embeddings service. Chi tiết: ${errorMessage}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    } else {
      this.logger.warn(
        'OPENAI_API_KEY chưa được cấu hình. RAG sẽ không hoạt động.',
      );
    }
  }

  getEmbeddings(): Embeddings | null {
    return this.embeddings;
  }

  isConfigured(): boolean {
    return this.embeddings !== null;
  }
}
