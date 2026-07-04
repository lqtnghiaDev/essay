/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { InternInformationDto } from 'src/interns-information/dto/intern-information.dto';
import { InternInformation } from 'src/interns-information/entities/intern-information.entity';
import { SimpleUserDto } from 'src/users/dto/simple-user.dto';
import { User } from 'src/users/entities/user.entity';
import { Repository } from 'typeorm';
import {
  FieldInternsCountResponse,
  InternsCountResponse,
  MentorInternsCountResponse,
  MonthlyInternsCountResponse,
} from './dto/dashboard-data.dto';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(InternInformation)
    private readonly internInfoRepository: Repository<InternInformation>,
  ) { }

  async getInternsCount(): Promise<InternsCountResponse> {
    try {
      const total = await this.internInfoRepository.count({
        where: { isDeleted: false },
      });

      const totalDistinctFields = await this.internInfoRepository
        .createQueryBuilder('intern')
        .select('COUNT(DISTINCT intern.field)', 'totalFields')
        .where('intern.isDeleted = false AND intern.field IS NOT NULL')
        .getRawOne();
      const totalFields = totalDistinctFields
        ? parseInt(totalDistinctFields.totalFields, 10)
        : 0;

      const completed = await this.internInfoRepository.count({
        where: { status: 'Completed', isDeleted: false },
      });

      const inProgress = await this.internInfoRepository.count({
        where: { status: 'InProgress', isDeleted: false },
      });

      const onboarding = await this.internInfoRepository.count({
        where: { status: 'Onboarding', isDeleted: false },
      });

      return {
        total,
        totalFields,
        completed,
        inProgress,
        onboarding,
      };
    } catch (error) {
      throw new InternalServerErrorException('Error fetching interns count');
    }
  }

  async getMonthlyInternsCount(): Promise<MonthlyInternsCountResponse[]> {
    try {
      const currentYear = new Date().getFullYear();

      const result = await this.internInfoRepository
        .createQueryBuilder('intern')
        .select("DATE_TRUNC('month', intern.startDate)", 'month')
        .addSelect('COUNT(*)', 'count')
        .where(
          'intern.isDeleted = false AND EXTRACT(YEAR FROM intern.startDate) = :year',
          { year: currentYear },
        )
        .groupBy('month')
        .orderBy('month', 'ASC')
        .getRawMany();

      return result.map((item) => ({
        month: item.month,
        count: parseInt(item.count, 10),
      }));
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching monthly interns count',
      );
    }
  }

  async getFieldInternsCount(): Promise<FieldInternsCountResponse[]> {
    try {
      const result = await this.internInfoRepository
        .createQueryBuilder('intern')
        .select('intern.field', 'field')
        .addSelect('COUNT(*)', 'count')
        .where('intern.isDeleted = false AND intern.field IS NOT NULL')
        .groupBy('intern.field')
        .orderBy('count', 'DESC')
        .getRawMany();

      return result.map((item) => ({
        field: item.field,
        count: parseInt(item.count, 10),
      }));
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching field interns count',
      );
    }
  }

  async getInternsPerMentor(): Promise<MentorInternsCountResponse[]> {
    try {
      const result = await this.internInfoRepository
        .createQueryBuilder('intern')
        .leftJoin(User, 'mentor', 'mentor.id = intern.mentorId')
        .select('mentor.fullName', 'mentor_name')
        .addSelect('COUNT(*)', 'count')
        .where(
          'intern.isDeleted = false AND intern.mentorId IS NOT NULL AND mentor.isDeleted = false',
        )
        .groupBy('mentor.id, mentor.fullName')
        .getRawMany();

      return result.map((row) => ({
        mentorName: row.mentor_name || 'Unknown Mentor',
        count: parseInt(row.count),
      }));
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching interns per mentor: ' + error.message,
      );
    }
  }

  async getAdminDashboardSummary() {
    try {
      const [
        internsCount,
        monthlyInternsCount,
        fieldInternsCount,
        mentorInternsCount,
      ] = await Promise.all([
        this.getInternsCount(),
        this.getMonthlyInternsCount(),
        this.getFieldInternsCount(),
        this.getInternsPerMentor(),
      ]);

      return {
        internsCount,
        internsByStatus: {
          completed: internsCount.completed,
          inProgress: internsCount.inProgress,
          onboarding: internsCount.onboarding,
        },
        monthlyInternsCount,
        fieldInternsCount,
        mentorInternsCount,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching admin dashboard summary: ' + error.message,
      );
    }
  }

  async getMentorDashboardSummary(user: SimpleUserDto): Promise<any> {
    try {
      const internsOfUser = await this.internInfoRepository
        .createQueryBuilder('internsInfo')
        .leftJoinAndSelect('internsInfo.intern', 'intern')
        .where('internsInfo.mentorId = :mentorId', { mentorId: user.id })
        .getMany();

      const myInterns = plainToInstance(InternInformationDto, internsOfUser, {
        excludeExtraneousValues: true,
      });

      const internsOfUserCount: any = {
        total: internsOfUser.length,
        completed: internsOfUser.filter(
          (intern) => intern.status === 'Completed',
        ).length,
        inProgress: internsOfUser.filter(
          (intern) => intern.status === 'InProgress',
        ).length,
        onboarding: internsOfUser.filter(
          (intern) => intern.status === 'Onboarding',
        ).length,
      };

      return {
        myInterns,
        internsOfUserCount,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        'Error fetching mentor dashboard summary: ' + error.message,
      );
    }
  }
}
