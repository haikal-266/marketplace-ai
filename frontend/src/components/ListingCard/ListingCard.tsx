import type { Listing, DictionaryMatch } from '../../types';
import styles from './ListingCard.module.css';

interface Props {
  listing: Listing;
  searchQuery?: string;
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

export default function ListingCard({ listing, searchQuery = '' }: Props) {
  const {
    title, description, actualPriceAmount, actualPriceRaw,
    listedPrice, isPriceFake, isBarter, isTradeIn, isNett,
    location, seller, condition, imageUrl, url,
    postedAt, detectedKeywords, confidenceScore,
  } = listing;

  const keywords = (detectedKeywords as DictionaryMatch[] | null) ?? [];
  const displayTitle = title || '(Tanpa judul)';
  const hasActualPrice = actualPriceAmount !== null && actualPriceAmount !== undefined;

  return (
    <article className={styles.card}>
      {/* ── Thumbnail ─────────────────────────────────────── */}
      <a href={url} target="_blank" rel="noopener noreferrer" className={styles.imageLink}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={displayTitle}
            className={styles.image}
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className={styles.imagePlaceholder}>🖼️</div>
        )}
        {/* Confidence badge di atas gambar */}
        <div className={styles.confidenceBadge} title={`Confidence score: ${Math.round(confidenceScore * 100)}%`}>
          {Math.round(confidenceScore * 100)}%
        </div>
      </a>

      {/* ── Content ───────────────────────────────────────── */}
      <div className={styles.content}>
        {/* Title */}
        <a href={url} target="_blank" rel="noopener noreferrer" className={styles.titleLink}>
          <h3 className={styles.title}>
            {highlightText(displayTitle, searchQuery)}
          </h3>
        </a>

        {/* Description preview */}
        {description && (
          <p className={`${styles.description} line-clamp-2`}>
            {highlightText(description, searchQuery)}
          </p>
        )}

        {/* Price section */}
        <div className={styles.priceSection}>
          {hasActualPrice ? (
            <div className={styles.actualPrice}>
              <span className={styles.actualPriceValue}>
                {formatPrice(actualPriceAmount!)}
              </span>
              {actualPriceRaw && actualPriceRaw !== `Rp ${actualPriceAmount?.toLocaleString('id-ID')}` && (
                <span className={styles.priceSource}>dari "{actualPriceRaw}"</span>
              )}
            </div>
          ) : null}

          {/* Listed price (jika palsu, tampilkan dengan strikethrough) */}
          {listedPrice && (
            <div className={isPriceFake ? styles.fakePrice : styles.listedPrice}>
              {isPriceFake && <span className={styles.fakeBadge}>🚫</span>}
              <span>{listedPrice}</span>
              {isPriceFake && <span className={styles.fakeLabel}>palsu</span>}
            </div>
          )}
        </div>

        {/* Flags badges */}
        <div className={styles.flags}>
          {isBarter && <span className="badge badge-warning">🔄 Barter</span>}
          {isTradeIn && <span className="badge badge-accent">↔️ TT</span>}
          {isNett && <span className="badge badge-muted">🔒 Nett</span>}
          {isPriceFake && <span className="badge badge-danger">⚠️ Harga Palsu</span>}
        </div>

        {/* Detected keywords */}
        {keywords.length > 0 && (
          <div className={styles.keywords}>
            {keywords.slice(0, 4).map((kw, i) => (
              <span
                key={i}
                className={`tag-pill`}
                title={`${kw.term}: ${kw.meaning}`}
                style={{ fontSize: 10 }}
              >
                {CATEGORY_ICONS[kw.category] ?? '📌'} {kw.term}
              </span>
            ))}
          </div>
        )}

        {/* Meta info */}
        <div className={styles.meta}>
          {condition && (
            <span className={styles.metaItem} title="Kondisi">
              📦 {condition}
            </span>
          )}
          {location && (
            <span className={styles.metaItem} title="Lokasi">
              📍 {location}
            </span>
          )}
          {seller && (
            <span className={styles.metaItem} title="Penjual">
              👤 {seller}
            </span>
          )}
          {postedAt && (
            <span className={styles.metaItem} title="Waktu posting">
              🕐 {postedAt}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
