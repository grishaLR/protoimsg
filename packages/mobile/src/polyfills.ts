/**
 * Polyfills for APIs missing in Hermes that @atproto/oauth-client-expo depends on.
 */

// DOMException — Hermes doesn't have it, but the ATProto OAuth client throws/catches them.
if (typeof globalThis.DOMException === 'undefined') {
  class DOMExceptionPolyfill extends Error {
    code: number;
    constructor(message?: string, name?: string) {
      super(message);
      this.name = name ?? 'Error';
      this.code = 0;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  (globalThis as any).DOMException = DOMExceptionPolyfill;
}

// AbortSignal.prototype.throwIfAborted() — used during identity resolution.
if (typeof AbortSignal.prototype.throwIfAborted !== 'function') {
  AbortSignal.prototype.throwIfAborted = function () {
    if (this.aborted) {
      throw this.reason ?? new DOMException('The operation was aborted', 'AbortError');
    }
  };
}

// AbortSignal.timeout() — used by the ATProto OAuth client for HTTP request timeouts.
if (typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = (ms: number): AbortSignal => {
    const controller = new AbortController();
    const id = setTimeout(() => {
      controller.abort(new DOMException('TimeoutError', 'TimeoutError'));
    }, ms);
    controller.signal.addEventListener('abort', () => {
      clearTimeout(id);
    });
    return controller.signal;
  };
}
