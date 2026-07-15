import prisma from '../../config/database';
import { createLogger } from '../../utils/logger';
import dictionaryData from '../../../data/dictionary.json';
import synonymsData from '../../../data/synonyms.json';

const log = createLogger('Seed');

/**
 * Seed database dengan data awal:
 * - Kamus istilah marketplace Indonesia (dari dictionary.json)
 * - Sinonim nama produk (dari synonyms.json)
 *
 * Menggunakan upsert — aman dijalankan berulang kali.
 * Jalankan: npm run db:seed
 */
async function main() {
  log.info('Memulai database seed...');

  // ─── Seed Dictionary Terms ─────────────────────────────────────────────────
  log.info(`Seeding ${dictionaryData.length} dictionary terms...`);

  for (const item of dictionaryData) {
    await prisma.dictionaryTerm.upsert({
      where: { term: item.term },
      update: {
        meaning: item.meaning,
        category: item.category,
      },
      create: {
        term: item.term,
        meaning: item.meaning,
        category: item.category,
        isActive: true,
      },
    });
  }

  log.info('Dictionary terms selesai di-seed');

  // ─── Seed Product Synonyms ─────────────────────────────────────────────────
  log.info(`Seeding ${synonymsData.length} product synonyms...`);

  for (const item of synonymsData) {
    // Cek berdasarkan canonical name (tidak ada unique constraint)
    const existing = await prisma.productSynonym.findFirst({
      where: { canonicalName: item.canonicalName },
    });

    if (existing) {
      await prisma.productSynonym.update({
        where: { id: existing.id },
        data: {
          aliases: item.aliases,
          category: item.category ?? null,
        },
      });
    } else {
      await prisma.productSynonym.create({
        data: {
          canonicalName: item.canonicalName,
          aliases: item.aliases,
          category: item.category ?? null,
          isActive: true,
        },
      });
    }
  }

  log.info('Product synonyms selesai di-seed');
  log.info('Seed selesai!');
}

main()
  .catch((err) => {
    log.error('Seed gagal', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
