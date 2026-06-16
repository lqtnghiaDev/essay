import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { InternsInformationService } from '../interns-information/interns-information.service';
import { DataSource } from 'typeorm';

describe('UsersService', () => {
  let service: UsersService;

  const mockUserRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockInternsInformationService = {
    findOne: jest.fn(),
  };

  const mockDataSource = {
    createQueryRunner: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,

        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: InternsInformationService,
          useValue: mockInternsInformationService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  describe('findByUsername', () => {
    it('returns user when found', async () => {
      const user = makeUser();
      mockRepository.findOne.mockResolvedValue(user);

      const result = await service.findByUsername('testuser');

      expect(result).toEqual(user);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { username: 'testuser', isDeleted: false },
      });
    });

    it('throws HttpException when user does not exist', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.findByUsername('nobody')).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('softDelete', () => {
    it('throws BadRequestException when deleting own account', async () => {
      await expect(
        service.softDelete('admin-1', mockAdminUser as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when non-admin tries to delete', async () => {
      await expect(
        service.softDelete('user-1', mockMentorUser as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when target user does not exist', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.softDelete('user-1', mockAdminUser as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when intern has an active training plan', async () => {
      const intern = makeUser({
        role: 'intern',
        internInformation: { planId: 'plan-1' } as any,
      });
      mockRepository.findOne.mockResolvedValue(intern);

      await expect(
        service.softDelete('user-1', mockAdminUser as any),
      ).rejects.toThrow(ConflictException);
    });

    it('soft deletes intern and their information in a transaction', async () => {
      const intern = makeUser({ role: 'intern', internInformation: null });
      mockRepository.findOne.mockResolvedValue(intern);
      mockDataSource.transaction.mockResolvedValue(undefined);

      await service.softDelete('user-1', mockAdminUser as any);

      expect(mockDataSource.transaction).toHaveBeenCalled();
    });

    it('throws BadRequestException when mentor has active references', async () => {
      const mentor = makeUser({ role: 'mentor' });
      mockRepository.findOne.mockResolvedValue(mentor);

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(2),
      };
      mockDataSource.getRepository.mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(mockQb),
      });

      await expect(
        service.softDelete('user-1', mockAdminUser as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
