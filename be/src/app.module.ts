import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { SkillsModule } from './skills/skills.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { InternsInformationModule } from './interns-information/interns-information.module';
import { TasksModule } from './tasks/tasks.module';
import { TrainingPlansModule } from './training-plans/training-plans.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ChatModule } from './chat/chat.module';
import { RagModule } from './rag/rag.module';
import { AttendanceModule } from './attendance/attendance.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { LoggerModule } from 'nestjs-pino';
import { pinoLoggerConfig } from './observability/pino-logger.config';
import 'dotenv/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    LoggerModule.forRoot(pinoLoggerConfig),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: true,
      ssl: {},
    }),
    ScheduleModule.forRoot(),
    SkillsModule,
    UsersModule,
    AuthModule,
    InternsInformationModule,
    TasksModule,
    TrainingPlansModule,
    AssignmentsModule,
    DashboardModule,
    ChatModule,
    RagModule,
    AttendanceModule,
    NotificationsModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
