import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../config/database';
import { asyncHandler, ValidationError, NotFoundError, ConflictError } from '../../utils/errors';

const router = Router();

const CreateTermSchema = z.object({
  term: z.string().min(1).max(50),
  meaning: z.string().min(1).max(200),
  category: z.enum(['pricing', 'condition', 'trade', 'urgency', 'delivery', 'warranty', 'other']),
});

const UpdateTermSchema = CreateTermSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/** GET /api/dictionary — Ambil semua istilah */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const category = req.query.category as string | undefined;
    const activeOnly = req.query.activeOnly !== 'false';

    const terms = await prisma.dictionaryTerm.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(activeOnly ? { isActive: true } : {}),
      },
      orderBy: [{ category: 'asc' }, { term: 'asc' }],
    });

    res.json({ success: true, data: terms });
  })
);

/** POST /api/dictionary — Tambah istilah baru */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = CreateTermSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
    }

    try {
      const term = await prisma.dictionaryTerm.create({
        data: {
          term: parsed.data.term.trim(),
          meaning: parsed.data.meaning.trim(),
          category: parsed.data.category,
        },
      });
      res.status(201).json({ success: true, data: term });
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new ConflictError(`Istilah "${parsed.data.term}" sudah ada`);
      }
      throw err;
    }
  })
);

/** PUT /api/dictionary/:id — Update istilah */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = UpdateTermSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
    }

    const id = req.params.id as string;
    const existing = await prisma.dictionaryTerm.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Istilah kamus');

    const updated = await prisma.dictionaryTerm.update({
      where: { id },
      data: parsed.data,
    });

    res.json({ success: true, data: updated });
  })
);

/** DELETE /api/dictionary/:id — Hapus istilah */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const existing = await prisma.dictionaryTerm.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Istilah kamus');

    await prisma.dictionaryTerm.delete({ where: { id } });
    res.json({ success: true, message: 'Istilah berhasil dihapus' });
  })
);

export default router;
