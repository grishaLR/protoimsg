import { useCallback, useRef, useState } from 'react';

/** Whether the Document Picture-in-Picture API is available (Chrome/Edge 116+). */
export const documentPiPSupported =
  typeof window !== 'undefined' && 'documentPictureInPicture' in window;

interface DocumentPiPApi {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

/** Copy all stylesheets from the main document into the PiP window. */
function copyStyles(src: Document, dest: Document) {
  for (const sheet of src.styleSheets) {
    try {
      const rules = [...sheet.cssRules].map((r) => r.cssText).join('\n');
      const style = dest.createElement('style');
      style.textContent = rules;
      dest.head.appendChild(style);
    } catch {
      // CORS-blocked stylesheet — fall back to <link>
      if (sheet.href) {
        const link = dest.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        dest.head.appendChild(link);
      }
    }
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
