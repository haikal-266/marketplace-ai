import { PipelineStage } from './pipeline.types';
import { createLogger } from '../utils/logger';

const log = createLogger('Pipeline');

/**
 * Pipeline orchestrator — menjalankan stage-stage secara berurutan.
 * Setiap stage menerima output stage sebelumnya sebagai input.
 *
 * @example
 * const pipeline = new Pipeline<RawListing, ProcessedListing>()
 *   .addStage(new NormalizerStage())
 *   .addStage(new DictionaryAnalyzerStage(terms))
 *   .addStage(new PriceDetectorStage())
 *   .addStage(new MetadataExtractorStage());
 *
 * const result = await pipeline.run(rawListing);
 */
export class Pipeline<TInput, TOutput> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stages: PipelineStage<any, any>[] = [];

  addStage<TIn, TOut>(stage: PipelineStage<TIn, TOut>): this {
    this.stages.push(stage);
    return this;
  }

  async run(input: TInput): Promise<TOutput> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let current: any = input;

    for (const stage of this.stages) {
      const start = Date.now();
      try {
        current = await stage.process(current);
        log.debug(`Stage "${stage.name}" selesai`, { ms: Date.now() - start });
      } catch (err) {
        log.error(`Stage "${stage.name}" gagal`, err);
        throw err;
      }
    }

    return current as TOutput;
  }

  /**
   * Proses batch listing secara paralel.
   * Tetap chunk agar tidak membebani database sekaligus.
   */
  async runBatch(inputs: TInput[], concurrency = 5): Promise<TOutput[]> {
    const results: TOutput[] = [];

    for (let i = 0; i < inputs.length; i += concurrency) {
      const chunk = inputs.slice(i, i + concurrency);
      const chunkResults = await Promise.all(chunk.map((input) => this.run(input)));
      results.push(...chunkResults);
      log.info(`Batch progress: ${Math.min(i + concurrency, inputs.length)}/${inputs.length}`);
    }

    return results;
  }
}
