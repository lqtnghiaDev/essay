import { Injectable, Logger } from '@nestjs/common';
import { VectorStoreService } from './vector-store.service';
import { ElasticsearchService } from './elasticsearch.service';
import { RAG_TOP_K, RRF_K } from '../rag.constants';
import { reciprocalRankFusion } from '../utils/rrf.util';
import { getChunkIdFromDocument } from '../utils/rag-chunk.util';
import type { RagSearchFilter } from './elasticsearch.service';

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private vectorStoreService: VectorStoreService,
    private elasticsearchService: ElasticsearchService,
  ) {}

  /**
   * Hybrid retrieval: vector similarity + ES full-text, merged with RRF.
   */
  async retrieveContext(
    query: string,
    filter: RagSearchFilter,
    k: number = RAG_TOP_K,
  ): Promise<string> {
    const [vectorResults, esResults] = await Promise.all([
      this.vectorStoreService.similaritySearch(query, k, filter),
      this.elasticsearchService.fullTextSearch(query, k, filter),
    ]);

    const vectorRanked = vectorResults.map((doc, index) => ({
      id: getChunkIdFromDocument(doc),
      content: doc.pageContent,
      rank: index + 1,
    }));

    const esRanked = esResults.map((chunk, index) => ({
      id: chunk.chunkId,
      content: chunk.content,
      rank: index + 1,
    }));

    const rankedLists = [vectorRanked, esRanked].filter(
      (list) => list.length > 0,
    );
    if (rankedLists.length === 0) return '';

    const fused =
      rankedLists.length === 1
        ? rankedLists[0].map((item) => ({
            id: item.id,
            content: item.content,
            score: 1 / (RRF_K + item.rank),
          }))
        : reciprocalRankFusion(rankedLists, RRF_K);

    this.logger.debug(
      `Hybrid RAG: vector=${vectorRanked.length}, es=${esRanked.length}, fused=${fused.length}`,
    );

    return fused
      .slice(0, k)
      .map((item) => item.content)
      .filter(Boolean)
      .join('\n\n');
  }
}
