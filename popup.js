(async () => {
  const $ = (id) => document.getElementById(id);
  const settings = await trellisGetSettings();

  $('enabled').checked = settings.enabled;
  $('enabled').addEventListener('change', (e) => chrome.storage.local.set({ enabled: e.target.checked }));
  $('restoreMode').value = settings.restoreMode;
  $('restoreMode').addEventListener('change', (e) => chrome.storage.local.set({ restoreMode: e.target.value }));
  $('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  let workbenchSite = '';
  $('workbench').addEventListener('click', () => {
    const query = workbenchSite ? `?site=${encodeURIComponent(workbenchSite)}` : '';
    chrome.tabs.create({ url: chrome.runtime.getURL('workbench.html' + query) });
  });

  // ---------- Memory ----------
  for (const c of settings.memoryCategories) $('memCategory').append(new Option(c, c));
  const showMemory = (msg = '') => {
    const n = settings.memory.length;
    $('memStatus').textContent = msg || `${n} ${n === 1 ? 'entry' : 'entries'} in memory`;
  };
  $('memAdd').addEventListener('click', async () => {
    const term = $('memTerm').value.trim();
    if (!term) return;
    const added = await trellisAddToMemory([term], $('memCategory').value, { partial: $('memPartial').checked });
    settings.memory = (await chrome.storage.local.get('memory')).memory || [];
    $('memTerm').value = '';
    showMemory(added ? `Saved. ${settings.memory.length} entries in memory.` : 'Already in memory.');
  });
  $('memTerm').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('memAdd').click();
  });
  showMemory();

  // ---------- Placeholder mappings (session) ----------
  const showVault = async () => {
    const n = trellisVaultEntries(await chrome.storage.session.get(null)).length;
    $('vault').textContent = `${n} placeholder ${n === 1 ? 'mapping' : 'mappings'} remembered in this browser session`;
    $('forget').disabled = n === 0;
  };
  $('forget').addEventListener('click', async () => {
    const keys = Object.keys(await chrome.storage.session.get(null)).filter((k) => k.startsWith(TRELLIS_VAULT_PREFIX));
    await chrome.storage.session.remove(keys);
    showVault();
  });
  showVault();

  // ---------- Current site ----------
  const site = $('site');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = null;
  try {
    const url = new URL(tab.url);
    if (url.protocol === 'https:' || url.protocol === 'http:') host = url.hostname;
  } catch (e) {}

  if (!host) {
    site.textContent = 'Unsupported page';
    return;
  }
  if (trellisHostMatches(host, settings.domains)) {
    workbenchSite = trellisSiteFor(host, settings.domains);
    site.textContent = `✓ Protected: ${host}`;
    site.classList.add('on');
    return;
  }

  site.textContent = `Not protected: ${host}`;
  const domain = trellisNormalizeDomain(host.replace(/^www\./, ''));
  if (!domain) return;
  const addSite = $('addSite');
  addSite.hidden = false;
  addSite.textContent = `Protect ${domain}`;
  addSite.addEventListener('click', async () => {
    const granted = await chrome.permissions.request({ origins: [trellisDomainToPattern(domain)] });
    if (!granted) return;
    await chrome.storage.local.set({ domains: [...settings.domains, domain] });
    site.textContent = `✓ Protected: ${host}`;
    site.classList.add('on');
    addSite.hidden = true;
  });
})();
