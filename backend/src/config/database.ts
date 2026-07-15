import { PrismaClient } from '@prisma/client';
import { config } from './index';

/**
 * Singleton Prisma client.
 * Prisma sudah handle connection pooling secara internal.
 * Gunakan instance ini di seluruh aplikasi — jangan buat instance baru.
 */
const prisma = new PrismaClient({
  log: config.isDev
    ? ['query', 'info', 'warn', 'error']
    : ['error'],
});

export default prisma;
