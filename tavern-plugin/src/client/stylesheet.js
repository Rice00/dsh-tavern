function installTavernStylesheet(doc, url) {
    const id = 'dsh-tavern-plugin/tavern.css';
    const win = doc.defaultView;
    const active = doc.__dshTavernStylesheet;
    if (active && active.url === url) return;
    if (active) active.dispose();
    const selector = 'link[data-plugin-css="' + id + '"]';
    const previous = Array.from(doc.querySelectorAll(selector)).find(link => link.sheet);
    if (previous && previous.getAttribute('href') === url) return;
    // Keep the last working stylesheet until its replacement has loaded.
    for (const link of doc.querySelectorAll(selector)) if (link !== previous) link.remove();
    const link = doc.createElement('link');
    link.rel = 'stylesheet'; link.dataset.plugin = 'dsh-tavern-plugin'; link.dataset.pluginCss = id;
    let timer = null, attempts = 0, requests = 0, loaded = false, disposed = false;
    function request() {
        if (disposed || loaded) return;
        attempts++;
        requests++;
        link.href = url + (requests > 1 ? (url.includes('?') ? '&' : '?') + 'retry=' + Date.now() + '-' + requests : '');
    }
    function retry() {
        if (disposed || loaded || timer !== null) return;
        attempts = 0;
        // Defer so focus/online events cannot issue parallel requests.
        timer = win.setTimeout(() => { timer = null; request(); }, 0);
    }
    function stopWatching() {
        if (timer !== null) win.clearTimeout(timer);
        timer = null;
        win.removeEventListener('online', retry); win.removeEventListener('focus', retry);
    }
    link.addEventListener('load', () => {
        if (disposed) return;
        loaded = true; stopWatching();
        if (previous) previous.remove();
    });
    link.addEventListener('error', () => {
        if (disposed || loaded || timer !== null) return;
        if (attempts < 4) timer = win.setTimeout(() => { timer = null; request(); }, 500 * 2 ** (attempts - 1));
        else {
            console.warn('DSH Tavern 样式加载失败；恢复网络或回到页面后将重试。');
            win.addEventListener('online', retry); win.addEventListener('focus', retry);
        }
    });
    doc.__dshTavernStylesheet = { url, dispose() { disposed = true; stopWatching(); if (!loaded) link.remove(); } };
    request(); doc.head.appendChild(link);
}
