import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Document } from '@langchain/core/documents';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { VectorStore } from '@langchain/core/vectorstores';
import { EmbeddingService } from './embedding.service';
import { RAG_COLLECTION_NAME, RAG_TOP_K } from '../rag.constants';
import type { RagDocument } from '../interfaces/rag-document.interface';
import {
  chunkRagDocuments,
  ragChunkToLangChainDocument,
} from '../utils/rag-chunk.util';

@Injectable()
export class VectorStoreService {
  private readonly logger = new Logger(VectorStoreService.name);
  private vectorStore: VectorStore | null = null;
  private readonly chromaUrl: string | null;
  private readonly collectionName = RAG_COLLECTION_NAME;

  constructor(
    private configService: ConfigService,
    private embeddingService: EmbeddingService,
  ) {
    const url = this.configService.get<string>('CHROMA_URL');
    const host = this.configService.get<string>('CHROMA_HOST');
    this.chromaUrl =
      url ||
      (host
        ? `http://${host}:${this.configService.get('CHROMA_PORT') || 8000}`
        : null);
  }

  /**
   * Get or create vector store. Uses Chroma if CHROMA_URL/CHROMA_HOST set, else InMemory (dev).
   */
  private getVectorStore(): VectorStore | null {
    const embeddings = this.embeddingService.getEmbeddings();
    if (!embeddings) {
      this.logger.warn(
        'Embeddings not configured; RAG retrieval will be empty.',
      );
      return null;
    }

    if (this.vectorStore) return this.vectorStore;

    if (this.chromaUrl) {
      try {
        this.vectorStore = new Chroma(embeddings, {
          url: this.chromaUrl,
          collectionName: this.collectionName,
        });
        this.logger.log(`Chroma vector store connected: ${this.chromaUrl}`);
      } catch (e) {
        this.logger.warn('Chroma connection failed, using in-memory store', e);
        this.vectorStore = new MemoryVectorStore(embeddings);
      }
    } else {
      this.logger.log(
        'CHROMA_URL not set; using in-memory vector store (dev).',
      );
      this.vectorStore = new MemoryVectorStore(embeddings);
    }
    return this.vectorStore;
  }

  /**
   * Clear in-memory store (for full reindex). Chroma: delete collection manually or restart Chroma.
   */
  clearStore(): void {
    this.vectorStore = null;
    this.logger.log('Vector store cleared (in-memory).');
  }

  /**
   * Add documents to vector store (chunk -> embed -> add). Replaces collection if Chroma; appends if InMemory.
   */
  async addDocuments(documents: RagDocument[]): Promise<void> {
    if (documents.length === 0) return;
    const embeddings = this.embeddingService.getEmbeddings();
    if (!embeddings) return;

    const chunks = await chunkRagDocuments(documents);
    const chunked = chunks.map(ragChunkToLangChainDocument);
    const store = this.getVectorStore();
    if (!store) return;

    if (this.vectorStore instanceof Chroma) {
      await this.vectorStore.addDocuments(chunked);
    } else {
      await (this.vectorStore as MemoryVectorStore).addDocuments(chunked);
    }
    this.logger.log(
      `Added ${chunked.length} chunks from ${documents.length} documents`,
    );
  }

  /**
   * Replace entire collection: clear then add. InMemory: reset and add. Chroma: add to existing (run clear manually for full reindex).
   */
  async replaceCollection(documents: RagDocument[]): Promise<void> {
    const embeddings = this.embeddingService.getEmbeddings();
    if (!embeddings) return;

    if (!this.chromaUrl) {
      this.clearStore();
    }
    await this.addDocuments(documents);
  }

  /**
   * Similarity search with role-based filter. Returns top-k chunks.
   */
  async similaritySearch(
    query: string,
    k: number = RAG_TOP_K,
    filter: { scope: string; mentorId?: string; internId?: string },
  ): Promise<Document[]> {
    const store = this.getVectorStore();
    if (!store) {
      this.logger.warn(
        'Vector store không được khởi tạo. Có thể do embeddings chưa được cấu hình.',
      );
      return [];
    }

    // Chroma 'where' expects a single operator or a single condition.
    // When multiple filters exist, wrap them with an explicit $and operator.
    const conditions: Record<string, string>[] = [{ scope: filter.scope }];
    if (filter.mentorId) conditions.push({ mentorId: filter.mentorId });
    if (filter.internId) conditions.push({ internId: filter.internId });

    let where: any;
    if (conditions.length === 1) {
      where = conditions[0];
    } else {
      where = { $and: conditions };
    }

    try {
      this.logger.debug(
        `Tìm kiếm vector store. Query: "${query.substring(0, 100)}...", k: ${k}, filter: ${JSON.stringify(filter)}`,
      );

      let results: Document[];
      if (store instanceof Chroma) {
        results = await store.similaritySearch(query, k, where);
        this.logger.debug(
          `Chroma similarity search trả về ${results.length} kết quả`,
        );
      } else {
        const filterFn = (doc: Document) => {
          const m = doc.metadata as Record<string, string>;
          if (m?.scope !== filter.scope) return false;
          if (filter.mentorId && m?.mentorId !== filter.mentorId) return false;
          if (filter.internId && m?.internId !== filter.internId) return false;
          return true;
        };
        results = await (store as MemoryVectorStore).similaritySearch(
          query,
          k,
          filterFn,
        );
        this.logger.debug(
          `In-memory similarity search trả về ${results.length} kết quả`,
        );
      }
      return results.slice(0, k);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const storeType = store instanceof Chroma ? 'Chroma' : 'In-Memory';
      this.logger.error(
        `Similarity search thất bại (${storeType}). Query: "${query.substring(0, 100)}...". Chi tiết lỗi: ${errorMessage}`,
        errorStack,
      );
      return [];
    }
  }
}
