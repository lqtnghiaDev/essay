/**
 * RAG constants: collection name, chunk size, retrieval top-k
 */
export const RAG_COLLECTION_NAME = 'internship_management_rag';
export const RAG_ES_INDEX_NAME = 'internship_management_rag';
export const RAG_CHUNK_SIZE = 2000;
export const RAG_CHUNK_OVERLAP = 300;
export const RAG_TOP_K = 5;
export const RAG_MEMORY_MESSAGE_LIMIT = 10;
/** Reciprocal Rank Fusion constant (typical value: 60) */
export const RRF_K = 60;
