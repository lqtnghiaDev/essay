import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { InternInformation } from 'src/interns-information/entities/intern-information.entity';
import { TrainingPlan } from 'src/training-plans/entities/training-plan.entity';
import { Task } from 'src/tasks/entities/task.entity';
import { Attendance } from 'src/attendance/entities/attendance.entity';
import { Skill } from 'src/skills/entities/skill.entity';
import { Assignment } from 'src/assignments/entities/assignment.entity';
import { DocumentExtractorService } from './services/document-extractor.service';
import { EmbeddingService } from './services/embedding.service';
import { VectorStoreService } from './services/vector-store.service';
import { ElasticsearchService } from './services/elasticsearch.service';
import { IndexingService } from './services/indexing.service';
import { RetrievalService } from './services/retrieval.service';
import { RagController } from './rag.controller';
import { RagDebugController } from './controllers/rag-debug.controller';
import { LlmModule } from 'src/llm/llm.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      InternInformation,
      TrainingPlan,
      Task,
      Attendance,
      Skill,
      Assignment,
    ]),
    LlmModule,
  ],
  controllers: [RagController, RagDebugController],
  providers: [
    DocumentExtractorService,
    EmbeddingService,
    VectorStoreService,
    ElasticsearchService,
    IndexingService,
    RetrievalService,
  ],
  exports: [VectorStoreService, EmbeddingService, RetrievalService],
})
export class RagModule {}
