export interface VectorChunk {
  id: string;
  workItemId: number;
  // 'context' chunks come from cluster summaries, not individual work items
  chunkType: 'title_ac' | 'description' | 'relations' | 'history' | 'context';
  text: string;
  vector: number[];
}

export interface SearchResult {
  workItemId: number;
  chunkType: string;
  text: string;
  score: number;
}

export interface VectorizeOptions {
  storeDir?: string;
  embeddingModel?: 'local' | 'openai';
  localModel?: string;
  openaiModel?: string;
  openaiApiKey?: string;
}
