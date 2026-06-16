import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SkillsService } from './skills.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Skill } from './entities/skill.entity';
import { DataSource } from 'typeorm';

describe('SkillsService', () => {
  let service: SkillsService;

  const mockSkillRepository = {
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
        SkillsService,
        {
          provide: getRepositoryToken(Skill),
          useValue: mockSkillRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<SkillsService>(SkillsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('saves skill with createdBy and returns SkillDto', async () => {
      const dto = { name: 'NestJS', description: 'Framework' };
      const saved = makeSkill({ name: 'NestJS', createdBy: 'mentor-1' });
      mockRepository.save.mockResolvedValue(saved);

      const result = await service.create(dto as any, 'mentor-1');

      expect(mockRepository.save).toHaveBeenCalledWith({
        ...dto,
        createdBy: 'mentor-1',
      });
      expect(result).toBeDefined();
    });
  });

  describe('findOne', () => {
    it('returns skill when admin requests any skill', async () => {
      mockRepository.findOne.mockResolvedValue(makeSkill());

      const result = await service.findOne('skill-1', mockAdmin);

      // admin has no createdBy filter
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'skill-1', isDeleted: false },
      });
      expect(result).toBeDefined();
    });

    it('returns skill when owner requests it', async () => {
      mockRepository.findOne.mockResolvedValue(makeSkill());

      await service.findOne('skill-1', mockMentor);

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'skill-1', isDeleted: false, createdBy: 'mentor-1' },
      });
    });

    it('throws NotFoundException when skill does not exist', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('no-skill', mockAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates skill when user is the owner', async () => {
      const skill = makeSkill({ createdBy: 'mentor-1' });
      const updated = { ...skill, name: 'Updated' };
      mockRepository.findOne.mockResolvedValue(skill);
      mockRepository.save.mockResolvedValue(updated);

      const result = await service.update(
        'skill-1',
        { name: 'Updated' } as any,
        mockMentor,
      );

      expect(result).toBeDefined();
    });

    it('updates skill when user is admin (not owner)', async () => {
      const skill = makeSkill({ createdBy: 'mentor-1' });
      mockRepository.findOne.mockResolvedValue(skill);
      mockRepository.save.mockResolvedValue(skill);

      await expect(
        service.update('skill-1', { name: 'x' } as any, mockAdmin),
      ).resolves.toBeDefined();
    });

    it('throws ForbiddenException when non-owner non-admin tries to update', async () => {
      const skill = makeSkill({ createdBy: 'other-user' });
      mockRepository.findOne.mockResolvedValue(skill);

      await expect(
        service.update('skill-1', { name: 'x' } as any, mockMentor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when skill does not exist', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.update('no-skill', { name: 'x' } as any, mockAdmin),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('throws NotFoundException when skill does not exist', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.softDelete('no-skill', mockAdmin as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when non-owner non-admin tries to delete', async () => {
      mockRepository.findOne.mockResolvedValue(makeSkill({ createdBy: 'other-user' }));

      await expect(service.softDelete('skill-1', mockMentor as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws BadRequestException when skill is referenced by assignments or training plans', async () => {
      mockRepository.findOne.mockResolvedValue(makeSkill());

      const mockQb = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(2),
      };
      mockDataSource.getRepository.mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(mockQb),
      });

      await expect(service.softDelete('skill-1', mockMentor as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('soft deletes skill when owner requests and no references exist', async () => {
      mockRepository.findOne.mockResolvedValue(makeSkill({ createdBy: 'mentor-1' }));
      mockRepository.update.mockResolvedValue(undefined);

      const mockQb = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      };
      mockDataSource.getRepository.mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(mockQb),
      });

      await service.softDelete('skill-1', mockMentor as any);

      expect(mockRepository.update).toHaveBeenCalledWith('skill-1', {
        isDeleted: true,
      });
    });
  });
});
