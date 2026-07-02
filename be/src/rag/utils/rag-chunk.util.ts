import { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { RAG_CHUNK_OVERLAP, RAG_CHUNK_SIZE } from '../rag.constants';
import type {
  RagDocument,
  RagDocumentMetadata,
} from '../interfaces/rag-document.interface';

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: RAG_CHUNK_SIZE,
  chunkOverlap: RAG_CHUNK_OVERLAP,
  separators: ['\n\n', '\n', '. ', ' ', ''],
});

export interface RagChunk {
  chunkId: string;
  content: string;
  metadata: RagDocumentMetadata;
}

function buildChunkId(meta: RagDocumentMetadata, chunkIndex: number): string {
  const base = `${meta.scope}:${meta.type}:${meta.entityId}`;
  if (meta.mentorId) return `${base}:m:${meta.mentorId}:${chunkIndex}`;
  if (meta.internId) return `${base}:i:${meta.internId}:${chunkIndex}`;
  return `${base}:${chunkIndex}`;
}

export async function chunkRagDocuments(
  documents: RagDocument[],
): Promise<RagChunk[]> {
  const chunks: RagChunk[] = [];
  for (const doc of documents) {
    const parts = await textSplitter.splitText(doc.content);
    parts.forEach((text, index) => {
      chunks.push({
        chunkId: buildChunkId(doc.metadata, index),
        content: text,
        metadata: doc.metadata,
      });
    });
  }
  return chunks;
}

export function ragChunkToLangChainDocument(chunk: RagChunk): Document {
  const meta: Record<string, string> = {
    scope: chunk.metadata.scope,
    type: chunk.metadata.type,
    entityId: chunk.metadata.entityId,
    chunkId: chunk.chunkId,
  };
  if (chunk.metadata.mentorId) meta.mentorId = chunk.metadata.mentorId;
  if (chunk.metadata.internId) meta.internId = chunk.metadata.internId;
  return new Document({ pageContent: chunk.content, metadata: meta });
}

export function getChunkIdFromDocument(doc: Document): string {
  const m = doc.metadata as Record<string, string>;
  if (m?.chunkId) return m.chunkId;
  return `${m?.scope ?? ''}:${m?.type ?? ''}:${m?.entityId ?? ''}:${doc.pageContent.slice(0, 64)}`;
}
