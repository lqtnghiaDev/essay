import { Test, TestingModule } from '@nestjs/testing';
import { AssignmentsService } from './assignments.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Assignment } from './entities/assignment.entity';
import { AssignmentSkill } from './entities/assignment-skill.entity';
import { Skill } from '../skills/entities/skill.entity';
import { DataSource } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';

describe('AssignmentsService', () => {
  let service: AssignmentsService;

  const mockAssignmentRepo = {
    find: jest.fn(),
    save: jest.fn(),
  };

  const mockAssignmentSkillRepo = {
    save: jest.fn(),
  };

  const mockSkillRepo = {
    find: jest.fn(),
  };

  const mockDataSource = {
    createQueryRunner: jest.fn(),
  };

  const mockNotificationsService = {
    sendNotification: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentsService,

        {
          provide: getRepositoryToken(Assignment),
          useValue: mockAssignmentRepo,
        },
        {
          provide: getRepositoryToken(AssignmentSkill),
          useValue: mockAssignmentSkillRepo,
        },
        {
          provide: getRepositoryToken(Skill),
          useValue: mockSkillRepo,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    }).compile();

    service = module.get<AssignmentsService>(AssignmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
