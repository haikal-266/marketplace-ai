import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../config/database';
import { asyncHandler, NotFoundError, ValidationError } from '../../utils/errors';

const router = Router();

const GetListingsSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  location: z.string().optional(),
  isPriceFake: z.coerce.boolean().optional(),
  isBarter: z.coerce.boolean().optional(),
  sortBy: z.enum(['newest', 'oldest', 'price_asc', 'price_desc', 'confidence']).optional().default('newest'),
});

/** GET /api/listings — Ambil semua listing dengan pagination dan filter */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = GetListingsSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
    }

    const { page, limit, location, isPriceFake, isBarter, sortBy } = parsed.data;
    const offset = (page - 1) * limit;

    const orderBy = {
      newest:     { scrapedAt: 'desc' as const },
      oldest:     { scrapedAt: 'asc' as const },
      price_asc:  { actualPriceAmount: 'asc' as const },
      price_desc: { actualPriceAmount: 'desc' as const },
      confidence: { confidenceScore: 'desc' as const },
    }[sortBy];

    const where = {
      ...(location ? { location: { contains: location, mode: 'insensitive' as const } } : {}),
      ...(isPriceFake !== undefined ? { isPriceFake } : {}),
      ...(isBarter !== undefined ? { isBarter } : {}),
    };

    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
        select: {
          id: true, title: true, listedPrice: true, actualPriceAmount: true,
          actualPriceRaw: true, isPriceFake: true, isBarter: true, isTradeIn: true,
          isNett: true, location: true, seller: true, condition: true, url: true,
          imageUrl: true, postedAt: true, scrapedAt: true, confidenceScore: true,
          detectedKeywords: true,
        },
      }),
      prisma.listing.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        items: listings,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  })
);

function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val).replace(/"/g, '""'); // Escape double quotes
  return `"${str}"`;
}

/** GET /api/listings/export — Export semua listing ke format CSV (Excel) */
router.get(
  '/export',
  asyncHandler(async (_req, res) => {
    const listings = await prisma.listing.findMany({
      orderBy: { scrapedAt: 'desc' },
    });

    const headers = [
      'ID',
      'Title',
      'URL',
      'Harga Tertera',
      'Harga Deteksi (Rupiah)',
      'Teks Harga Deteksi',
      'Sumber Deteksi',
      'Lokasi',
      'Penjual',
      'Waktu Scrape',
    ];

    const rows = listings.map((l) => [
      l.id,
      l.title,
      l.url,
      l.listedPrice,
      l.actualPriceAmount,
      l.actualPriceRaw,
      l.actualPriceSource,
      l.location,
      l.seller,
      l.scrapedAt.toISOString(),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map(escapeCsv).join(',')),
    ].join('\r\n');

    // Prepend UTF-8 BOM agar terbaca excel dengan benar
    const bom = Buffer.from('\ufeff', 'utf-8');
    const csvBuffer = Buffer.concat([bom, Buffer.from(csvContent, 'utf-8')]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=marketplace_listings_export.csv');
    res.send(csvBuffer);
  })
);

/** GET /api/listings/:id — Detail listing */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const listing = await prisma.listing.findUnique({
      where: { id },
    });

    if (!listing) throw new NotFoundError('Listing');
    res.json({ success: true, data: listing });
  })
);

/** DELETE /api/listings/:id — Hapus listing */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const existing = await prisma.listing.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Listing');

    await prisma.listing.delete({ where: { id } });
    res.json({ success: true, message: 'Listing dihapus' });
  })
);

/** DELETE /api/listings — Hapus SEMUA listing (clear data) */
router.delete(
  '/',
  asyncHandler(async (_req, res) => {
    const { count } = await prisma.listing.deleteMany();
    res.json({ success: true, message: `${count} listing dihapus` });
  })
);

/** POST /api/listings/analyze-report — Analisis data listing menggunakan AI (Gemini / OpenAI / Groq / OpenRouter) */
const AnalyzeReportSchema = z.object({
  query: z.string(),
  items: z.array(z.any()),
  aiConfig: z.object({
    provider: z.string().optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    modelName: z.string().optional(),
  }).optional(),
});

router.post(
  '/analyze-report',
  asyncHandler(async (req, res) => {
    const parsed = AnalyzeReportSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
    }

    const { query, items, aiConfig } = parsed.data;

    // Resolve configuration values with local fallbacks to .env
    const provider = aiConfig?.provider || 'gemini';
    const apiKey = aiConfig?.apiKey || process.env.GEMINI_API_KEY;
    const modelName = aiConfig?.modelName || 'gemini-1.5-flash';
    const baseUrl = aiConfig?.baseUrl || 'https://generativelanguage.googleapis.com';

    if (!apiKey) {
      return res.json({
        success: true,
        isAi: false,
        data: null,
      });
    }

    const prompt = `
Anda adalah AI analis marketplace. Tugas Anda adalah menganalisis daftar barang berikut yang dicari dengan query "${query}" dan memberikan spesifikasi ringkas produk tersebut, analisis makro pasar, serta rekomendasi tindakan untuk setiap barang.

PENTING:
1. Jangan gunakan tanda kutip ganda (") di dalam konten teks (seperti nilai 'recommendation', 'macroSummary', atau item dalam 'briefSpecs'). Jika Anda ingin mengutip sesuatu, gunakan tanda kutip tunggal (') saja.
2. Pastikan tidak ada karakter line break atau control character (\n) di dalam nilai string JSON. Semua harus ditulis dalam satu baris untuk tiap properti string.
3. Pastikan format JSON valid tanpa trailing comma (koma menggantung) di akhir elemen array atau objek.
4. Jangan gunakan emoji sama sekali di dalam seluruh isi teks JSON (briefSpecs, macroSummary, dan recommendation). Tulis analisis dengan bahasa profesional yang bersih tanpa menggunakan emoji.
5. Analisis deskripsi lengkap ('description') setiap barang dengan teliti untuk menggali spesifikasi teknis tambahan (seperti kapasitas RAM, memori internal, warna, dll.), kelengkapan unit (fullset, batangan, charger bawaan), status garansi, serta detail kerusakan/minus fisik maupun sistem. Sertakan informasi berharga dari deskripsi ini untuk membuat ringkasan pasar (macroSummary) yang lebih mendalam, spesifikasi produk (briefSpecs), dan rekomendasi tindakan yang spesifik untuk masing-masing barang.

Daftar barang:
${JSON.stringify(
  items.map((l: any) => ({
    id: l.id,
    title: l.title,
    price: l.actualPriceAmount || l.listedPrice,
    location: l.location,
    description: l.description || '',
    isBarter: l.isBarter,
    isTradeIn: l.isTradeIn,
    isNett: l.isNett,
    isPriceFake: l.isPriceFake,
  }))
)}

Harap berikan respons dalam format JSON berikut:
{
  "briefSpecs": [
    "Spesifikasi 1 (contoh: 'Layar: 6.67 inci AMOLED, 120Hz')",
    "Spesifikasi 2 (contoh: 'Chipset: Snapdragon 7+ Gen 2')",
    "Spesifikasi 3 (contoh: 'Baterai: 5000mAh, 67W fast charge')"
  ],
  "macroSummary": "Satu paragraf analisis pasar mendalam (3-4 kalimat) yang menyimpulkan kondisi pasar berdasarkan harga rata-rata, persentase kelengkapan unit, serta tren kondisi fisik/minus barang yang dilaporkan di deskripsi. Contoh: 'Berdasarkan analisis deskripsi, mayoritas unit berada dalam kondisi RAM 8GB/256GB dan fullset original. Namun, terdapat sekitar 20% unit yang melaporkan minus berupa backdoor retak atau baterai drop, sehingga calon pembeli disarankan menawar harga lebih rendah untuk tipe tersebut.'",
  "recommendations": [
    {
      "id": "ID barang (harus sama persis dengan id barang di daftar)",
      "recommendation": "1 kalimat rekomendasi actionable spesifik yang merujuk langsung ke detail kondisi atau minus yang tertulis di deskripsi barang (contoh: 'Unit patut dipertimbangkan karena deskripsi melaporkan kondisi mulus terawat lengkap box', 'Wajib tawar 15% karena ada minus layar retak tipis di deskripsi', atau 'Hindari/konfirmasi harga asli karena terindikasi harga DP di deskripsi').",
      "isRedFlag": true atau false (true jika terindikasi harga palsu, ada minus parah di deskripsi, atau mencurigakan)
    }
  ]
}
`;

    try {
      let text = '';

      if (provider === 'gemini' || baseUrl.includes('generativelanguage.googleapis.com')) {
        // --- Google Gemini API (AI Studio) ---
        const url = `${baseUrl.replace(/\/$/, '')}/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const response = await globalThis.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          return res.json({
            success: true,
            isAi: false,
            data: null,
            error: `Gemini API error: ${response.status} - ${errText}`,
          });
        }

        const resJson: any = await response.json();
        text = resJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else {
        // --- OpenAI-Compatible APIs (OpenAI, Groq, OpenRouter, Custom) ---
        const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
        const response = await globalThis.fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          return res.json({
            success: true,
            isAi: false,
            data: null,
            error: `API error (${provider}): ${response.status} - ${errText}`,
          });
        }

        const resJson: any = await response.json();
        text = resJson.choices?.[0]?.message?.content || '';
      }

      if (!text) {
        throw new Error('Invalid response structure from AI Provider');
      }

      let cleanText = text.trim();
      if (cleanText.startsWith('```json')) {
        cleanText = cleanText.substring(7);
      }
      if (cleanText.endsWith('```')) {
        cleanText = cleanText.substring(0, cleanText.length - 3);
      }
      cleanText = cleanText.trim();

      const parsedData = JSON.parse(cleanText);
      res.json({
        success: true,
        isAi: true,
        data: parsedData,
      });
    } catch (error) {
      res.json({
        success: true,
        isAi: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })
);

export default router;
