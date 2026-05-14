import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GeneratorModule } from './generator/generator.module';
import { ProxyModule } from './proxy/proxy.module';

@Module({
  imports: [GeneratorModule, ProxyModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
