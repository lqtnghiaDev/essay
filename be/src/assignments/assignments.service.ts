import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Assignment } from './entities/assignment.entity';
import { DataSource, In, Repository } from 'typeorm';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { AssignmentDto } from './dto/assignment.dto';
import { SimpleUserDto } from 'src/users/dto/simple-user.dto';
import { plainToInstance } from 'class-transformer';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { AssignmentSkill } from './entities/assignment-skill.entity';
import { Skill } from 'src/skills/entities/skill.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { NotificationType } from 'src/notifications/entities/notification.entity';

@Injectable()
export class AssignmentsService {
  constructor(
    @InjectRepository(Assignment)
    private readonly assignmentRepository: Repository<Assignment>,

    @InjectRepository(AssignmentSkill)
    private readonly assignmentSkillRepository: Repository<AssignmentSkill>,

    @InjectRepository(Skill)
    private readonly skillRepository: Repository<Skill>,

    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(
    createAssignmentDto: CreateAssignmentDto,
    user: SimpleUserDto,
  ): Promise<AssignmentDto> {
    try {
      const { skillIds, ...assignmentData } = createAssignmentDto;

      if (!skillIds || skillIds.length === 0) {
        throw new BadRequestException('At least one skill is required');
      }

      // Check if all skills exist
      await this.validateSkillsExist(skillIds);

      const createdAssignmentId = await this.dataSource.transaction(
        async (manager) => {
          // Create assignment
          const assignment = manager.create(Assignment, {
            ...assignmentData,
            createdBy: user.id,
          });
          const savedAssignment = await manager.save(Assignment, assignment);

          // Create assignment skills
          const assignmentSkills = skillIds.map((skillId) =>
            manager.create(AssignmentSkill, {
              assignmentId: savedAssignment.id,
              skillId: skillId,
            }),
          );
          await manager.save(AssignmentSkill, assignmentSkills);

          return savedAssignment.id;
        },
      );

      const createdAssignment = await this.findOneById(createdAssignmentId);
      return plainToInstance(AssignmentDto, createdAssignment, {
        excludeExtraneousValues: true,
      });
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Error creating assignment',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        error.message,
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

  private async findOneById(id: string): Promise<Assignment> {
    const assignment = await this.assignmentRepository.findOne({
      where: { id, isDeleted: false },
      relations: ['skills', 'skills.skill', 'task'],
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    return assignment;
  }

  async findAll(
    status?: 'Todo' | 'InProgress' | 'Submitted' | 'Reviewed',
    isAssigned?: boolean,
  ): Promise<AssignmentDto[]> {
    try {
      const whereCondition: any = {
        isDeleted: false,
      };

      if (status) {
        whereCondition.status = status;
      }

      if (isAssigned !== undefined) {
        whereCondition.isAssigned = isAssigned;
      }

      const assignments = await this.assignmentRepository
        .createQueryBuilder('assignment')
        .leftJoinAndSelect('assignment.skills', 'skills')
        .leftJoinAndSelect('skills.skill', 'skill')
        .leftJoinAndSelect('assignment.task', 'task')
        .leftJoinAndSelect('assignment.assignee', 'assignee')
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        .where(whereCondition)
        .getMany();

      return plainToInstance(AssignmentDto, assignments, {
        excludeExtraneousValues: true,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching assignments',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        error.message,
      );
    }
  }

  async findAllByUser(
    user: SimpleUserDto,
    status?: 'Todo' | 'InProgress' | 'Submitted' | 'Reviewed',
    isAssigned?: boolean,
  ): Promise<AssignmentDto[]> {
    try {
      const whereCondition: any = {
        isDeleted: false,
      };

      if (user.role === 'intern') {
        whereCondition.assignedTo = user.id;
      } else if (user.role === 'mentor') {
        whereCondition.createdBy = user.id;
      }

      if (status) {
        whereCondition.status = status;
      }

      if (isAssigned !== undefined) {
        whereCondition.isAssigned = isAssigned;
      }

      const assignments = await this.assignmentRepository
        .createQueryBuilder('assignment')
        .leftJoinAndSelect('assignment.skills', 'skills')
        .leftJoinAndSelect('skills.skill', 'skill')
        .leftJoinAndSelect('assignment.task', 'task')
        .leftJoinAndSelect('assignment.assignee', 'assignee')
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        .where(whereCondition)
        .getMany();

      return plainToInstance(AssignmentDto, assignments, {
        excludeExtraneousValues: true,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching assignments',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        error.message,
      );
    }
  }

  async findOne(
    id: string,
    user: SimpleUserDto,
    isAssigned?: boolean,
  ): Promise<AssignmentDto> {
    try {
      const whereCondition: any = {
        id: id,
        isDeleted: false,
        isAssigned: true,
      };

      if (user.role === 'intern') {
        whereCondition.assignedTo = user.id;
      } else if (user.role === 'mentor') {
        whereCondition.createdBy = user.id;
      }

      if (isAssigned !== undefined) {
        whereCondition.isAssigned = isAssigned;
      }

      const assignment = await this.assignmentRepository
        .createQueryBuilder('assignment')
        .leftJoinAndSelect('assignment.skills', 'skills')
        .leftJoinAndSelect('skills.skill', 'skill')
        .leftJoinAndSelect('assignment.task', 'task')
        .leftJoinAndSelect('assignment.assignee', 'assignee')
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        .where(whereCondition)
        .getOne();

      if (!assignment) {
        throw new NotFoundException('Assignment not found');
      }

      return plainToInstance(AssignmentDto, assignment, {
        excludeExtraneousValues: true,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching assignment',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        error.message,
      );
    }
  }

  async updateStatus(
    id: string,
    user: SimpleUserDto,
    status: 'Todo' | 'InProgress' | 'Submitted' | 'Reviewed',
  ): Promise<AssignmentDto> {
    try {
      const whereCondition: any = {
        id: id,
        isDeleted: false,
      };

      if (user.role === 'intern') {
        whereCondition.assignedTo = user.id;
      }

      const assignment = await this.assignmentRepository.findOne({
        where: whereCondition,
      });

      if (!assignment) {
        throw new NotFoundException('Assignment not found');
      }

      if (!status) {
        throw new BadRequestException('Status is required');
      }

      if (user.role === 'intern') {
        if (status === 'Reviewed') {
          throw new ForbiddenException(
            'Only mentors can change the status to Reviewed',
          );
        }
        if (assignment.status === 'Reviewed') {
          throw new ForbiddenException(
            'Only mentors can change the status from Reviewed',
          );
        }
      }

      assignment.status = status;
      await this.assignmentRepository.save(assignment);

      // Gửi thông báo realtime (dùng tên người gửi, phân biệt role)
      try {
        const senderName = user.fullName || user.username || 'User';
        if (status === 'Submitted' && assignment.createdBy) {
          // Chỉ thông báo mentor khi chính intern nộp bài; mentor kéo về Submitted thì không gửi
          if (user.role === 'intern') {
            await this.notificationsService.createAndSend({
              recipientId: assignment.createdBy,
              senderId: user.id,
              type: NotificationType.ASSIGNMENT_SUBMITTED,
              title: 'Assignment submitted',
              message: `${senderName} submitted an assignment`,
              data: { assignmentId: id },
            });
          }
        } else if (status === 'Reviewed' && assignment.assignedTo) {
          await this.notificationsService.createAndSend({
            recipientId: assignment.assignedTo,
            senderId: user.id,
            type: NotificationType.ASSIGNMENT_REVIEWED,
            title: 'Assignment reviewed',
            message: `${senderName} reviewed your assignment`,
            data: { assignmentId: id },
          });
        }
      } catch (error) {
        console.error('Failed to send notification:', error.message);
      }

      return plainToInstance(AssignmentDto, assignment, {
        excludeExtraneousValues: true,
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
        `Error updating assignment status to ${status}`,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        error.message,
      );
    }
  }

  async submit(
    id: string,
    user: SimpleUserDto,
    data: string,
  ): Promise<AssignmentDto> {
    try {
      const whereCondition: any = {
        id: id,
        isDeleted: false,
      };

      if (user.role === 'intern') {
        whereCondition.assignedTo = user.id;
      }

      const assignment = await this.assignmentRepository.findOne({
        where: whereCondition,
      });

      if (!assignment) {
        throw new NotFoundException('Assignment not found');
      }

      assignment.submittedAt = new Date();
      assignment.submittedLink = data;
      // assignment.status = 'Submitted';

      await this.assignmentRepository.save(assignment);

      return plainToInstance(AssignmentDto, assignment, {
        excludeExtraneousValues: true,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Error submitting assignment',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        error.message,
      );
    }
  }

  async review(
    id: string,
    user: SimpleUserDto,
    data: string,
  ): Promise<AssignmentDto> {
    try {
      const whereCondition: any = {
        id: id,
        isDeleted: false,
      };

      if (user.role === 'mentor') {
        whereCondition.createdBy = user.id;
      }

      const assignment = await this.assignmentRepository.findOne({
        where: whereCondition,
      });

      if (!assignment) {
        throw new NotFoundException('Assignment not found');
      }

      assignment.feedback = data;
      // assignment.status = 'Reviewed';

      await this.assignmentRepository.save(assignment);

      // Gửi thông báo cho intern khi mentor feedback (có tên người gửi)
      try {
        if (assignment.assignedTo) {
          const senderName = user.fullName || user.username || 'Mentor';
          await this.notificationsService.createAndSend({
            recipientId: assignment.assignedTo,
            senderId: user.id,
            type: NotificationType.ASSIGNMENT_FEEDBACK,
            title: 'New feedback',
            message: `${senderName} left feedback on your assignment`,
            data: { assignmentId: id },
          });
        }
      } catch (error) {
        console.error('Failed to send notification:', error.message);
      }

      return plainToInstance(AssignmentDto, assignment, {
        excludeExtraneousValues: true,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Error reviewing assignment',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        error.message,
      );
    }
  }

  async update(
    id: string,
    user: SimpleUserDto,
    updateAssignmentDto: UpdateAssignmentDto,
  ): Promise<AssignmentDto> {
    try {
      const assignment = await this.assignmentRepository.findOne({
        where: { id: id, isDeleted: false },
        relations: ['skills'],
      });

      if (!assignment) {
        throw new NotFoundException('Assignment not found');
      }

      if (user.role !== 'admin' && assignment.createdBy !== user.id) {
        throw new ForbiddenException(
          'You can only update your own assignments',
        );
      }

      const { skillIds, ...assignmentData } = updateAssignmentDto;

      if (skillIds && skillIds.length > 0) {
        await this.validateSkillsExist(skillIds);
      }

      await this.dataSource.transaction(async (manager) => {
        await manager.update(Assignment, id, assignmentData);

        // delete old skill, create new skill
        // if (skillIds && skillIds.length > 0) {
        //   await manager.delete(AssignmentSkill, {
        //     assignmentId: id,
        //   });

        //   const newAssignmentSkills = skillIds.map((skillId) =>
        //     manager.create(AssignmentSkill, {
        //       assignmentId: id,
        //       skillId: skillId,
        //     }),
        //   );
        //   await manager.save(AssignmentSkill, newAssignmentSkills);
        // }

        if (skillIds) {
          const currentSkillIds = assignment.skills.map(
            (skill) => skill.skillId,
          );

          const skillsToAdd = skillIds.filter(
            (id) => !currentSkillIds.includes(id),
          );

          const skillToRemove = currentSkillIds.filter(
            (id) => !skillIds.includes(id),
          );

          if (skillToRemove.length > 0) {
            await manager.delete(AssignmentSkill, {
              assignmentId: id,
              skillId: In(skillToRemove),
            });
          }

          if (skillsToAdd.length > 0) {
            await manager.save(
              AssignmentSkill,
              skillsToAdd.map((skillId) => ({
                assignmentId: id,
                skillId: skillId,
              })),
            );
          }
        }
      });

      const updatedAssignment = await this.findOneById(id);

      return plainToInstance(AssignmentDto, updatedAssignment, {
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
        'Error updating assignment',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        error.message,
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

      const assignment = await this.assignmentRepository.findOne({
        where: whereCondition,
        relations: ['skills', 'trainingPlan'],
      });

      if (!assignment) throw new NotFoundException('Assignment not found');

      await this.checkAssignmentReferences(assignment);

      await this.dataSource.transaction(async (manager) => {
        await manager.update(Assignment, id, { isDeleted: true });

        await manager.update(
          AssignmentSkill,
          { assignmentId: id, isDeleted: false },
          { isDeleted: true },
        );
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
        'Error deleting assignment: ' + error.message,
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async checkAssignmentReferences(
    assignment: Assignment,
  ): Promise<void> {
    const references: string[] = [];

    // Không cho phép xóa assignment đã submit
    if (assignment.status === 'Submitted') {
      references.push('Assignment has been submitted');
    }

    // Không cho phép xóa assignment đã review
    if (assignment.status === 'Reviewed') {
      references.push('Assignment has been reviewed');
    }

    // Không cho phép xóa assignment đang được làm
    if (assignment.status === 'InProgress') {
      references.push('Assignment is currently in progress');
    }

    if (assignment.trainingPlan && assignment.trainingPlan.isDeleted) {
      references.push('Cannot delete assignment from a deleted training plan');
    }

    if (references.length > 0) {
      throw new BadRequestException(
        `Cannot delete assignment. Reasons: ${references.join(', ')}.`,
      );
    }
  }

  async restore(id: string, user: SimpleUserDto): Promise<any> {
    try {
      const whereCondition: any = {
        id: id,
        isDeleted: true,
      };

      if (user.role !== 'admin') {
        whereCondition.createdBy = user.id;
      }

      const assignment = await this.assignmentRepository.findOne({
        where: whereCondition,
      });

      if (!assignment) {
        throw new NotFoundException(
          'Deleted assignment not found or you do not have permission to restore this assignment',
        );
      }

      await this.dataSource.transaction(async (manager) => {
        await manager.update(Assignment, id, { isDeleted: false });

        await manager.update(
          AssignmentSkill,
          { assignmentId: id, isDeleted: true },
          { isDeleted: false },
        );
      });

      const restoredAssignment = await this.findOneById(id);

      return plainToInstance(AssignmentDto, restoredAssignment, {
        excludeExtraneousValues: true,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error restoring assignment: ' + error.message,
      );
    }
  }
}
