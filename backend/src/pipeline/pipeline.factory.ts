import { Pipeline } from './pipeline';
import { NormalizerStage } from './stages/normalizer';
import { DictionaryAnalyzerStage } from './stages/dictionary-analyzer';
import { PriceDetectorStage } from './stages/price-detector';
import { MetadataExtractorStage } from './stages/metadata-extractor';
import { SearchIndexerStage } from './stages/search-indexer';
import { RawListing, ProcessedListing } from './pipeline.types';
import prisma from '../config/database';
import { createLogger } from '../utils/logger';

const log = createLogger('PipelineFactory');

/**
 * Factory function untuk membuat pipeline yang sudah ter-configured.
 * Load dictionary terms dari database untuk DictionaryAnalyzerStage.
 *
 * Dipanggil saat ingin memproses batch listing baru.
 */
export async function buildPipeline(): Promise<Pipeline<RawListing, ProcessedListing>> {
  // Load active dictionary terms dari database
  const terms = await prisma.dictionaryTerm.findMany({
    where: { isActive: true },
    select: { term: true, meaning: true, category: true },
  });

  log.info('Pipeline dibangun', { dictionaryTerms: terms.length });

  return new Pipeline<RawListing, ProcessedListing>()
    .addStage(new NormalizerStage())
    .addStage(new DictionaryAnalyzerStage(terms))
    .addStage(new PriceDetectorStage())
    .addStage(new MetadataExtractorStage())
    .addStage(new SearchIndexerStage());
}
