import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Share } from '@capacitor/share';

export const isNative = Capacitor.isNativePlatform();
/** 'web', 'android' or 'ios'. */
export const platformName = Capacitor.getPlatform();

/** Short buzz. Native haptics on device, navigator.vibrate on the web, silent where neither works. */
export function buzz(strength: 'light' | 'medium' | 'heavy' = 'light'): void {
  if (isNative) {
    const style = strength === 'heavy' ? ImpactStyle.Heavy : strength === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light;
    void Haptics.impact({ style }).catch(() => undefined);
    return;
  }
  try { navigator.vibrate?.(strength === 'heavy' ? 60 : strength === 'medium' ? 40 : 20); } catch { /* refused */ }
}

/** 'image': picture + text went through the share sheet; 'shared': text only; 'copied': text on the clipboard. */
export type ShareOutcome = 'image' | 'shared' | 'copied' | 'failed';

/**
 * Share sheet with the picture where the browser can share files (phones), else text through the
 * share sheet, else the clipboard. On the native app the picture isn't wired up yet (needs the
 * Filesystem plugin), so it shares text.
 */
export async function shareText(title: string, text: string, picture?: File): Promise<ShareOutcome> {
  if (isNative) {
    try { await Share.share({ title, text, dialogTitle: title }); return 'shared'; } catch { /* fall through */ }
  } else if (picture && typeof navigator.canShare === 'function' && navigator.canShare({ files: [picture] })) {
    try { await navigator.share({ title, text, files: [picture] }); return 'image'; } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'image';
    }
  } else if (typeof navigator.share === 'function') {
    try { await navigator.share({ title, text }); return 'shared'; } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'shared';
    }
  }
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { /* blocked: itch.io's iframe doesn't grant clipboard-write */ }
  return legacyCopy(text) ? 'copied' : 'failed';
}

/** Old-style copy through a hidden textarea. Needs no clipboard permission, so it still works inside iframes. */
function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length); // iOS
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}
