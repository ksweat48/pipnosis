import { useCallback, useRef, useState } from 'react';

type ShareTarget = 'summary' | string;

interface UseAchievementShareReturn {
  isSharingId: ShareTarget | null;
  shareSummary: (cardRef: React.RefObject<HTMLDivElement>, rankLabel: string, totalWins: number) => Promise<void>;
  shareWin: (cardRef: React.RefObject<HTMLDivElement>, symbol: string, pnl: number, winNumber: number) => Promise<void>;
}

const loadHtml2Canvas = async () => {
  const mod = await import('html2canvas');
  return mod.default;
};

const captureCard = async (el: HTMLElement): Promise<Blob> => {
  const html2canvas = await loadHtml2Canvas();
  const canvas = await html2canvas(el, {
    backgroundColor: null,
    scale: 2,
    useCORS: true,
    allowTaint: true,
    logging: false,
    imageTimeout: 8000,
  });
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to create image blob'));
    }, 'image/png', 1.0);
  });
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
};

const tryNativeShare = async (blob: Blob, filename: string, title: string, text: string): Promise<boolean> => {
  if (!navigator.share) return false;
  try {
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare && !navigator.canShare({ files: [file] })) return false;
    await navigator.share({ title, text, files: [file] });
    return true;
  } catch (err: any) {
    if (err?.name === 'AbortError') return true;
    return false;
  }
};

export function useAchievementShare(): UseAchievementShareReturn {
  const [isSharingId, setIsSharingId] = useState<ShareTarget | null>(null);
  const lockRef = useRef(false);

  const shareSummary = useCallback(async (
    cardRef: React.RefObject<HTMLDivElement>,
    rankLabel: string,
    totalWins: number
  ) => {
    if (lockRef.current || !cardRef.current) return;
    lockRef.current = true;
    setIsSharingId('summary');

    try {
      const blob = await captureCard(cardRef.current);
      const filename = `pipnosis-${rankLabel.toLowerCase().replace(/\s+/g, '-')}-${totalWins}wins.png`;
      const title = `${rankLabel} — ${totalWins} Winning Trades`;
      const text = `I just hit ${rankLabel} rank on Pipnosis AI with ${totalWins} winning trades! Join me at pipnosis.ai`;

      const shared = await tryNativeShare(blob, filename, title, text);
      if (!shared) {
        downloadBlob(blob, filename);
      }
    } finally {
      lockRef.current = false;
      setIsSharingId(null);
    }
  }, []);

  const shareWin = useCallback(async (
    cardRef: React.RefObject<HTMLDivElement>,
    symbol: string,
    pnl: number,
    winNumber: number
  ) => {
    if (lockRef.current || !cardRef.current) return;
    lockRef.current = true;
    setIsSharingId(`win-${winNumber}`);

    try {
      const blob = await captureCard(cardRef.current);
      const filename = `pipnosis-win-${winNumber}-${symbol.toLowerCase()}-$${pnl.toFixed(0)}.png`;
      const title = `Win #${winNumber} — ${symbol} +$${pnl.toFixed(2)}`;
      const text = `Just closed Win #${winNumber} on ${symbol} for +$${pnl.toFixed(2)} using Pipnosis AI! 🔥 pipnosis.ai`;

      const shared = await tryNativeShare(blob, filename, title, text);
      if (!shared) {
        downloadBlob(blob, filename);
      }
    } finally {
      lockRef.current = false;
      setIsSharingId(null);
    }
  }, []);

  return { isSharingId, shareSummary, shareWin };
}
