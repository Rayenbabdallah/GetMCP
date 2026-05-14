import { Test, TestingModule } from '@nestjs/testing';
import { GeneratorController } from './generator.controller';
import { GeneratorService } from './generator.service';

describe('GeneratorController', () => {
  let controller: GeneratorController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GeneratorController],
      providers: [{ provide: GeneratorService, useValue: {} }],
    }).compile();

    controller = module.get<GeneratorController>(GeneratorController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
