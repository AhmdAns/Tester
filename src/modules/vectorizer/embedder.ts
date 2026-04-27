import { logger } from '../../utils/logger.js';

type EmbedderOptions =
  | { type: 'local'; modelId: string }
  | { type: 'openai'; modelId: string; apiKey: string };

export class Embedder {
  private localPipeline: unknown = null;
  private firstRun = true;

  constructor(private readonly opts: EmbedderOptions) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (this.opts.type === 'openai') {
      return this.embedOpenAI(texts);
    }
    return this.embedLocal(texts);
  }

  async embedSingle(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    return results[0]!;
  }

  private async embedLocal(texts: string[]): Promise<number[][]> {
    if (!this.localPipeline) {
      if (this.firstRun) {
        logger.info(
          { model: (this.opts as { type: 'local'; modelId: string }).modelId },
          'Loading local embedding model (first run may take 15-30s to download ~90MB weights)...',
        );
        this.firstRun = false;
      }

      try {
        const { pipeline } = await import('@huggingface/transformers');
        this.localPipeline = await pipeline(
          'feature-extraction',
          (this.opts as { type: 'local'; modelId: string }).modelId,
          { dtype: 'fp32' } as Record<string, unknown>,
        );
        logger.info('Local embedding model loaded.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to load local embedding model. ` +
            `Try setting vectorizer.embeddingModel to "openai" in config if WASM is unavailable. ` +
            `Underlying error: ${msg}`,
        );
      }
    }

    const results: number[][] = [];
    for (const text of texts) {
      const output = await (
        this.localPipeline as (
          text: string,
          opts: Record<string, unknown>,
        ) => Promise<{ data: Float32Array }>
      )(text, { pooling: 'mean', normalize: true });
      results.push(Array.from(output.data));
    }
    return results;
  }

  private async embedOpenAI(texts: string[]): Promise<number[][]> {
    const { apiKey, modelId } = this.opts as { type: 'openai'; apiKey: string; modelId: string };
    const { default: axios } = await import('axios');
    const res = await axios.post<{ data: Array<{ embedding: number[] }> }>(
      'https://api.openai.com/v1/embeddings',
      { model: modelId, input: texts },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } },
    );
    return res.data.data.map((d) => d.embedding);
  }

  static fromConfig(opts: {
    embeddingModel: 'local' | 'openai';
    localModel: string;
    openaiModel: string;
    openaiApiKey?: string;
  }): Embedder {
    if (opts.embeddingModel === 'openai') {
      const apiKey = opts.openaiApiKey ?? process.env.OPENAI_API_KEY ?? '';
      if (!apiKey) {
        throw new Error(
          'OpenAI embeddings require OPENAI_API_KEY env var or vectorizer.openaiApiKey in config.',
        );
      }
      return new Embedder({ type: 'openai', modelId: opts.openaiModel, apiKey });
    }
    return new Embedder({ type: 'local', modelId: opts.localModel });
  }
}
