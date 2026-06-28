import { GoogleGenAI } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: GoogleGenAI | null = null;
  private readonly model: string;
  private readonly isConfigured: boolean = false;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');

    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
      this.isConfigured = true;
      this.logger.log(
        'Google Gemini API (@google/genai) đã được cấu hình thành công',
      );
    } else {
      this.logger.warn(
        '⚠️ GEMINI_API_KEY chưa được cấu hình. Chat sẽ trả về fallback message.',
      );
    }

    this.model =
      this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash';
  }

  /**
   * Tạo phản hồi từ LLM
   */
  async generateResponse(messages: ChatMessage[]): Promise<string> {
    if (!this.client) {
      return 'Hệ thống AI chưa được cấu hình. Vui lòng liên hệ quản trị viên.';
    }

    try {
      const systemPrompt =
        messages.find((m) => m.role === 'system')?.content || '';

      const conversationHistory = messages
        .filter((m) => m.role !== 'system')
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');

      const fullPrompt = `${systemPrompt}

--- Lịch sử hội thoại ---
${conversationHistory}

Assistant:`;

      const result = await this.client.models.generateContent({
        model: this.model, // gemini-2.5-flash
        contents: [
          {
            role: 'user',
            parts: [{ text: fullPrompt }],
          },
        ],
      });

      // SDK mới chỉ dùng result.text
      if (!result.text) {
        throw new Error('Không nhận được phản hồi từ Gemini');
      }

      return result.text;
    } catch (error) {
      this.logger.error('Lỗi khi gọi Gemini API', error);
      return 'Xin lỗi, tôi đang gặp sự cố kết nối. Vui lòng thử lại sau.';
    }
  }

  /**
   * System prompt cho trợ lý RAG: role + ngữ cảnh từ vector store
   */
  getSystemPrompt(options?: { role?: string; ragContext?: string }): string {
    const roleLabel =
      options?.role === 'admin'
        ? 'quản trị viên (admin)'
        : options?.role === 'mentor'
          ? 'mentor'
          : options?.role === 'intern'
            ? 'thực tập sinh (intern)'
            : 'người dùng';
    let base = `Bạn là trợ lý quản lý thực tập sinh thông minh. Bạn đang trả lời cho ${roleLabel}.

Vai trò của bạn:
- Hỗ trợ giải đáp các câu hỏi liên quan đến thực tập sinh, kế hoạch đào tạo, bài tập, điểm danh
- Chỉ dùng thông tin trong phần "Ngữ cảnh từ hệ thống" bên dưới để trả lời (nếu có)
- Nếu không có thông tin liên quan trong ngữ cảnh, hãy nói: "Tôi không có thông tin về vấn đề này trong hệ thống."

Quy tắc:
1. Chỉ trả lời dựa trên ngữ cảnh được cung cấp và câu hỏi của người dùng
2. Trả lời ngắn gọn, rõ ràng, dễ hiểu
3. Sử dụng tiếng Việt
4. Không bịa đặt thông tin
5. Khi liệt kê (danh sách người, bài tập, từng mục): mỗi mục phải xuống dòng riêng, dùng ký tự xuống dòng thực sự giữa từng dòng (ví dụ: mỗi tên người một dòng, mỗi bài tập một dòng) để người đọc dễ theo dõi`;

    if (options?.ragContext?.trim()) {
      base += `

--- Ngữ cảnh từ hệ thống (chỉ dùng thông tin này để trả lời) ---
${options.ragContext}
--- Hết ngữ cảnh ---`;
    }
    return base;
  }
}
