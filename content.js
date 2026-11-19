// Opens links that point to a different (registrable) domain in a new tab.

(() => {
  let enabled = true;

  chrome.storage.sync.get({ externalLinks: true }, (s) => {
    enabled = s.externalLinks;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.externalLinks) {
      enabled = changes.externalLinks.newValue;
    }
  });

  // Common second-level public suffixes, so "bbc.co.uk" is treated as one domain.
  const TWO_PART_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
    'co.nz', 'org.nz', 'co.jp', 'ne.jp', 'or.jp', 'ac.jp',
    'co.kr', 'or.kr', 'co.in', 'net.in', 'org.in',
    'com.br', 'net.br', 'org.br', 'com.cn', 'net.cn', 'org.cn',
    'com.mx', 'com.ar', 'com.tr', 'com.tw', 'com.hk', 'com.sg',
    'co.za', 'co.il', 'co.id', 'com.my', 'com.ph', 'com.ua', 'com.pl',
  ]);

  function baseDomain(hostname) {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    // IPv4 / IPv6 hosts are compared as-is.
    if (/^[\d.]+$/.test(host) || host.includes(':')) return host;
    const parts = host.split('.');
    if (parts.length <= 2) return host;
    const lastTwo = parts.slice(-2).join('.');
    if (TWO_PART_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.');
    return lastTwo;
  }

  function findAnchor(event) {
    for (const node of event.composedPath()) {
      if (node instanceof Element && node.tagName === 'A' && node.hasAttribute('href')) {
        return node;
      }
    }
    return null;
  }

  document.addEventListener(
    'click',
    (e) => {
      if (!enabled || e.defaultPrevented) return;
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

      const a = findAnchor(e);
      if (!a || a.hasAttribute('download')) return;
      if ((a.getAttribute('target') || '').toLowerCase() === '_blank') return;

      let url;
      try {
        url = new URL(a.href, location.href);
      } catch {
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      if (baseDomain(url.hostname) === baseDomain(location.hostname)) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      chrome.runtime.sendMessage({ type: 'openInNewTab', url: url.href }).catch(() => {
        // Extension context gone (e.g. reloaded): fall back to a normal new window/tab.
        window.open(url.href, '_blank', 'noopener');
      });
    },
    true
  );
})();
