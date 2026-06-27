import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { User } from 'src/auth/decorators/user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { SimpleUserDto } from 'src/users/dto/simple-user.dto';
import { AttendanceService } from './attendance.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    @InjectPinoLogger(AttendanceController.name)
    private readonly logger: PinoLogger,
  ) { }

  @ApiOperation({ summary: 'Intern đăng ký chấm công' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('intern')
  @Post()
  async registerAttendance(
    @User() user: SimpleUserDto,
    @Body() dto: CreateAttendanceDto,
  ) {
    const result = await this.attendanceService.registerAttendance(user.id, dto);
    this.logger.info(
      { user_id: user.id, date: dto.date },
      'attendance.register',
    );
    return result;
  }

  @ApiOperation({ summary: 'Intern xem chấm công tuần' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('intern')
  @ApiQuery({ name: 'weekStart', required: true, example: '2026-02-16' })
  @Get('my-week')
  async getMyWeekAttendance(
    @User() user: SimpleUserDto,
    @Query('weekStart') weekStart: string,
  ) {
    return this.attendanceService.getMyWeekAttendance(user.id, weekStart);
  }

  @ApiOperation({ summary: 'Intern xem chấm công theo tháng (calendar)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('intern')
  @ApiQuery({ name: 'month', required: true, example: '2026-03' })
  @Get('my-month')
  async getMyMonthAttendance(
    @User() user: SimpleUserDto,
    @Query('month') month: string,
  ) {
    return this.attendanceService.getMyMonthAttendance(user.id, month);
  }

  @ApiOperation({ summary: 'Mentor xem chấm công intern' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('mentor', 'admin')
  @ApiQuery({ name: 'weekStart', required: true, example: '2026-02-16' })
  @Get('mentor-week')
  async getMentorWeekView(
    @User() user: SimpleUserDto,
    @Query('weekStart') weekStart: string,
  ) {
    return this.attendanceService.getMentorWeekView(user.id, weekStart);
  }

  @ApiOperation({
    summary: 'Mentor xem chấm công intern theo tháng (calendar)',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('mentor', 'admin')
  @ApiQuery({ name: 'month', required: true, example: '2026-03' })
  @Get('mentor-month')
  async getMentorMonthView(
    @User() user: SimpleUserDto,
    @Query('month') month: string,
  ) {
    return this.attendanceService.getMentorMonthView(user.id, month);
  }

  @ApiOperation({ summary: 'Admin xem tất cả chấm công' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiQuery({ name: 'weekStart', required: true, example: '2026-02-16' })
  @Get('admin-week')
  async getAdminWeekView(@Query('weekStart') weekStart: string) {
    return this.attendanceService.getAdminWeekView(weekStart);
  }

  @ApiOperation({ summary: 'Admin xem chấm công theo tháng (calendar)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiQuery({ name: 'month', required: true, example: '2026-03' })
  @Get('admin-month')
  async getAdminMonthView(@Query('month') month: string) {
    return this.attendanceService.getAdminMonthView(month);
  }

  @ApiOperation({ summary: 'Lấy thống kê chấm công' })
  @UseGuards(JwtAuthGuard)
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @Get('stats')
  async getAttendanceStats(
    @Query('userId') userId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.attendanceService.getAttendanceStats(
      userId,
      startDate,
      endDate,
    );
  }

  @ApiOperation({ summary: 'Intern hủy đăng ký chấm công' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('intern')
  @Delete(':id')
  async deleteAttendance(@User() user: SimpleUserDto, @Param('id') id: string) {
    const result = await this.attendanceService.deleteAttendance(id, user.id);
    this.logger.info(
      { user_id: user.id, attendance_id: id },
      'attendance.delete',
    );
    return result;
  }
}
