import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({ imports: [AccessModule], providers: [DashboardService], controllers: [DashboardController] })
export class DashboardModule {}
