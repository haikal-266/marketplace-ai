import { FileText, AlertTriangle } from 'lucide-react';

interface Props {
  showConfirm: boolean;
  showWarning: boolean;
  generating: boolean;
  itemCount: number;
  onConfirmClose: () => void;
  onWarningClose: () => void;
  onConfirmSubmit: () => void;
  onWarningSubmit: () => void;
}

export default function ReportModal({
  showConfirm,
  showWarning,
  generating,
  itemCount,
  onConfirmClose,
  onWarningClose,
  onConfirmSubmit,
  onWarningSubmit
}: Props) {
  return (
    <>
      {/* ── Report Confirmation Modal ── */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4" onClick={onConfirmClose}>
          <div className="w-full max-w-sm bg-bg-secondary border border-border-subtle rounded-xl p-5 flex flex-col gap-4 shadow-2xl animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent-primary/15 text-accent-primary flex items-center justify-center">
                <FileText size={18} />
              </div>
              <span className="text-sm font-bold text-text-primary">Buat Laporan Analisis</span>
            </div>
            <div className="text-xs text-text-secondary leading-normal">
              Apakah Anda yakin ingin membuat laporan analisis dari <strong>{itemCount}</strong> barang yang muncul di listing saat ini?
            </div>
            <div className="flex justify-end gap-2">
              <button className="h-8 px-4 bg-bg-tertiary text-text-primary border border-border-subtle rounded text-xs font-bold hover:bg-border-normal cursor-pointer" onClick={onConfirmClose}>
                Batal
              </button>
              <button className="h-8 px-4 bg-accent-primary text-text-primary rounded text-xs font-bold hover:bg-accent-secondary cursor-pointer" onClick={onConfirmSubmit}>
                Ya, Buat Laporan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Description Loading Warning Modal ── */}
      {showWarning && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4" onClick={onWarningClose}>
          <div className="w-full max-w-sm bg-bg-secondary border border-border-subtle rounded-xl p-5 flex flex-col gap-4 shadow-2xl animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-warning/15 text-accent-tertiary flex items-center justify-center">
                <AlertTriangle size={18} />
              </div>
              <span className="text-sm font-bold text-text-primary">Deskripsi Belum Selesai</span>
            </div>
            <div className="text-xs text-text-secondary leading-normal">
              Beberapa barang masih dalam proses pemuatan deskripsi lengkap. Rekomendasi AI mungkin kurang akurat untuk barang tersebut. Apakah Anda ingin tetap membuat laporan?
            </div>
            <div className="flex justify-end gap-2">
              <button className="h-8 px-4 bg-bg-tertiary text-text-primary border border-border-subtle rounded text-xs font-bold hover:bg-border-normal cursor-pointer" onClick={onWarningClose}>
                Batal
              </button>
              <button className="h-8 px-4 bg-accent-primary text-text-primary rounded text-xs font-bold hover:bg-accent-secondary cursor-pointer" onClick={onWarningSubmit}>
                Tetap Buat Laporan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Generating Report Loader Overlay ── */}
      {generating && (
        <div className="fixed inset-0 bg-black/75 z-[250] flex flex-col items-center justify-center gap-4 animate-fade-in">
          <div className="w-12 h-12 rounded-full border-4 border-accent-primary/20 border-t-accent-primary animate-spin"></div>
          <div className="flex flex-col items-center text-center">
            <span className="text-sm font-bold text-text-primary">Menganalisis Laporan dengan AI...</span>
            <span className="text-xs text-text-secondary mt-1">Harap tunggu, sedang menyusun analisis makro dan mengunduh file PDF Anda secara otomatis.</span>
          </div>
        </div>
      )}
    </>
  );
}
