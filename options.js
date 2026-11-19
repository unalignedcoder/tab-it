const DEFAULTS = {
  externalLinks: true,
  addressBar: true,
  bookmarks: true,
  history: true,
  openInBackground: false,
  debug: false,
};

const status = document.getElementById('status');

chrome.storage.sync.get(DEFAULTS, (settings) => {
  for (const [id, value] of Object.entries(settings)) {
    const box = document.getElementById(id);
    if (!box) continue;
    box.checked = value;
    box.addEventListener('change', () => {
      chrome.storage.sync.set({ [id]: box.checked }, () => {
        status.textContent = 'Saved';
        setTimeout(() => (status.textContent = ''), 1000);
      });
    });
  }
});

// Keep the toolbar icon in line with the browser/system theme.
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const reportTheme = () => chrome.runtime.sendMessage({ type: 'theme', dark: darkQuery.matches });
reportTheme();
darkQuery.addEventListener('change', reportTheme);
