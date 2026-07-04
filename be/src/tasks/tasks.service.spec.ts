import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Task } from './entities/task.entity';
import { DataSource } from 'typeorm';

describe('TasksService', () => {
  let service: TasksService;

  const mockTaskRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const mockDataSource = {
    createQueryRunner: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,

        {
          provide: getRepositoryToken(Task),
          useValue: mockTaskRepository,
        },

        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates task with createdBy from user', async () => {
      const dto = { name: 'New Task', description: 'desc' };
      const created = makeTask();
      mockRepository.create.mockReturnValue(created);
      mockRepository.save.mockResolvedValue(created);

      const result = await service.create(dto as any, mockUser as any);

      expect(mockRepository.create).toHaveBeenCalledWith({
        ...dto,
        createdBy: 'user-1',
      });
      expect(result).toEqual(created);
    });

    it('throws InternalServerErrorException when save fails', async () => {
      mockRepository.create.mockReturnValue({});
      mockRepository.save.mockRejectedValue(new Error('DB error'));

      await expect(
        service.create({ name: 'Task' } as any, mockUser as any),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('findOne', () => {
    it('returns task when found', async () => {
      const task = makeTask();
      mockRepository.findOne.mockResolvedValue(task);

      const result = await service.findOne('task-1', mockUser as any);

      expect(result).toBeDefined();
      expect(mockRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1', isDeleted: false, createdBy: 'user-1' },
        }),
      );
    });

    it('throws NotFoundException when task does not exist', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.findOne('no-task', mockUser as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('throws NotFoundException when task is not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.softDelete('no-task', mockUser as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when task is used in assignments', async () => {
      mockRepository.findOne.mockResolvedValue(makeTask());

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(3),
      };
      mockDataSource.getRepository.mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(mockQb),
      });

      await expect(
        service.softDelete('task-1', mockUser as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('soft deletes task when no references exist', async () => {
      mockRepository.findOne.mockResolvedValue(makeTask());
      mockRepository.update.mockResolvedValue(undefined);

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      };
      mockDataSource.getRepository.mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(mockQb),
      });

      await service.softDelete('task-1', mockUser as any);

      expect(mockRepository.update).toHaveBeenCalledWith('task-1', {
        isDeleted: true,
      });
    });

    it('admin can delete any task regardless of createdBy', async () => {
      const adminUser = { id: 'admin-1', role: 'admin' };
      mockRepository.findOne.mockResolvedValue(
        makeTask({ createdBy: 'other-user' }),
      );
      mockRepository.update.mockResolvedValue(undefined);

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      };
      mockDataSource.getRepository.mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(mockQb),
      });

      await service.softDelete('task-1', adminUser as any);

      // admin does not filter by createdBy
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'task-1', isDeleted: false },
      });
    });
  });
});
