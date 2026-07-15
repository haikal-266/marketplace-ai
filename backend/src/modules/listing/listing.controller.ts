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

export default router;
