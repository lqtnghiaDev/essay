import { Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { User } from 'src/auth/decorators/user.decorator';
import { SimpleUserDto } from 'src/users/dto/simple-user.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({ summary: 'Lấy danh sách thông báo của user' })
  @Get()
  async findAll(@User() user: SimpleUserDto) {
    return this.notificationsService.findAllByUser(user.id);
  }

  @ApiOperation({ summary: 'Đếm số thông báo chưa đọc' })
  @Get('unread-count')
  async getUnreadCount(@User() user: SimpleUserDto) {
    const count = await this.notificationsService.getUnreadCount(user.id);
    return { count };
  }

  @ApiOperation({ summary: 'Đánh dấu tất cả thông báo đã đọc' })
  @Put('read-all')
  async markAllAsRead(@User() user: SimpleUserDto) {
    return this.notificationsService.markAllAsRead(user.id);
  }

  @ApiOperation({ summary: 'Đánh dấu 1 thông báo đã đọc' })
  @Put(':id/read')
  async markAsRead(@Param('id') id: string, @User() user: SimpleUserDto) {
    return this.notificationsService.markAsRead(id, user.id);
  }

  @ApiOperation({ summary: 'Delete a notification' })
  @Delete(':id')
  async remove(@Param('id') id: string, @User() user: SimpleUserDto) {
    return this.notificationsService.remove(id, user.id);
  }
}
