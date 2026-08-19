(() => {
  const AUTO_REPORT_ENDPOINT = '/api/auto-reports';
  const IGNORE_PATHS = [AUTO_REPORT_ENDPOINT];
  const THROTTLE_MS = 30000;
  const recent = new Map();

  const pageValue = () => `${location.pathname}${location.search}`;

  const getChatToken = () => {
    const parts = window.location.pathname.split('/');
    if (parts[1] !== 'c') return '';
    return parts[2] || '';
  };

  const normalizeText = (value, maxLen) => {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLen);
  };

  const isIgnoredUrl = (urlValue) => {
    if (!urlValue) return false;
    try {
      const parsed = new URL(urlValue, window.location.origin);
      return IGNORE_PATHS.some((path) => parsed.pathname.startsWith(path));
    } catch {
      return IGNORE_PATHS.some((path) => String(urlValue).includes(path));
    }
  };

  const shouldSend = (signature) => {
    const now = Date.now();
    for (const [key, timestamp] of recent.entries()) {
      if (now - timestamp > THROTTLE_MS) {
        recent.delete(key);
      }
    }
    const last = recent.get(signature);
    if (last && now - last < THROTTLE_MS) return false;
    recent.set(signature, now);
    return true;
  };

  const buildSignature = (payload) => {
    return [
      payload.kind || '',
      payload.status || '',
      payload.method || '',
      payload.url || '',
      payload.message || '',
    ].join('|');
  };

  const sendAutoReport = (payload) => {
    const signature = buildSignature(payload);
    if (!shouldSend(signature)) return;

    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(AUTO_REPORT_ENDPOINT, blob);
      return;
    }

    fetch(AUTO_REPORT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  };

  const reportJsError = (event) => {
    if (event.target && event.target !== window) return;
    const message = normalizeText(event.message || 'Script error', 4000);
    const stack = normalizeText(event.error && event.error.stack ? event.error.stack : '', 2000);
    const url = normalizeText(event.filename || '', 400);
    sendAutoReport({
      kind: 'js_error',
      message,
      stack,
      url,
      page: pageValue(),
      chatToken: getChatToken(),
    });
  };

  const reportRejection = (event) => {
    const reason = event.reason;
    const message =
      typeof reason === 'string'
        ? reason
        : reason && typeof reason.message === 'string'
          ? reason.message
          : 'Unhandled rejection';
    const stack = reason && reason.stack ? String(reason.stack) : '';
    sendAutoReport({
      kind: 'unhandled_rejection',
      message: normalizeText(message, 4000),
      stack: normalizeText(stack, 2000),
      page: pageValue(),
      chatToken: getChatToken(),
    });
  };

  const parseRequestInfo = (input, init) => {
    if (input instanceof Request) {
      return {
        url: input.url,
        method: (init && init.method ? init.method : input.method || 'GET').toUpperCase(),
      };
    }
    return {
      url: String(input),
      method: (init && init.method ? init.method : 'GET').toUpperCase(),
    };
  };

  const wrapFetch = () => {
    if (typeof window.fetch !== 'function') return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const requestInfo = parseRequestInfo(input, init);
      if (isIgnoredUrl(requestInfo.url)) {
        return originalFetch(input, init);
      }
      const startedAt = performance.now();
      try {
        const response = await originalFetch(input, init);
        if (!response.ok) {
          sendAutoReport({
            kind: 'http_error',
            status: response.status,
            statusText: normalizeText(response.statusText || '', 120),
            method: requestInfo.method,
            url: normalizeText(requestInfo.url, 400),
            responseUrl: normalizeText(response.url || '', 400),
            durationMs: Math.round(performance.now() - startedAt),
            page: pageValue(),
            chatToken: getChatToken(),
          });
        }
        return response;
      } catch (err) {
        sendAutoReport({
          kind: 'http_error',
          status: 0,
          message: normalizeText(err && err.message ? err.message : 'Network error', 4000),
          method: requestInfo.method,
          url: normalizeText(requestInfo.url, 400),
          durationMs: Math.round(performance.now() - startedAt),
          page: pageValue(),
          chatToken: getChatToken(),
        });
        throw err;
      }
    };
  };

  window.addEventListener('error', reportJsError);
  window.addEventListener('unhandledrejection', reportRejection);
  wrapFetch();
})();
