import { MapPin, ShieldAlert, Award } from 'lucide-react';
import type { Listing, DictionaryMatch } from '../../types';
import styles from './ListingCard.module.css';

interface Props {
  listing: Listing;
  searchQuery?: string;
  onClick?: () => void;
}

/** Format Rupiah dengan singkatan juta/ribu */
function formatPrice(amount: number): string {
  if (amount >= 1_000_000) {
    const juta = amount / 1_000_000;
    return juta % 1 === 0 ? `Rp ${juta}jt` : `Rp ${juta.toFixed(1)}jt`;
  }
  if (amount >= 1_000) {
    const ribu = amount / 1_000;
    return ribu % 1 === 0 ? `Rp ${ribu}rb` : `Rp ${ribu.toFixed(1)}rb`;
  }
  return `Rp ${amount.toLocaleString('id-ID')}`;
}

/** Override any listed non-Rupiah currencies to Rupiah (Rp) prefix */
export function overrideCurrencyToRupiah(priceStr: string | null | undefined): string {
  if (!priceStr) return 'Hubungi Penjual';
  let cleaned = priceStr.trim();
  
  // Hapus semua currency symbol yang diketahui di depan, lalu ganti dengan Rp
  const currencyRegex = /^(?:US\$|S\$|SG\$|SGD|\$|RM|RP\.?|RP|IDR)\s*/i;
  if (currencyRegex.test(cleaned)) {
    cleaned = cleaned.replace(currencyRegex, 'Rp ');
  } else {
    // Jika tidak ada symbol currency tetapi diawali angka/titik, tambahkan Rp di depan
    if (/^\d/.test(cleaned) || /^\./.test(cleaned)) {
      cleaned = 'Rp ' + cleaned;
    }
  }
  return cleaned;
}

/** Highlight search query dalam teks */
function highlightText(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i}>{part}</mark>
      : part
  );
}

const CATEGORY_ICONS: Record<string, string> = {
  pricing: '💰', condition: '📦', trade: '🔄',
  urgency: '⚡', delivery: '🚚', warranty: '🛡️', other: '📌',
};

/** Deteksi apakah deskripsi atau judul mencantumkan nomor WA Indonesia */
export function hasWhatsAppNumber(title: string, description: string): boolean {
  const text = `${title || ''} ${description || ''}`;
  const match = text.match(/08[0-9]{1,3}[-\s.]?[0-9]{3,4}[-\s.]?[0-9]{3,5}/g);
  if (!match) return false;
  return match.some(num => {
    const cleanNum = num.replace(/[-\s.]/g, '');
    return cleanNum.length >= 10 && cleanNum.length <= 13;
  });
}

/** Deteksi apakah deskripsi atau judul mengindikasikan adanya minus/kerusakan */
export function hasMinus(title: string, description: string): boolean {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  if (!text.includes('minus')) return false;

  const negatedPatterns = [
    /no\s+minus/i,
    /non\s+minus/i,
    /tanpa\s+minus/i,
    /tidak\s+ada\s+minus/i,
    /ga\s+ada\s+minus/i,
    /gak\s+ada\s+minus/i,
    /mulus\s+no\s+minus/i,
    /nomi/i
  ];

  let cleanText = text;
  for (const pattern of negatedPatterns) {
    cleanText = cleanText.replace(pattern, '');
  }

  return cleanText.includes('minus');
}

export default function ListingCard({ listing, searchQuery = '', onClick }: Props) {
  const {
    title, description, actualPriceAmount, listedPrice, isPriceFake,
    location, postedAt, confidenceScore, isBarter, isTradeIn, isNett,
    condition, detectedKeywords
  } = listing;

  const displayTitle = title || '(Tanpa judul)';
  const hasActualPrice = actualPriceAmount !== null && actualPriceAmount !== undefined;
  const keywords = (detectedKeywords as DictionaryMatch[] | null) ?? [];

  // Compact metadata line
  const metaParts = [];
  if (location) metaParts.push(location);
  if (postedAt) metaParts.push(postedAt);
  if (condition) metaParts.push(condition);
  const metaText = metaParts.join(' • ');

  return (
    <article className={styles.card} onClick={onClick}>
      {/* ── Thumbnail (16:9 Aspect Ratio) ── */}
      <div className={styles.imageContainer}>
        {listing.imageUrl ? (
          <img
            src={listing.imageUrl}
            alt={displayTitle}
            className={styles.image}
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className={styles.imagePlaceholder}>
            <span>🖼️</span>
          </div>
        )}
        
        {/* Confidence Badge */}
        <div className={styles.confidenceBadge}>
          <Award size={10} className={styles.confidenceIcon} />
          <span>{Math.round(confidenceScore * 100)}%</span>
        </div>

        {/* WhatsApp Indicator Badge */}
        {hasWhatsAppNumber(title || '', description || '') && (
          <div className={styles.waBadge} title="Deskripsi/judul mencantumkan Nomor WA/HP">
            <span className={styles.waDot} />
            <span>WA Active</span>
          </div>
        )}
      </div>

      {/* ── Content Area ── */}
      <div className={styles.content}>
        {/* Meta Info: Location & Posted At & Condition */}
        {metaText && (
          <div className={styles.metaRow}>
            <MapPin size={10} className={styles.metaIcon} />
            <span className={styles.metaText}>{metaText}</span>
          </div>
        )}

        {/* Title */}
        <h3 className={styles.title}>
          {highlightText(displayTitle, searchQuery)}
        </h3>

        {/* Description Preview */}
        {description ? (
          <p className={styles.description}>
            {highlightText(description, searchQuery)}
          </p>
        ) : (
          <p className={styles.descriptionLoading}>
            ⏳ <em>Deskripsi sedang dimuat. Produk mungkin otomatis terhapus jika deskripsi tidak sesuai filter Anda...</em>
          </p>
        )}

        {/* AI Detected Term Keywords (Soft pills) */}
        {keywords.length > 0 && (
          <div className={styles.keywords}>
            {keywords.slice(0, 3).map((kw, i) => (
              <span
                key={i}
                className={styles.tagPill}
                title={`${kw.term}: ${kw.meaning}`}
              >
                <span>{CATEGORY_ICONS[kw.category] ?? '📌'}</span>
                <span>{kw.term}</span>
              </span>
            ))}
          </div>
        )}

        {/* Price & Badges Row (At the bottom of the card) */}
        <div className={styles.footerRow}>
          {/* Price Tag (French Blue 500) */}
          <div className={styles.priceContainer}>
            {hasActualPrice ? (
              (() => {
                const scaledPrice = actualPriceAmount! >= 100 && actualPriceAmount! <= 9999
                  ? actualPriceAmount! * 1000
                  : actualPriceAmount!;
                return (
                  <div className={styles.actualPrice}>
                    <span className={styles.priceVal}>
                      {formatPrice(scaledPrice)}
                    </span>
                    {listedPrice && isPriceFake && (
                      <span className={styles.clickbaitLabel} title={`Harga tertera: ${overrideCurrencyToRupiah(listedPrice)}`}>
                        <ShieldAlert size={10} /> Fake Price
                      </span>
                    )}
                  </div>
                );
              })()
            ) : listedPrice ? (
              <div className={styles.listedPrice}>
                <span>{overrideCurrencyToRupiah(listedPrice)}</span>
              </div>
            ) : (
              <span className={styles.noPrice}>Hubungi Penjual</span>
            )}
          </div>

          {/* Dynamic Badges */}
          {(isBarter || isTradeIn || isNett) && (
            <div className={styles.badgeRow}>
              {isBarter && <span className={styles.badgeWarning}>BT</span>}
              {isTradeIn && <span className={styles.badgeAccent}>TT</span>}
              {isNett && <span className={styles.badgeMuted}>Nett</span>}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
