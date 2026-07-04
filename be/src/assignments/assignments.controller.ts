import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
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
import { AssignmentsService } from './assignments.service';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';

@ApiTags('assignments')
@ApiBearerAuth()
@Controller('assignments')
export class AssignmentsController {
  constructor(
    private readonly assignmentsService: AssignmentsService,
    @InjectPinoLogger(AssignmentsController.name)
    private readonly logger: PinoLogger,
  ) { }

  @ApiOperation({ summary: 'Create a new assignment' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'mentor')
  @Post()
  async create(
    @Body() payLoad: CreateAssignmentDto,
    @User() user: SimpleUserDto,
  ) {
    const result = await this.assignmentsService.create(payLoad, user);
    this.logger.info(
      { user_id: user.id, role: user.role, assignment_id: result?.id },
      'assignment.create',
    );
    return result;
  }

  @ApiOperation({ summary: 'Get all assignments by user' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['Todo', 'InProgress', 'Submitted', 'Reviewed'],
  })
  @ApiQuery({
    name: 'isAssigned',
    required: false,
    type: 'boolean',
  })
  @UseGuards(JwtAuthGuard)
  @Get()
  async findAllByUser(
    @User() user: SimpleUserDto,
    @Query('status') status?: 'Todo' | 'InProgress' | 'Submitted' | 'Reviewed',
    @Query('isAssigned') isAssigned?: boolean,
  ) {
    return this.assignmentsService.findAllByUser(user, status, isAssigned);
  }

  @ApiOperation({ summary: 'Get all assignments' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['Todo', 'InProgress', 'Submitted', 'Reviewed'],
  })
  @ApiQuery({
    name: 'isAssigned',
    required: false,
    type: 'boolean',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('all')
  async findAll(
    @Query('status') status?: 'Todo' | 'InProgress' | 'Submitted' | 'Reviewed',
    @Query('isAssigned') isAssigned?: boolean,
  ) {
    return this.assignmentsService.findAll(status, isAssigned);
  }

  @ApiOperation({ summary: 'Get a single assignment by ID' })
  @ApiQuery({
    name: 'isAssigned',
    required: false,
    type: 'boolean',
    default: true,
  })
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @User() user: SimpleUserDto,
    @Query('isAssigned') isAssigned?: boolean,
  ) {
    return this.assignmentsService.findOne(id, user, isAssigned);
  }

  @ApiOperation({ summary: 'Update assignment status' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['Todo', 'InProgress', 'Submitted', 'Reviewed'],
        },
      },
      required: ['status'],
    },
  })
  @UseGuards(JwtAuthGuard)
  @Put(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @User() user: SimpleUserDto,
    @Body('status') status: 'Todo' | 'InProgress' | 'Submitted' | 'Reviewed',
  ) {
    const result = await this.assignmentsService.updateStatus(id, user, status);
    this.logger.info(
      { user_id: user.id, role: user.role, assignment_id: id, status },
      'assignment.status_updated',
    );
    return result;
  }

  @ApiOperation({ summary: 'Submit an assignment' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        submittedLink: { type: 'string' },
      },
      required: ['submittedLink'],
    },
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('intern')
  @Put(':id/submit')
  async submit(
    @Param('id') id: string,
    @User() user: SimpleUserDto,
    @Body('submittedLink') payLoad: string,
  ) {
    const result = await this.assignmentsService.submit(id, user, payLoad);
    this.logger.info(
      { user_id: user.id, assignment_id: id },
      'assignment.submit',
    );
    return result;
  }

  @ApiOperation({ summary: 'Review an assignment' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        feedback: { type: 'string' },
      },
      required: ['feedback'],
    },
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('mentor')
  @Put(':id/review')
  async review(
    @Param('id') id: string,
    @User() user: SimpleUserDto,
    @Body('feedback') payLoad: string,
  ) {
    const result = await this.assignmentsService.review(id, user, payLoad);
    this.logger.info(
      { user_id: user.id, assignment_id: id },
      'assignment.review',
    );
    return result;
  }

  @ApiOperation({ summary: 'Restore a deleted assignment' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'mentor')
  @Put(':id/restore')
  async restore(@Param('id') id: string, @User() user: SimpleUserDto) {
    return this.assignmentsService.restore(id, user);
  }

  @ApiOperation({ summary: 'Update an assignment' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'mentor')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @User() user: SimpleUserDto,
    @Body() payLoad: UpdateAssignmentDto,
  ) {
    return this.assignmentsService.update(id, user, payLoad);
  }

  @ApiOperation({ summary: 'Delete an assignment' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'mentor')
  @Delete(':id')
  async delete(@Param('id') id: string, @User() user: SimpleUserDto) {
    const result = await this.assignmentsService.softDelete(id, user);
    this.logger.info(
      { user_id: user.id, role: user.role, assignment_id: id },
      'assignment.delete',
    );
    return result;
  }
}
