import { Test, TestingModule } from '@nestjs/testing';
import { TrainingPlansService } from './training-plans.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TrainingPlan } from './entities/training-plan.entity';
import { Skill } from 'src/skills/entities/skill.entity';
import { InternInformation } from 'src/interns-information/entities/intern-information.entity';
import { InternsInformationService } from 'src/interns-information/interns-information.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { DataSource } from 'typeorm';

describe('TrainingPlansService', () => {
  let service: TrainingPlansService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainingPlansService,
        {
          provide: getRepositoryToken(TrainingPlan),
          useValue: {},
        },
        {
          provide: getRepositoryToken(Skill),
          useValue: {},
        },
        {
          provide: getRepositoryToken(InternInformation),
          useValue: {},
        },
        {
          provide: InternsInformationService,
          useValue: {},
        },
        {
          provide: NotificationsService,
          useValue: {},
        },
        {
          provide: DataSource,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<TrainingPlansService>(TrainingPlansService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
