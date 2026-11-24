// NEWS CORNER: moved out of server.js unchanged. Needs only the express app.
module.exports = function news(app) {
  // ---------------------------------------------------------------------------------------------
  // NEWS CORNER: top headlines from a few official RSS feeds. We only keep the headline, a short
  // snippet and the link, we credit the source, and the reader opens the original article there.
  // Feeds are cached (20 minutes) so a busy site does not hammer the publishers; a feed that is
  // down shows the last good copy. Change the list with the NEWS_SOURCES_JSON variable if needed.
  // ---------------------------------------------------------------------------------------------
  const NEWS_SOURCES = (() => {
    try { if (process.env.NEWS_SOURCES_JSON) { const j = JSON.parse(process.env.NEWS_SOURCES_JSON); if (Array.isArray(j) && j.length) return j; } } catch { /* use the list below */ }
    return [
      { id: 'hindu-kerala', name: 'The Hindu · Kerala', url: 'https://www.thehindu.com/news/national/kerala/feeder/default.rss' },
      { id: 'hindu-india', name: 'The Hindu · India', url: 'https://www.thehindu.com/news/national/feeder/default.rss' },
      { id: 'onmanorama-kerala', name: 'Onmanorama · Kerala', url: 'https://www.onmanorama.com/topic/destination/5/kerala.feeds.rss.xml' },
      { id: 'kaumudi', name: 'Kerala Kaumudi', url: 'https://keralakaumudi.com/rss/en/topstories' },
    ];
  })();
  const NEWS_TTL_MS = 20 * 60 * 1000;
  const newsCache = new Map();            // id -> { at, items }
  const decodeEntities = (t) => String(t || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ''; } })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const rssText = (block, tag) => {
    const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
    if (!m) return '';
    let v = m[1].trim();
    const c = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(v);
    v = c ? c[1] : decodeEntities(v);
    return v.trim();
  };
  const plain = (h) => decodeEntities(String(h || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  const parseRss = (xml, limit) => {
    const out = [];
    const blocks = String(xml || '').match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    for (const b of blocks) {
      const title = plain(rssText(b, 'title'));
      let link = rssText(b, 'link') || rssText(b, 'guid');
      link = link.trim();
      if (!title || !/^https?:\/\//i.test(link)) continue;                 // links must be web addresses
      const snippet = plain(rssText(b, 'description')).slice(0, 180);
      const t = Date.parse(rssText(b, 'pubDate'));
      out.push({ title: title.slice(0, 220), link, snippet, published: Number.isFinite(t) ? new Date(t).toISOString() : '' });
      if (out.length >= limit) break;
    }
    return out;
  };
  const loadNews = async (src) => {
    const hit = newsCache.get(src.id);
    if (hit && Date.now() - hit.at < NEWS_TTL_MS) return { items: hit.items, stale: false };
    try {
      if (typeof fetch !== 'function') throw new Error('no fetch');
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(src.url, { signal: ctl.signal, headers: { 'User-Agent': 'ClanDeck/1.0 (+https://clandeck.com)', Accept: 'application/rss+xml, application/xml, text/xml' } });
      clearTimeout(timer);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const items = parseRss(await r.text(), 15);
      if (!items.length) throw new Error('no headlines');
      newsCache.set(src.id, { at: Date.now(), items });
      return { items, stale: false };
    } catch (e) {
      if (hit) return { items: hit.items, stale: true };                  // keep showing the last good copy
      throw e;
    }
  };
  app.get('/api/news/sources', (req, res) => res.json({ success: true, data: NEWS_SOURCES.map((s) => ({ id: s.id, name: s.name })) }));
  app.get('/api/news', async (req, res) => {
    const src = NEWS_SOURCES.find((s) => s.id === String(req.query.source || '')) || NEWS_SOURCES[0];
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 15);
    try {
      const r = await loadNews(src);
      res.json({ success: true, source: { id: src.id, name: src.name }, stale: r.stale, data: r.items.slice(0, limit) });
    } catch (e) {
      res.json({ success: false, source: { id: src.id, name: src.name }, error: 'This news source is not answering right now. Please try again later.' });
    }
  });
};