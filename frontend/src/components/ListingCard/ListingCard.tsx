import { MapPin, ShieldAlert, Award } from 'lucide-react';
import type { Listing, DictionaryMatch } from '../../types';

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
    <article 
      className="group bg-bg-card border border-border-subtle rounded-xl overflow-hidden flex flex-col transition-all duration-200 cursor-pointer relative h-full shadow-sm hover:shadow-md hover:border-border-normal hover:-translate-y-0.5" 
      onClick={onClick}
    >
      {/* ── Thumbnail (16:9 Aspect Ratio) ── */}
      <div className="relative w-full aspect-video bg-bg-tertiary overflow-hidden shrink-0">
        {listing.imageUrl ? (
          <img
            src={listing.imageUrl}
            alt={displayTitle}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-102"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-3xl bg-bg-tertiary opacity-30">
            <span>🖼️</span>
          </div>
        )}
        
        {/* Confidence Badge */}
        <div className="absolute top-2 right-2 bg-bg-primary/75 backdrop-blur border border-border-subtle text-text-primary text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded flex items-center gap-1 z-10">
          <Award size={10} className="text-accent-tertiary" />
          <span>{Math.round(confidenceScore * 100)}%</span>
        </div>

        {/* WhatsApp Indicator Badge */}
        {hasWhatsAppNumber(title || '', description || '') && (
          <div className="absolute top-2 left-2 bg-[#25d366]/95 backdrop-blur border border-white/20 text-white text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 z-10 shadow-[0_2px_8px_rgba(37,211,102,0.3)]" title="Deskripsi/judul mencantumkan Nomor WA/HP">
            <span className="w-1.5 h-1.5 bg-white rounded-full inline-block animate-pulse" />
            <span>WA Active</span>
          </div>
        )}
      </div>

      {/* ── Content Area ── */}
      <div className="p-4 flex flex-col gap-2 flex-grow">
        {/* Meta Info: Location & Posted At & Condition */}
        {metaText && (
          <div className="flex items-center gap-1 text-text-secondary">
            <MapPin size={10} className="text-info opacity-80 shrink-0" />
            <span className="text-[11px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{metaText}</span>
          </div>
        )}

        {/* Title */}
        <h3 className="text-sm font-semibold text-text-primary leading-normal line-clamp-2 m-0 min-h-[40px] group-hover:text-accent-tertiary transition-colors">
          {highlightText(displayTitle, searchQuery)}
        </h3>

        {/* Description Preview */}
        {description ? (
          <p className="text-xs text-text-secondary leading-relaxed line-clamp-3 my-1 min-h-[54px]">
            {highlightText(description, searchQuery)}
          </p>
        ) : (
          <p className="text-[11px] text-text-muted leading-normal my-1 min-h-[54px] bg-accent-tertiary/4 border border-dashed border-accent-tertiary/25 rounded p-2 flex items-center justify-center text-center">
            ⏳ <em>Deskripsi sedang dimuat. Produk mungkin otomatis terhapus jika deskripsi tidak sesuai filter Anda...</em>
          </p>
        )}

        {/* AI Detected Term Keywords (Soft pills) */}
        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {keywords.slice(0, 3).map((kw, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 bg-accent-tertiary/8 border border-accent-tertiary/20 rounded px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary transition-all hover:bg-accent-tertiary/15 hover:border-accent-tertiary/40 hover:text-text-primary"
                title={`${kw.term}: ${kw.meaning}`}
              >
                <span>{CATEGORY_ICONS[kw.category] ?? '📌'}</span>
                <span>{kw.term}</span>
              </span>
            ))}
          </div>
        )}

        {/* Price & Badges Row (At the bottom of the card) */}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border-subtle pt-3">
          {/* Price Tag (French Blue 500) */}
          <div className="flex items-center">
            {hasActualPrice ? (
              (() => {
                const scaledPrice = actualPriceAmount! >= 100 && actualPriceAmount! <= 9999
                  ? actualPriceAmount! * 1000
                  : actualPriceAmount!;
                return (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-bold text-accent-primary tracking-tight">
                      {formatPrice(scaledPrice)}
                    </span>
                    {listedPrice && isPriceFake && (
                      <span className="inline-flex items-center gap-0.5 bg-danger/12 border border-danger/25 text-text-secondary text-[9px] font-semibold px-1 py-0.5 rounded uppercase tracking-wide" title={`Harga tertera: ${overrideCurrencyToRupiah(listedPrice)}`}>
                        <ShieldAlert size={10} /> Fake Price
                      </span>
                    )}
                  </div>
                );
              })()
            ) : listedPrice ? (
              <div className="text-sm font-semibold text-text-secondary">
                <span>{overrideCurrencyToRupiah(listedPrice)}</span>
              </div>
            ) : (
              <span className="text-xs font-medium text-text-muted">Hubungi Penjual</span>
            )}
          </div>

          {/* Dynamic Badges */}
          {(isBarter || isTradeIn || isNett) && (
            <div className="flex gap-1 flex-wrap shrink-0">
              {isBarter && <span className="text-[9px] font-semibold bg-warning/12 border border-warning/25 text-accent-tertiary px-1 py-0.5 rounded">BT</span>}
              {isTradeIn && <span className="text-[9px] font-semibold bg-accent-primary/12 border border-accent-primary/25 text-text-primary px-1 py-0.5 rounded">TT</span>}
              {isNett && <span className="text-[9px] font-semibold bg-text-muted/12 border border-text-muted/25 text-text-secondary px-1 py-0.5 rounded">Nett</span>}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
