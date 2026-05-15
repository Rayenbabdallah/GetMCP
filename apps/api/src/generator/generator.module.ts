import { Module } from '@nestjs/common';
import { GeneratorService } from './generator.service';
import { GeneratorController } from './generator.controller';
import { ClassifierService } from './classifier.service';

@Module({
  providers: [GeneratorService, ClassifierService],
  controllers: [GeneratorController],
  exports: [GeneratorService, ClassifierService],
})
export class GeneratorModule {}
