import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { IndexingService } from './services/indexing.service';

@ApiTags('rag')
@ApiBearerAuth()
@Controller('rag')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class RagController {
  constructor(private readonly indexingService: IndexingService) {}

  @ApiOperation({
    summary:
      'Reindex toàn bộ dữ liệu vào RAG (Chroma + Elasticsearch). Chỉ admin.',
  })
  @Post('reindex')
  async reindex() {
    return this.indexingService.reindexAll();
  }
}
