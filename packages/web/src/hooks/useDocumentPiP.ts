import { useCallback, useRef, useState } from 'react';

/** Whether the Document Picture-in-Picture API is available (Chrome/Edge 116+). */
export const documentPiPSupported =
  typeof window !== 'undefined' && 'documentPictureInPicture' in window;

interface DocumentPiPApi {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

/**
 * Copy all stylesheets from the main document into the PiP window.
 * Uses <link> clones instead of inline <style> to stay within CSP `style-src 'self'`.
 */
function copyStyles(src: Document, dest: Document) {
  // Clone <link rel="stylesheet"> tags (production CSS bundles)
  for (const link of src.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    const clone = dest.createElement('link');
    clone.rel = 'stylesheet';
    clone.href = link.href;
    if (link.crossOrigin) clone.crossOrigin = link.crossOrigin;
    dest.head.appendChild(clone);
  }

  // Clone <style> tags (Vite dev mode injects CSS this way)
  for (const style of src.querySelectorAll<HTMLStyleElement>('style')) {
    const clone = dest.createElement('style');
    clone.textContent = style.textContent;
    dest.head.appendChild(clone);
  }
}

/**
 * Watch for new stylesheets added to the main document (from code-split chunks)
 * and mirror them into the PiP window. Returns a cleanup function.
 */
function watchStyles(src: Document, dest: Document): () => void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLLinkElement && node.rel === 'stylesheet' && node.href) {
          const link = dest.createElement('link');
          link.rel = 'stylesheet';
          link.href = node.href;
          dest.head.appendChild(link);
        } else if (node instanceof HTMLStyleElement) {
          const style = dest.createElement('style');
          style.textContent = node.textContent;
          dest.head.appendChild(style);
        }
      }
    }
  });

  observer.observe(src.head, { childList: true });
  return () => {
    observer.disconnect();
  };
}

export function useDocumentPiP() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const pipRef = useRef<Window | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const open = useCallback(async (opts?: { width?: number; height?: number }) => {
    if (!documentPiPSupported) return null;

    // Close existing PiP window if one is open
    pipRef.current?.close();
    cleanupRef.current?.();

    const api = (window as unknown as { documentPictureInPicture: DocumentPiPApi })
      .documentPictureInPicture;

    const pip = await api.requestWindow({
      width: opts?.width ?? 320,
      height: opts?.height ?? 420,
    });

    copyStyles(document, pip.document);

    // Watch for late-loaded code-split CSS chunks
    const stopWatching = watchStyles(document, pip.document);
    cleanupRef.current = stopWatching;

    // Sync root attributes so theme CSS selectors ([data-theme]) and
    // RTL direction match the main window.
    for (const attr of ['data-theme', 'dir', 'lang']) {
      const val = document.documentElement.getAttribute(attr);
      if (val) pip.document.documentElement.setAttribute(attr, val);
    }

    pip.addEventListener('pagehide', () => {
      stopWatching();
      cleanupRef.current = null;
      pipRef.current = null;
      setPipWindow(null);
    });

    pipRef.current = pip;
    setPipWindow(pip);
    return pip;
  }, []);

  const close = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    pipRef.current?.close();
    pipRef.current = null;
    setPipWindow(null);
  }, []);

  return { isSupported: documentPiPSupported, pipWindow, open, close };
}
