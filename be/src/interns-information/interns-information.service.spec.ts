import { Test, TestingModule } from '@nestjs/testing';
import { InternsInformationService } from './interns-information.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InternInformation } from './entities/intern-information.entity';

describe('InternsInformationService', () => {
  let service: InternsInformationService;

  const mockInternRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InternsInformationService,

        {
          provide: getRepositoryToken(InternInformation),
          useValue: mockInternRepository,
        },
      ],
    }).compile();

    service = module.get<InternsInformationService>(InternsInformationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
