import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import { RAG_ES_INDEX_NAME, RAG_TOP_K } from '../rag.constants';
import type { RagDocument } from '../interfaces/rag-document.interface';
import { chunkRagDocuments, type RagChunk } from '../utils/rag-chunk.util';

export interface RagSearchFilter {
  scope: string;
  mentorId?: string;
  internId?: string;
}

@Injectable()
export class ElasticsearchService {
  private readonly logger = new Logger(ElasticsearchService.name);
  private client: Client | null = null;
  private indexReady = false;
  private readonly indexName = RAG_ES_INDEX_NAME;
  private readonly esUrl: string | null;

  constructor(private configService: ConfigService) {
    const url = this.configService.get<string>('ELASTICSEARCH_URL');
    const host = this.configService.get<string>('ELASTICSEARCH_HOST');
    this.esUrl =
      url ||
      (host
        ? `http://${host}:${this.configService.get('ELASTICSEARCH_PORT') || 9200}`
        : null);
  }

  isConfigured(): boolean {
    return !!this.esUrl;
  }

  private getClient(): Client | null {
    if (!this.esUrl) {
      this.logger.warn(
        'ELASTICSEARCH_URL not set; full-text RAG branch will be empty.',
      );
      return null;
    }
    if (!this.client) {
      this.client = new Client({ node: this.esUrl });
      this.logger.log(`Elasticsearch client connected: ${this.esUrl}`);
    }
    return this.client;
  }

  private async ensureIndex(): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;
    if (this.indexReady) return true;

    const exists = await client.indices.exists({ index: this.indexName });
    if (!exists) {
      await client.indices.create({
        index: this.indexName,
        mappings: {
          properties: {
            content: { type: 'text' },
            scope: { type: 'keyword' },
            type: { type: 'keyword' },
            entityId: { type: 'keyword' },
            mentorId: { type: 'keyword' },
            internId: { type: 'keyword' },
            chunkId: { type: 'keyword' },
          },
        },
      });
      this.logger.log(`Created Elasticsearch index: ${this.indexName}`);
    }
    this.indexReady = true;
    return true;
  }

  async clearIndex(): Promise<void> {
    const client = this.getClient();
    if (!client) return;

    try {
      const exists = await client.indices.exists({ index: this.indexName });
      if (exists) {
        await client.indices.delete({ index: this.indexName });
        this.logger.log(`Deleted Elasticsearch index: ${this.indexName}`);
      }
    } catch (e) {
      this.logger.warn('Failed to clear Elasticsearch index', e);
    }
    this.indexReady = false;
  }

  async addDocuments(documents: RagDocument[]): Promise<void> {
    if (documents.length === 0) return;
    const ready = await this.ensureIndex();
    if (!ready) return;

    const client = this.getClient();
    if (!client) return;

    const chunks = await chunkRagDocuments(documents);
    if (chunks.length === 0) return;

    const operations = chunks.flatMap((chunk) => [
      { index: { _index: this.indexName, _id: chunk.chunkId } },
      this.toEsDocument(chunk),
    ]);

    const batchSize = 500;
    for (let i = 0; i < operations.length; i += batchSize * 2) {
      const batch = operations.slice(i, i + batchSize * 2);
      const response = await client.bulk({ refresh: true, operations: batch });
      if (response.errors) {
        const failed = response.items?.filter((item) => item.index?.error);
        this.logger.warn(
          `Elasticsearch bulk index had ${failed?.length ?? 0} errors`,
        );
      }
    }

    this.logger.log(
      `Indexed ${chunks.length} chunks from ${documents.length} documents to ES`,
    );
  }

  async fullTextSearch(
    query: string,
    k: number = RAG_TOP_K,
    filter: RagSearchFilter,
  ): Promise<RagChunk[]> {
    const client = this.getClient();
    if (!client) return [];

    try {
      const ready = await this.ensureIndex();
      if (!ready) return [];

      const filterClauses: Record<string, unknown>[] = [
        { term: { scope: filter.scope } },
      ];
      if (filter.mentorId) {
        filterClauses.push({ term: { mentorId: filter.mentorId } });
      }
      if (filter.internId) {
        filterClauses.push({ term: { internId: filter.internId } });
      }

      const response = await client.search({
        index: this.indexName,
        size: k,
        query: {
          bool: {
            must: [{ match: { content: query } }],
            filter: filterClauses,
          },
        },
      });

      return (response.hits.hits ?? [])
        .map((hit) => this.fromEsHit(hit._source))
        .filter((chunk): chunk is RagChunk => chunk !== null);
    } catch (e) {
      this.logger.error('Elasticsearch full-text search failed', e);
      return [];
    }
  }

  private toEsDocument(chunk: RagChunk): Record<string, string> {
    const doc: Record<string, string> = {
      content: chunk.content,
      scope: chunk.metadata.scope,
      type: chunk.metadata.type,
      entityId: chunk.metadata.entityId,
      chunkId: chunk.chunkId,
    };
    if (chunk.metadata.mentorId) doc.mentorId = chunk.metadata.mentorId;
    if (chunk.metadata.internId) doc.internId = chunk.metadata.internId;
    return doc;
  }

  private fromEsHit(source: unknown): RagChunk | null {
    if (!source || typeof source !== 'object') return null;
    const s = source as Record<string, string>;
    if (!s.content || !s.chunkId || !s.scope || !s.type || !s.entityId) {
      return null;
    }
    return {
      chunkId: s.chunkId,
      content: s.content,
      metadata: {
        scope: s.scope as RagChunk['metadata']['scope'],
        type: s.type,
        entityId: s.entityId,
        mentorId: s.mentorId,
        internId: s.internId,
      },
    };
  }
}
