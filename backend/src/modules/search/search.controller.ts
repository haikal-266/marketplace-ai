import { Router } from 'express';
import { z } from 'zod';
import { searchService } from './search.service';
import { asyncHandler, ValidationError } from '../../utils/errors';

const router = Router();

const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  location: z.string().optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  excludeFakePrice: z.coerce.boolean().optional(),
  isBarter: z.coerce.boolean().optional(),
  isTradeIn: z.coerce.boolean().optional(),
  isNett: z.coerce.boolean().optional(),
  sortBy: z.enum(['relevance', 'price_asc', 'price_desc', 'newest', 'confidence']).optional().default('relevance'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

/**
 * GET /api/search?q=macbook+m2&sortBy=relevance&excludeFakePrice=true
 * Smart search dengan FTS, fuzzy, dan synonym expansion.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = SearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
    }

    const { q, ...rest } = parsed.data;
    const result = await searchService.search({ query: q, ...rest });

    res.json({ success: true, data: result });
  })
);

export default router;
