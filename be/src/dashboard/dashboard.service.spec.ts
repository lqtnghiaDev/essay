import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { InternInformation } from '../interns-information/entities/intern-information.entity';

describe('DashboardService', () => {
  let service: DashboardService;

  const mockUserRepository = {
    find: jest.fn(),
    count: jest.fn(),
  };

  const mockInternInfoRepository = {
    find: jest.fn(),
    count: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,

        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },

        {
          provide: getRepositoryToken(InternInformation),
          useValue: mockInternInfoRepository,
        },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
