import { Test, TestingModule } from '@nestjs/testing';
import { InternsInformationController } from './interns-information.controller';
import { InternsInformationService } from './interns-information.service';

describe('InternsInformationController', () => {
  let controller: InternsInformationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InternsInformationController],
      providers: [
        {
          provide: InternsInformationService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<InternsInformationController>(
      InternsInformationController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
