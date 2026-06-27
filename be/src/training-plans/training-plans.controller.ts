import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { User } from 'src/auth/decorators/user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { SimpleUserDto } from 'src/users/dto/simple-user.dto';
import { CreateTrainingPlanDto } from './dto/create-training-plan.dto';
import { UpdateTrainingPlanDto } from './dto/update-training-plan.dto';
import { TrainingPlansService } from './training-plans.service';

@ApiTags('training-plans')
@ApiBearerAuth()
@Controller('training-plans')
export class TrainingPlansController {
  constructor(
    private readonly trainingPlansService: TrainingPlansService,
    @InjectPinoLogger(TrainingPlansController.name)
    private readonly logger: PinoLogger,
  ) { }

  @ApiOperation({ summary: 'Create a training plan' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'mentor')
  @Post()
  async create(
    @Body() createTrainingPlanDto: CreateTrainingPlanDto,
    @User() user: SimpleUserDto,
  ) {
    const result = await this.trainingPlansService.createTrainingPlan(
      createTrainingPlanDto,
      user,
    );
    this.logger.info(
      { user_id: user.id, role: user.role, plan_id: result?.id },
      'training_plan.create',
    );
    return result;
  }

  /**
   * GET ROUTES
   */

  @ApiOperation({
    summary: 'Get all training plans for the authenticated user',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'mentor')
  @Get()
  async findAllByUser(@User() user: SimpleUserDto) {
    return this.trainingPlansService.findAllByUser(user.id, user);
  }

  @ApiOperation({ summary: 'Get all training plans' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('all')
  async findAll() {
    return this.trainingPlansService.findAll();
  }

  @ApiOperation({ summary: 'Get all training plans with interns' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'mentor')
  @Get('with-interns')
  async findAllWithInterns(@User() user: SimpleUserDto) {
    return await this.trainingPlansService.findPlansWithInterns(user);
  }

  // @ApiOperation({ summary: 'Get training plans for Interns' })
  // @UseGuards(JwtAuthGuard, RolesGuard)
  // @Roles('intern')
  // @Get('interns')
  // async findPlansForInterns(@User() user: SimpleUserDto) {
  //   return await this.trainingPlansService.findPlansForInterns(user);
  // }

  @ApiOperation({ summary: 'Export a training plan to PDF using InternId' })
  @ApiQuery({ name: 'link', required: false })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'mentor', 'intern')
  @Get(':internId/export')
  async exportToPdf(
    @Res() res: Response,
    @Req() req: Request,
    @Param('internId') internId: string,
    @Query('link') link: string,
    @User() user: SimpleUserDto,
  ) {
    if (!link) {
      throw new BadRequestException('Link is required');
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];

    if (!token) {
      throw new BadRequestException('Authorization token is required');
    }

    const pdfBuffer = await this.trainingPlansService.exportToPdf(
      link,
      internId,
      user,
      token,
    );

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="training-plan-${internId}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });

    return res.end(pdfBuffer);
  }

  @ApiOperation({ summary: 'Get a training plan by ID' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'mentor')
  @Get(':id')
  async findOne(@Param('id') id: string, @User() user: SimpleUserDto) {
    return await this.trainingPlansService.findOne(id, user);
  }

  /**
   * PUT ROUTES
   */

  @ApiOperation({ summary: 'Assign a training plan to an intern' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        internId: { type: 'string' },
      },
      required: ['internId'],
    },
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'mentor')
  @Put(':id/assign')
  async assign(
    @Param('id') id: string,
    @User() user: SimpleUserDto,
    @Body('internId') internId: string,
  ) {
    const result = await this.trainingPlansService.assignTrainingPlanToIntern(
      id,
      internId,
      user,
    );
    this.logger.info(
      { user_id: user.id, role: user.role, plan_id: id, intern_id: internId },
      'training_plan.assign',
    );
    return result;
  }

  @ApiOperation({ summary: 'Restore a training plan with Id' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'mentor')
  @Put(':id/restore')
  async restore(@Param('id') id: string, @User() user: SimpleUserDto) {
    return this.trainingPlansService.restore(id, user);
  }

  @ApiOperation({ summary: 'Update a training plan by ID' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'mentor')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateTrainingPlanDto: UpdateTrainingPlanDto,
    @User() user: SimpleUserDto,
  ) {
    return this.trainingPlansService.update(id, updateTrainingPlanDto, user);
  }

  /**
   * DELETE ROUTES
   */

  @ApiOperation({ summary: 'Delete a training plan with Id' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'mentor')
  @Delete(':id')
  async softDelete(@Param('id') id: string, @User() user: SimpleUserDto) {
    const result = await this.trainingPlansService.softDelete(id, user);
    this.logger.info(
      { user_id: user.id, role: user.role, plan_id: id },
      'training_plan.delete',
    );
    return result;
  }
}
