import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { User } from 'src/auth/decorators/user.decorator';
import { ChatService } from './chat.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SimpleUserDto } from 'src/users/dto/simple-user.dto';

@ApiTags('chat')
@ApiBearerAuth()
@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @ApiOperation({ summary: 'Tạo phiên chat mới' })
  @ApiBody({ type: CreateSessionDto })
  @Post('session')
  async createSession(@User() user: SimpleUserDto) {
    return this.chatService.createSession(user.id, user.role);
  }

  @ApiOperation({ summary: 'Lấy danh sách phiên chat của user' })
  @Get('sessions')
  async getUserSessions(@User() user: { id: string }) {
    return this.chatService.getUserSessions(user.id);
  }

  @ApiOperation({ summary: 'Lấy thông tin phiên chat kèm tin nhắn' })
  @Get('session/:id')
  async getSession(@Param('id') id: string) {
    return this.chatService.getSession(id);
  }

  @ApiOperation({
    summary: 'Gửi tin nhắn và nhận phản hồi (RAG + memory theo role)',
  })
  @ApiBody({ type: SendMessageDto })
  @Post('message')
  async sendMessage(
    @User() user: SimpleUserDto,
    @Body() sendMessageDto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(
      sendMessageDto.sessionId,
      sendMessageDto.content,
      user,
    );
  }
}
