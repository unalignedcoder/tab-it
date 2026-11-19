// Service worker: handles address-bar, bookmark and history navigations (#2–#4),
// and opens new tabs on behalf of the content script (#1).

const DEFAULTS = {
  externalLinks: true,
  addressBar: true,
  bookmarks: true,
  history: true,
  openInBackground: false,
  debug: false,
};

// Pages where navigating in place is fine (nothing to go back to).
const BLANK_PAGES = [
  'about:blank',
  'chrome://newtab',
  'chrome://new-tab-page',
  'chrome-search://local-ntp',
  'edge://newtab',
];

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(null);
  await chrome.storage.sync.set({ ...DEFAULTS, ...current });
});

async function getSettings() {
  return chrome.storage.sync.get(DEFAULTS);
}

// ---------------------------------------------------------------------------
// URL tracking: remember [previous, current] URL per tab.
// tabs.onUpdated reports every URL, including chrome:// pages, which
// webNavigation may not. Stored in storage.session so it survives the
// service worker being suspended.
// ---------------------------------------------------------------------------

const key = (tabId) => `tab_${tabId}`;

async function getTrack(tabId) {
  const k = key(tabId);
  const data = await chrome.storage.session.get(k);
  return data[k] || { prev: null, cur: null };
}

async function setTrack(tabId, track) {
  await chrome.storage.session.set({ [key(tabId)]: track });
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const t = await getTrack(tabId);
  if (t.cur === changeInfo.url) return;
  await setTrack(tabId, { prev: t.cur, cur: changeInfo.url });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(key(tabId));
});

chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  const t = await getTrack(removedTabId);
  await setTrack(addedTabId, t);
  chrome.storage.session.remove(key(removedTabId));
});

// Seed tracking for tabs that already exist when the worker starts.
chrome.tabs.query({}).then((tabs) => {
  for (const tab of tabs) {
    if (!tab.url) continue;
    getTrack(tab.id).then((t) => {
      if (!t.cur) setTrack(tab.id, { prev: null, cur: tab.url });
    });
  }
});

// The URL the tab was on before `url` was committed. Works whether
// tabs.onUpdated fired before or after webNavigation.onCommitted.
async function previousUrl(tabId, url) {
  const t = await getTrack(tabId);
  return t.cur === url ? t.prev : t.cur;
}

function isBlank(url) {
  return !url || BLANK_PAGES.some((p) => url.startsWith(p));
}

// ---------------------------------------------------------------------------
// Navigation classification (#2–#4)
// ---------------------------------------------------------------------------

function classify(details, prevUrl) {
  const type = details.transitionType;
  const q = details.transitionQualifiers || [];

  if (q.includes('from_address_bar') && ['typed', 'generated', 'keyword', 'link'].includes(type)) {
    return 'addressBar';
  }
  if (type === 'auto_bookmark') {
    // Clicks in chrome://history are reported as auto_bookmark in some versions.
    if (prevUrl && prevUrl.startsWith('chrome://history')) return 'history';
    return 'bookmarks';
  }
  if (prevUrl && prevUrl.startsWith('chrome://history') && type === 'link') {
    return 'history';
  }
  return null;
}

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (details.documentLifecycle && details.documentLifecycle !== 'active') return;

  const { tabId, url } = details;
  const q = details.transitionQualifiers || [];
  const prevUrl = await previousUrl(tabId, url);
  const settings = await getSettings();

  if (settings.debug) {
    console.log('[onCommitted]', {
      tabId,
      url,
      prevUrl,
      transitionType: details.transitionType,
      transitionQualifiers: q,
    });
  }

  if (q.includes('forward_back') || q.includes('client_redirect') || q.includes('server_redirect')) return;
  if (!/^https?:|^file:|^ftp:/.test(url)) return;
  if (isBlank(prevUrl) || prevUrl === url) return;

  const kind = classify(details, prevUrl);
  if (!kind || !settings[kind]) return;

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }

  await chrome.tabs.create({
    url,
    index: tab.index + 1,
    openerTabId: tabId,
    windowId: tab.windowId,
    active: !settings.openInBackground,
  });

  // The resulting commit carries the forward_back qualifier, so it is skipped above.
  try {
    await chrome.tabs.goBack(tabId);
  } catch (err) {
    if (settings.debug) console.warn('goBack failed', err);
  }
});

// ---------------------------------------------------------------------------
// Messages from content script (#1)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Toolbar icon: the blue icon on light themes, the white one on dark themes.
// A service worker can't read prefers-color-scheme, so pages report it
// (content.js and the options page) and only when it differs from the stored value.
// ---------------------------------------------------------------------------

const iconSet = (prefix) =>
  Object.fromEntries([16, 32, 48, 128].map((s) => [s, `icons/${prefix}${s}.png`]));

async function applyTheme(dark) {
  await chrome.storage.local.set({ darkTheme: dark });
  await chrome.action.setIcon({ path: iconSet(dark ? 'icon-white' : 'icon') });
}

// The icon set with setIcon is lost when the browser restarts: reapply the last known theme.
chrome.runtime.onStartup.addListener(async () => {
  const { darkTheme } = await chrome.storage.local.get('darkTheme');
  if (darkTheme) await applyTheme(true);
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'theme') {
    applyTheme(!!msg.dark).catch(() => {});
    return;
  }
  if (msg?.type !== 'openInNewTab' || !sender.tab) return;
  getSettings()
    .then((settings) =>
      chrome.tabs.create({
        url: msg.url,
        index: sender.tab.index + 1,
        openerTabId: sender.tab.id,
        windowId: sender.tab.windowId,
        active: !settings.openInBackground,
      })
    )
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true;
});
