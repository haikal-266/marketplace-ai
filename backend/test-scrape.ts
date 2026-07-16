import { cookieManager } from './src/modules/auth/cookie.manager';
import { scraperService } from './src/modules/scraper/scraper.service';
import { config } from 'dotenv';
config();

async function run() {
  try {
    const isConn = await cookieManager.isConnected();
    console.log("Connected:", isConn);
    if (!isConn) return;
    
    console.log("Starting scrape...");
    await scraperService.startScrape({ query: "samsung", count: 5, details: false });
    
    // poll status
    const t = setInterval(() => {
      const st = scraperService.getStatus();
      console.log(st);
      if (st?.status === 'done' || st?.status === 'failed') {
        clearInterval(t);
        console.log("Result:", st.result?.length);
        if (st.error) console.error(st.error);
        process.exit(0);
      }
    }, 1000);
  } catch (e) {
    console.error(e);
  }
}
run();
