import { Injectable, Logger } from '@nestjs/common';
import { DocumentExtractorService } from './document-extractor.service';
import { VectorStoreService } from './vector-store.service';
import { ElasticsearchService } from './elasticsearch.service';

@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);

  constructor(
    private documentExtractor: DocumentExtractorService,
    private vectorStore: VectorStoreService,
    private elasticsearchService: ElasticsearchService,
  ) {}

  /**
   * Full reindex: extract docs for admin + all mentors + all interns,
   * then index into Chroma (vector) and Elasticsearch (full-text).
   */
  async reindexAll(): Promise<{ documentsCount: number; message: string }> {
    await Promise.all([
      Promise.resolve(this.vectorStore.clearStore()),
      this.elasticsearchService.clearIndex(),
    ]);

    const [adminDocs, mentorIds, internIds] = await Promise.all([
      this.documentExtractor.extractForAdmin(),
      this.documentExtractor.getAllMentorIds(),
      this.documentExtractor.getAllInternIds(),
    ]);

    let total = 0;
    await this.indexDocuments(adminDocs);
    total += adminDocs.length;

    for (const mentorId of mentorIds) {
      const docs = await this.documentExtractor.extractForMentor(mentorId);
      await this.indexDocuments(docs);
      total += docs.length;
    }

    for (const internId of internIds) {
      const docs = await this.documentExtractor.extractForIntern(internId);
      await this.indexDocuments(docs);
      total += docs.length;
    }

    this.logger.log(`RAG reindex completed: ${total} documents (vector + ES).`);
    return {
      documentsCount: total,
      message: `Đã index ${total} document vào Chroma và Elasticsearch (admin + ${mentorIds.length} mentor + ${internIds.length} intern).`,
    };
  }

  private async indexDocuments(
    documents: Awaited<ReturnType<DocumentExtractorService['extractForAdmin']>>,
  ): Promise<void> {
    if (documents.length === 0) return;
    await Promise.all([
      this.vectorStore.addDocuments(documents),
      this.elasticsearchService.addDocuments(documents),
    ]);
  }
}
