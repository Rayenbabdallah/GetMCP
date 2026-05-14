import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GeneratorModule } from './generator/generator.module';

@Module({
  imports: [GeneratorModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
