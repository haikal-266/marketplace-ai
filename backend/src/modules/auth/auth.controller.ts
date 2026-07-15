import { Router } from 'express';
import { authService } from './auth.service';
import { cookieManager } from './cookie.manager';
import { asyncHandler } from '../../utils/errors';

const router = Router();

/**
 * POST /api/auth/connect
 * Mulai login Facebook — buka browser Playwright untuk user.
 * Return segera (non-blocking), frontend polling /status untuk hasilnya.
 */
router.post(
  '/connect',
  asyncHandler(async (_req, res) => {
    const timeoutMs = 10 * 60 * 1000; // 10 menit timeout
    await authService.startLogin(timeoutMs);

    res.json({
      success: true,
      message: 'Browser login dibuka. Silakan login di jendela browser yang muncul.',
      status: authService.getState(),
    });
  })
);

/**
 * GET /api/auth/status
 * Cek status login flow dan koneksi Facebook.
 * Frontend polling endpoint ini setiap 2 detik saat login flow berjalan.
 */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const loginState = authService.getState();
    const isConnected = await cookieManager.isConnected();
    const isValid = isConnected ? await cookieManager.isSessionLikelyValid() : false;

    // Reset state ke idle jika sudah selesai (success/failed) dan sudah dibaca
    if (loginState === 'success' || loginState === 'failed') {
      authService.resetState();
    }

    res.json({
      success: true,
      data: {
        loginState,
        isConnected,
        isSessionLikelyValid: isValid,
      },
    });
  })
);

/**
 * DELETE /api/auth/cancel
 * Batalkan login yang sedang berjalan.
 */
router.delete(
  '/cancel',
  asyncHandler(async (_req, res) => {
    await authService.cancelLogin();
    res.json({ success: true, message: 'Login dibatalkan' });
  })
);

/**
 * DELETE /api/auth/disconnect
 * Hapus cookies dari database (logout dari aplikasi).
 * Tidak logout dari Facebook — hanya menghapus cookies yang tersimpan.
 */
router.delete(
  '/disconnect',
  asyncHandler(async (_req, res) => {
    await cookieManager.remove();
    res.json({ success: true, message: 'Facebook berhasil didisconnect' });
  })
);

export default router;
