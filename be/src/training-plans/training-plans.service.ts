import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TrainingPlan } from './entities/training-plan.entity';
import { DataSource, In, Repository } from 'typeorm';
import { TrainingPlanSkill } from './entities/training-plan-skill.entity';
import { CreateTrainingPlanDto } from './dto/create-training-plan.dto';
import { SimpleUserDto } from 'src/users/dto/simple-user.dto';
import { Skill } from 'src/skills/entities/skill.entity';
import { UpdateTrainingPlanDto } from './dto/update-training-plan.dto';
import { Assignment } from 'src/assignments/entities/assignment.entity';
import { AssignmentSkill } from 'src/assignments/entities/assignment-skill.entity';
import { TrainingPlanDto } from './dto/training-plan.dto';
import { plainToInstance } from 'class-transformer';
import { InternInformation } from 'src/interns-information/entities/intern-information.entity';
import { InternsInformationService } from 'src/interns-information/interns-information.service';
import { InternInformationDto } from 'src/interns-information/dto/intern-information.dto';
import { NotificationsService } from 'src/notifications/notifications.service';
import { NotificationType } from 'src/notifications/entities/notification.entity';
// import chromium from 'chrome-aws-lambda';
import chromium from '@sparticuz/chromium';
import puppeteer, { Browser } from 'puppeteer-core';

@Injectable()
export class TrainingPlansService {
  constructor(
    @InjectRepository(TrainingPlan)
    private readonly trainingPlanRepository: Repository<TrainingPlan>,

    @InjectRepository(Skill)
    private readonly skillRepository: Repository<Skill>,

    @InjectRepository(InternInformation)
    private readonly internInformationRepository: Repository<InternInformation>,

    private readonly internsInformationService: InternsInformationService,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findAll(): Promise<TrainingPlanDto[]> {
    try {
      const trainingPlans = await this.trainingPlanRepository
        .createQueryBuilder('plan')
        .leftJoinAndSelect('plan.skills', 'planSkill')
        .leftJoinAndSelect('planSkill.skill', 'skill')
        .leftJoinAndSelect(
          'plan.assignments',
          'assignment',
          'assignment.isAssigned = false',
        )
        .leftJoinAndSelect('assignment.task', 'task')
        .leftJoinAndSelect('assignment.skills', 'assignmentSkill')
        .leftJoinAndSelect('assignmentSkill.skill', 'assignmentSkillDetail')
        .where('plan.isDeleted = false')
        .getMany();

      return plainToInstance(TrainingPlanDto, trainingPlans, {
        excludeExtraneousValues: true,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        `Error fetching training plans: ${error.message}`,
      );
    }
  }

  async findAllByUser(
    userId: string,
    user: SimpleUserDto,
  ): Promise<TrainingPlanDto[]> {
    try {
      const query = this.trainingPlanRepository
        .createQueryBuilder('plan')
        .leftJoin('plan.creator', 'creator')
        .addSelect(['creator.fullName'])
        .leftJoinAndSelect('plan.skills', 'planSkill')
        .leftJoinAndSelect('planSkill.skill', 'skill')
        .leftJoinAndSelect(
          'plan.assignments',
          'assignment',
          'assignment.isAssigned = false AND assignment.isDeleted = false',
        )
        .leftJoinAndSelect('assignment.task', 'task')
        .leftJoinAndSelect('assignment.skills', 'assignmentSkill')
        .leftJoinAndSelect('assignmentSkill.skill', 'assignmentSkillDetail');

      if (user.role === 'admin') {
        query.where(
          '(plan.isDeleted = false) AND (plan.createdBy = :userId OR plan.isPublic = true)',
          { userId },
        );
      } else {
        query.where('(plan.isDeleted = false) AND plan.createdBy = :userId', {
          userId,
        });
      }

      const trainingPlans = await query.getMany();

      return plainToInstance(TrainingPlanDto, trainingPlans, {
        excludeExtraneousValues: true,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        `Error fetching training plans: ${error.message}`,
      );
    }
  }

  async findOne(id: string, user: SimpleUserDto): Promise<TrainingPlanDto> {
    try {
      const trainingPlan = await this.trainingPlanRepository
        .createQueryBuilder('plan')
        .leftJoinAndSelect('plan.skills', 'planSkill')
        .leftJoinAndSelect('planSkill.skill', 'skill')
        .leftJoinAndSelect(
          'plan.assignments',
          'assignment',
          'assignment.isAssigned = false',
        )
        .leftJoinAndSelect('assignment.task', 'task')
        .leftJoinAndSelect('assignment.skills', 'assignmentSkill')
        .leftJoinAndSelect('assignmentSkill.skill', 'assignmentSkillDetail')
        .where('plan.isDeleted = false AND plan.id = :id', { id })
        .getOne();

      if (!trainingPlan) {
        throw new NotFoundException(`Training plan ${id} not found`);
      }

      if (user.role !== 'admin' && user.id !== trainingPlan.createdBy) {
        throw new ForbiddenException(
          'You do not have permission to access this training plan',
        );
      }

      return plainToInstance(TrainingPlanDto, trainingPlan, {
        excludeExtraneousValues: true,
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        `Error fetching training plan: ${error.message}`,
      );
    }
  }

  // Can be not used, for now
  async findPlansForInterns(
    user: SimpleUserDto,
  ): Promise<InternInformationDto> {
    try {
      const plan = await this.internInformationRepository
        .createQueryBuilder('internInfo')
        .leftJoinAndSelect('internInfo.plan', 'plan')
        .leftJoinAndSelect('plan.skills', 'planSkill')
        .leftJoinAndSelect('planSkill.skill', 'skill')
        .leftJoinAndSelect(
          'plan.assignments',
          'assignment',
          'assignment.isAssigned = true AND assignment.assignedTo = :internId',
          {
            internId: user.id,
          },
        )
        .leftJoinAndSelect('assignment.task', 'task')
        .leftJoinAndSelect('assignment.skills', 'assignmentSkill')
        .leftJoinAndSelect('assignmentSkill.skill', 'assignmentSkillDetail')
        .where('internInfo.internId = :internId', { internId: user.id })
        .getOne();

      if (!plan) {
        throw new NotFoundException(`Training plan not found for intern`);
      }

      return plainToInstance(InternInformationDto, plan, {
        excludeExtraneousValues: true,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException(
        `Error fetching training plan for intern: ${error.message}`,
      );
    }
  }

  async createTrainingPlan(
    createTrainingPlanDto: CreateTrainingPlanDto,
    user: SimpleUserDto,
  ): Promise<TrainingPlanDto> {
    try {
      const { assignments, skills, ...createData } = createTrainingPlanDto;

      if (skills && skills.length > 0) {
        await this.validateSkillsExist(skills);
      }

      if (assignments && assignments.length > 0) {
        await this.validateAssignmentsData(assignments);
      }

      return await this.dataSource.transaction(async (manager) => {
        const trainingPlan = manager.create(TrainingPlan, {
          ...createData,
          createdBy: user.id,
        });
        const savedTrainingPlan = await manager.save(
          TrainingPlan,
          trainingPlan,
        );

        if (skills && skills.length > 0) {
          const trainingPlanSkills = skills.map((skillId) =>
            manager.create(TrainingPlanSkill, {
              planId: savedTrainingPlan.id,
              skillId: skillId,
            }),
          );

          await manager.save(TrainingPlanSkill, trainingPlanSkills);
        }

        if (assignments && assignments.length > 0) {
          for (const assignmentDto of assignments) {
            const assignmentWithPlanId = {
              ...assignmentDto,
              planId: savedTrainingPlan.id,
              createdBy: user.id,
            };

            const assignment = manager.create(Assignment, assignmentWithPlanId);
            const savedAssignment = await manager.save(Assignment, assignment);

            if (assignmentDto.skillIds && assignmentDto.skillIds.length > 0) {
              const assignmentSkills = assignmentDto.skillIds.map((skillId) =>
                manager.create(AssignmentSkill, {
                  assignmentId: savedAssignment.id,
                  skillId: skillId,
                }),
              );
              await manager.save(AssignmentSkill, assignmentSkills);
            }
          }
        }

        const trainingPlanWithSkills = await manager.findOne(TrainingPlan, {
          where: { id: savedTrainingPlan.id, isDeleted: false },
          relations: [
            'skills',
            'skills.skill',
            'assignments',
            'assignments.task',
          ],
        });

        if (!trainingPlanWithSkills) {
          throw new Error('Failed to create training plan with skills');
        }

        return plainToInstance(TrainingPlanDto, trainingPlanWithSkills, {
          excludeExtraneousValues: true,
        });
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        `Error creating training plan: ${error.message}`,
      );
    }
  }

  private async validateSkillsExist(skills: string[]) {
    const existingSkills = await this.skillRepository.find({
      where: skills.map((id) => ({ id, isDeleted: false })),
      select: ['id'],
    });

    const existingSkillIds = existingSkills.map((skill) => skill.id);
    const missingSkillIds = skills.filter(
      (id) => !existingSkillIds.includes(id),
    );

    if (missingSkillIds.length > 0) {
      throw new BadRequestException(
        `Skills not found: ${missingSkillIds.join(', ')}`,
      );
    }
  }

  private async validateAssignmentsData(assignments: any[]) {
    for (const assignment of assignments) {
      // Validate taskId exists
      // You might want to add Task repository and check if task exists
      if (!assignment.taskId) {
        throw new BadRequestException('Task ID is required for assignment');
      }

      // Validate skills if provided
      if (assignment.skillIds && assignment.skillIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        await this.validateSkillsExist(assignment.skillIds);
      }

      // Validate estimatedTime is positive
      if (assignment.estimatedTime <= 0) {
        throw new BadRequestException('Estimated time must be greater than 0');
      }
    }
  }

  /**
   * Update function for Update Training Plan, which is not assigned and its assignments
   */
  async update(
    id: string,
    updateData: UpdateTrainingPlanDto,
    user: SimpleUserDto,
  ): Promise<TrainingPlanDto> {
    try {
      const existingTrainingPlan = await this.trainingPlanRepository.findOne({
        where: { id, isDeleted: false },
        relations: ['skills', 'assignments'],
      });

      if (!existingTrainingPlan) {
        throw new NotFoundException(`Training plan ${id} not found`);
      }

      if (user.role !== 'admin' && existingTrainingPlan.createdBy !== user.id) {
        throw new ForbiddenException(
          'You do not have permission to update this training plan',
        );
      }

      const { assignments, skills, ...updatePlanData } = updateData;

      if (skills && skills.length > 0) {
        await this.validateSkillsExist(skills);
      }

      if (assignments && assignments.length > 0) {
        await this.validateAssignmentsData(assignments);
      }

      const updatedTrainingPlanId = await this.dataSource.transaction(
        async (manager) => {
          Object.assign(existingTrainingPlan, updatePlanData);
          await manager.save(TrainingPlan, existingTrainingPlan);

          // Maybe bug here
          if (skills) {
            // await manager.delete(TrainingPlanSkill, {
            //   planId: existingTrainingPlan.id,
            // });

            // const trainingPlanSkills = skills.map((skillId) =>
            //   manager.create(TrainingPlanSkill, {
            //     planId: existingTrainingPlan.id,
            //     skillId: skillId,
            //   }),
            // );
            // await manager.save(TrainingPlanSkill, trainingPlanSkills);
            const currentSkillIds = existingTrainingPlan.skills.map(
              (skill) => skill.skillId,
            );
            const skillsToAdd = skills.filter(
              (id) => !currentSkillIds.includes(id),
            );
            const skillsToRemove = currentSkillIds.filter(
              (id) => !skills.includes(id),
            );

            if (skillsToRemove.length > 0) {
              await manager.delete(TrainingPlanSkill, {
                planId: existingTrainingPlan.id,
                skillId: In(skillsToRemove),
              });
            }

            if (skillsToAdd.length > 0) {
              await manager.save(
                TrainingPlanSkill,
                skillsToAdd.map((skillId) => ({
                  planId: existingTrainingPlan.id,
                  skillId: skillId,
                })),
              );
            }
          }

          // Maybe bug here
          // Update Assignments if provided
          if (assignments) {
            const existingAssignments = await manager.find(Assignment, {
              where: { planId: existingTrainingPlan.id, isAssigned: false },
            });

            if (existingAssignments.length > 0) {
              const assignmentIds = existingAssignments.map((a) => a.id);

              await Promise.all([
                manager.delete(AssignmentSkill, {
                  assignmentId: In(assignmentIds),
                }),
                manager.delete(Assignment, {
                  id: In(assignmentIds),
                }),
              ]);
            }

            // Create new assignments
            for (const assignmentData of assignments) {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { skillIds, planId, ...assignmentFields } = assignmentData;

              // Ensure planId is set correctly and not null
              if (!existingTrainingPlan.id) {
                throw new BadRequestException(
                  'Training plan ID is required for assignment',
                );
              }

              const newAssignment = manager.create(Assignment, {
                ...assignmentFields,
                planId: existingTrainingPlan.id,
                createdBy: user.id,
              });

              // Save assignment
              const savedAssignment = await manager.save(
                Assignment,
                newAssignment,
              );

              // Create AssignmentSkill
              if (skillIds?.length > 0) {
                const assignmentSkills = skillIds.map((skillId) =>
                  manager.create(AssignmentSkill, {
                    assignmentId: savedAssignment.id,
                    skillId,
                  }),
                );
                await manager.save(AssignmentSkill, assignmentSkills);
              }
            }
          }

          return existingTrainingPlan.id;
        },
      );

      const updatedTrainingPlan = await this.findOne(
        updatedTrainingPlanId,
        user,
      );

      return updatedTrainingPlan;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Error updating training plan: ' + error.message,
      );
    }
  }

  async assignTrainingPlanToIntern(
    id: string,
    internId: string,
    user: SimpleUserDto,
  ) {
    try {
      await this.dataSource.transaction(async (manager) => {
        const trainingPlan = await manager.findOne(TrainingPlan, {
          where: {
            id: id,
            isDeleted: false,
          },
        });

        if (!trainingPlan) {
          throw new NotFoundException(`Training plan ${id} not found`);
        }

        if (user.role !== 'admin' && user.id !== trainingPlan.createdBy) {
          throw new ForbiddenException(
            'You do not have permission to assign this training plan',
          );
        }

        const internsInfo =
          await this.internsInformationService.findByInternId(internId);

        if (!internsInfo) {
          throw new NotFoundException(`Intern ${internId} not found`);
        }

        // Assign planId and mentorId to the intern's information
        internsInfo.planId = id;
        internsInfo.mentorId = trainingPlan.createdBy;
        internsInfo.status = 'InProgress';
        await manager.save(InternInformation, internsInfo);

        // change Assignment's assignedTo to the internId
        const assignmentsToUpdate = await manager.find(Assignment, {
          where: { planId: id, isAssigned: false },
        });

        // Duplicate assignments for the new intern
        for (const assignment of assignmentsToUpdate) {
          const newAssignment = manager.create(Assignment, {
            ...assignment,
            id: undefined,
            assignedTo: internId,
            dueDate: internsInfo.endDate,
            isAssigned: true,
          });
          const savedAssignment = await manager.save(Assignment, newAssignment);

          // Duplicate AssignmentSkills
          const assignmentSkills = await manager.find(AssignmentSkill, {
            where: { assignmentId: assignment.id },
          });

          if (assignmentSkills?.length > 0) {
            const duplicatedSkills = assignmentSkills.map((skill) =>
              manager.create(AssignmentSkill, {
                ...skill,
                id: undefined,
                assignmentId: savedAssignment.id,
              }),
            );

            await manager.save(AssignmentSkill, duplicatedSkills);
          }
        }
      });

      // Gửi thông báo realtime cho intern (có tên mentor)
      try {
        const senderName = user.fullName || user.username || 'Mentor';
        await this.notificationsService.createAndSend({
          recipientId: internId,
          senderId: user.id,
          type: NotificationType.TRAINING_PLAN_ASSIGNED,
          title: 'New training plan',
          message: `${senderName} assigned a training plan to you`,
          data: { trainingPlanId: id },
        });
      } catch (error) {
        // Không throw lỗi nếu gửi thông báo thất bại
        console.error('Failed to send notification:', error.message);
      }

      return { message: 'Training plan assigned to intern successfully' };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      throw new InternalServerErrorException('Error assigning training plan');
    }
  }

  async findPlansWithInterns(user: SimpleUserDto): Promise<any[]> {
    try {
      const queryBuilder = this.internInformationRepository
        .createQueryBuilder('internInfo')
        .leftJoinAndSelect('internInfo.intern', 'intern')
        .leftJoinAndSelect('internInfo.mentor', 'mentor')
        .leftJoinAndSelect('internInfo.plan', 'plan')
        .leftJoinAndSelect('plan.skills', 'planSkills')
        .leftJoinAndSelect('planSkills.skill', 'skill')
        .leftJoinAndSelect(
          'plan.assignments',
          'assignments',
          'assignments.isDeleted = :assignmentDeleted AND assignments.isAssigned = :isAssigned AND assignments.assignedTo = intern.id',
          { assignmentDeleted: false, isAssigned: true },
        )
        .leftJoinAndSelect('assignments.task', 'task')
        .leftJoinAndSelect('assignments.skills', 'assignmentSkills')
        .leftJoinAndSelect('assignmentSkills.skill', 'assignmentSkill')
        .where('internInfo.isDeleted = :internInfoDeleted', {
          internInfoDeleted: false,
        })
        .andWhere('internInfo.planId IS NOT NULL')
        .andWhere('plan.createdBy = :userId', { userId: user.id });

      const internsInfo = await queryBuilder.getMany();
      return plainToInstance(InternInformationDto, internsInfo, {
        excludeExtraneousValues: true,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        `Error fetching training plans with interns: ${error.message}`,
      );
    }
  }

  async softDelete(id: string, user: SimpleUserDto): Promise<void> {
    try {
      const whereCondition: any = {
        id: id,
        isDeleted: false,
      };

      if (user.role !== 'admin') {
        whereCondition.createdBy = user.id;
      }

      const trainingPlan = await this.trainingPlanRepository.findOne({
        where: whereCondition,
        relations: ['skills', 'assignments'],
      });

      if (!trainingPlan) {
        throw new NotFoundException(
          'Training plan not found or you do not have permission to delete this training plan',
        );
      }

      await this.checkTrainingPlanReferences(id);

      await this.dataSource.transaction(async (manager) => {
        await manager.update(TrainingPlan, id, { isDeleted: true });

        await manager.update(
          TrainingPlanSkill,
          { planId: id },
          { isDeleted: true },
        );

        const assignments = await manager.find(Assignment, {
          where: { planId: id, isDeleted: false },
        });

        if (assignments.length > 0) {
          const assignmentIds = assignments.map((a) => a.id);

          await manager.update(
            Assignment,
            { planId: id, isDeleted: false },
            { isDeleted: true },
          );

          await manager.update(
            AssignmentSkill,
            { assignmentId: In(assignmentIds), isDeleted: false },
            { isDeleted: true },
          );
        }
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error deleting training plan: ' + error.message,
      );
    }
  }

  private async checkTrainingPlanReferences(id: string): Promise<void> {
    const references: string[] = [];

    const internInfoCount = await this.internInformationRepository
      .createQueryBuilder('internInfo')
      .where('internInfo.planId = :planId', { planId: id })
      .andWhere('internInfo.isDeleted = false')
      .getCount();

    if (internInfoCount > 0) {
      references.push(`${internInfoCount} intern(s)`);
    }

    if (references.length > 0) {
      throw new BadRequestException(
        `Cannot delete training plan. It is being used by: ${references.join(', ')}. Please unassign from interns first.`,
      );
    }
  }

  async restore(id: string, user: SimpleUserDto): Promise<TrainingPlanDto> {
    try {
      const whereCondition: any = {
        id: id,
        isDeleted: true,
      };

      if (user.role !== 'admin') {
        whereCondition.createdBy = user.id;
      }

      const trainingPlan = await this.trainingPlanRepository.findOne({
        where: whereCondition,
      });

      if (!trainingPlan) {
        throw new NotFoundException('Deleted training plan not found');
      }

      await this.dataSource.transaction(async (manager) => {
        await manager.update(TrainingPlan, id, { isDeleted: false });

        await manager.update(
          Assignment,
          { planId: id, isDeleted: true },
          { isDeleted: false },
        );

        const updatedAssignment = await manager.find(Assignment, {
          where: { planId: id, isDeleted: false },
          select: ['id'],
        });

        if (updatedAssignment.length > 0) {
          const updatedAssignmentIds = updatedAssignment.map((a) => a.id);
          await manager.update(
            AssignmentSkill,
            { assignmentId: In(updatedAssignmentIds), isDeleted: true },
            { isDeleted: false },
          );
        }
      });

      const restoredPlan = await this.findOne(id, user);
      return restoredPlan;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error restoring training plan: ' + error.message,
      );
    }
  }

  async exportToPdf(
    link: string,
    internId: string,
    user: SimpleUserDto,
    token: string,
  ): Promise<Buffer> {
    let browser: Browser | null = null;
    try {
      const canExport = await this.checkExportPermissions(internId, user);
      if (!canExport) {
        throw new ForbiddenException(
          'You do not have permission to export this training plan',
        );
      }

      const isProduction = process.env.NODE_ENV === 'production';

      browser = await puppeteer.launch({
        args: isProduction
          ? chromium.args.concat([
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--no-first-run',
              '--no-zygote',
              '--single-process',
              '--disable-web-security',
              '--font-render-hinting=none',
            ])
          : [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--no-first-run',
            ],
        defaultViewport: { width: 1200, height: 800 },
        headless: true,
        executablePath: isProduction
          ? await chromium.executablePath()
          : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        timeout: 60000,
      });

      const page = await browser.newPage();
      await page.setViewport({
        width: 1200,
        height: 800,
        deviceScaleFactor: 1,
      });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      );
      await page.setExtraHTTPHeaders({
        Authorization: `Bearer ${token}`,
      });
      await page.goto(link, { waitUntil: 'networkidle0', timeout: 30000 });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20px',
          right: '20px',
          bottom: '20px',
          left: '20px',
        },
      });

      await browser.close();
      return Buffer.from(pdfBuffer);
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;

      throw new InternalServerErrorException(
        'Error exporting training plan to PDF: ' + error.message,
      );
    } finally {
      if (browser !== null) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error('Error closing browser:', closeError);
        }
      }
    }
  }

  private async checkExportPermissions(
    internId: string,
    user: SimpleUserDto,
  ): Promise<boolean> {
    if (user.role === 'intern' && user.id !== internId) {
      return false;
    }

    if (user.role === 'mentor') {
      const internInfo = await this.internInformationRepository.findOne({
        where: { internId: internId, mentorId: user.id, isDeleted: false },
      });
      return !!internInfo;
    }

    return true;
  }
}
