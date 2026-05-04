export function shareToX(text: string, url?: string): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams({ text });
  if (url) params.append('url', url);
  window.open(`https://x.com/intent/tweet?${params.toString()}`, '_blank', 'noopener,noreferrer');
}

export function getShareableUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://banana-fantasy-sbs.vercel.app';
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

export function wheelResultPath(spinId: string): string {
  return `/wheel-result/${spinId}`;
}

export interface SpinShareCopy {
  text: string;
  earnsCredit: boolean;
}

export function buildWheelShareCopy(prizeId: string): SpinShareCopy {
  const bigWin = ['jackpot', 'hof'].includes(prizeId) || /draft-(5|10|20)/.test(prizeId);
  const base = (() => {
    if (prizeId === 'jackpot') return 'Just hit a JACKPOT on the Banana Wheel 🎰🍌 skip straight to the finals @SBSFantasy';
    if (prizeId === 'hof') return 'Hall of Fame draft unlocked on @SBSFantasy 🏆🍌 competing for bonus prizes';
    const m = prizeId.match(/^draft-(\d+)$/);
    if (m) return `Just won ${m[1]} draft pass${Number(m[1]) === 1 ? '' : 'es'} on the Banana Wheel 🍌🏈 @SBSFantasy`;
    return `Just spun the Banana Wheel on @SBSFantasy 🍌🏈`;
  })();
  return { text: base, earnsCredit: bigWin };
}

