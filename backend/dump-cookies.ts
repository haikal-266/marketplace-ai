import { cookieManager } from './src/modules/auth/cookie.manager';
import fs from 'fs/promises';
import { config } from 'dotenv';
config();

async function dump() {
  try {
    const cookies = await cookieManager.getDecrypted();
    await fs.writeFile('../scraper/cookies.json', JSON.stringify(cookies, null, 2));
    console.log('Cookies dumped to scraper/cookies.json');
  } catch(e) {
    console.error('Error dumping cookies:', e);
  }
}
dump();
