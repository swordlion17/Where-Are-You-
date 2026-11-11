import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Share } from '@capacitor/share';

export const isNative = Capacitor.isNativePlatform();

/** Short buzz. Native haptics on device, navigator.vibrate on the web, silent where neither works. */
export function buzz(strength: 'light' | 'medium' | 'heavy' = 'light'): void {
  if (isNative) {
    const style = strength === 'heavy' ? ImpactStyle.Heavy : strength === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light;
    void Haptics.impact({ style }).catch(() => undefined);
    return;
  }
  try { navigator.vibrate?.(strength === 'heavy' ? 60 : strength === 'medium' ? 40 : 20); } catch { /* refused */ }
}

export type ShareOutcome = 'shared' | 'copied' | 'failed';

/** Native share sheet on device; Web Share or clipboard in the browser. */
export async function shareText(title: string, text: string): Promise<ShareOutcome> {
  if (isNative) {
    try { await Share.share({ title, text, dialogTitle: title }); return 'shared'; } catch { /* fall through */ }
  } else if (typeof navigator.share === 'function') {
    try { await navigator.share({ title, text }); return 'shared'; } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'shared';
    }
  }
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { return 'failed'; }
}
