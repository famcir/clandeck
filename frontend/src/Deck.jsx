import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import CommonHeader from './CommonHeader.jsx';
import ChatSystem from './ChatSystem.jsx';

const API_URL = import.meta.env.VITE_API_URL || 'https://api.clandeck.com';

// ================= FAMILY TREE (tree view + line view) =================
// ---- sizes: smaller on phones. IMG = photo size, CW/CH = space one person takes (photo + name + relation) ----
const DIMS = {
  desk: { IMG: 60, CW: 96, CH: 118, GAP: 24, COUPLE: 24, ROW: 190, PAD: 30, BUS: 26, TW: 128, TH: 48, EW: 84, TIMG: 34, TRAIL_H: 116 },
  mob:  { IMG: 44, CW: 72, CH: 96,  GAP: 16, COUPLE: 16, ROW: 154, PAD: 14, BUS: 22, TW: 104, TH: 42, EW: 54, TIMG: 28, TRAIL_H: 100 },
};
const LINE = '#b89a6a';
const LINE_W = 2;

function useDims() {
  const get = () => (typeof window !== 'undefined' && window.innerWidth < 650 ? DIMS.mob : DIMS.desk);
  const [d, setD] = useState(get);
  useEffect(() => {
    const f = () => setD(get());
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return d;
}

// how is person `id` directly related to the owner of this family? (null when not at all)
function relationIn(fam, id) {
  if (!fam || !id) return null;
  if (fam.father && fam.father.id === id) return 'Father';
  if (fam.mother && fam.mother.id === id) return 'Mother';
  if ((fam.siblings || []).some((x) => x.id === id)) return 'Sibling';
  if ((fam.spouses || []).some((x) => x.id === id)) return 'Spouse';
  if ((fam.children || []).some((x) => x.id === id)) return 'Child';
  return null;
}

const photoOf = (p) => (p && (p.photo_compressed_url || p.photo_url)) || '';
const initialOf = (p) => ((p && p.display_name) || '?').trim().charAt(0).toUpperCase();

// same look as the buttons in CommonHeader (bold 12px, tan, dark when active)
const navBtn = (active, disabled) => ({
  padding: '7px 16px', borderRadius: '8px', border: '1px solid #d8c5a3', cursor: disabled ? 'default' : 'pointer',
  fontWeight: 800, fontSize: '12px', fontFamily: 'inherit', background: active ? '#1a1a1a' : '#c9ad83', color: 'white',
  boxShadow: active ? '0 2px 6px rgba(0,0,0,0.15)' : 'none', opacity: disabled ? 0.45 : 1, transition: 'all 0.2s',
});

/**
 * Works out where every person goes and which lines join them. Lines start and end at the PHOTOS.
 *
 *            (Father)──(Mother)
 *                  │
 *        ┌─────────┴─────────┐
 *   (Sibling)   ( ME )──(Spouse 1)   (Spouse 2)
 *                  └────┬────┘
 *                   (Child) (Child)       <- centred under ME + that spouse
 */
function buildLayout(me, fam, D) {
  const { IMG, CW, CH, GAP, COUPLE, ROW, PAD, BUS } = D;
  const father = fam.father || null;
  const mother = fam.mother || null;
  const siblings = fam.siblings || [];
  const spouses = fam.spouses || [];
  const children = fam.children || [];
  const hasParents = !!(father || mother);

  const nodes = [];
  const lines = [];
  const dots = [];
  const L = (x1, y1, x2, y2) => lines.push(`M${x1} ${y1} L${x2} ${y2}`);
  const imgL = (x) => x + (CW - IMG) / 2;
  const imgR = (x) => x + (CW + IMG) / 2;

  const y1 = hasParents ? ROW : 0;      // middle row (me, siblings, spouses)
  const y0 = 0;                         // parents row
  const y2 = y1 + ROW;                  // children row

  // ---- middle row: siblings (left) · me · spouses (right) ----
  let x = 0;
  const mid = [];
  siblings.forEach((s, i) => {
    mid.push({ p: s, x, rel: 'Sibling' });
    x += CW + GAP;
  });
  const meX = x;
  mid.push({ p: me, x: meX, rel: 'Self', center: true });
  x += CW;
  const spouseNodes = [];
  spouses.forEach((s, i) => {
    x += i === 0 ? COUPLE : GAP;
    const n = { p: s, x, rel: 'Spouse' };
    mid.push(n); spouseNodes.push(n);
    x += CW;
  });
  const meCx = meX + CW / 2;
  const midY = y1 + IMG / 2;

  // ---- marriage lines ----
  const anchors = [];   // where each spouse's children hang from
  spouseNodes.forEach((n, i) => {
    const spCx = n.x + CW / 2;
    if (i === 0) {
      L(imgR(meX), midY, imgL(n.x), midY);
      anchors.push({ x: (meCx + spCx) / 2, y: midY });
    } else {
      const depth = y1 + CH + 8 * i;                   // runs underneath the names
      lines.push(`M${meCx} ${y1 + IMG} L${meCx} ${depth} L${spCx} ${depth} L${spCx} ${y1 + IMG}`);
      anchors.push({ x: (meCx + spCx) / 2, y: depth });
      dots.push({ x: meCx, y: y1 + IMG });
    }
  });

  // ---- parents ----
  const sibCxs = mid.filter((m) => m.rel !== 'Spouse').map((m) => m.x + CW / 2);
  let parentsMinX = Infinity, parentsMaxX = -Infinity;
  if (hasParents) {
    const pCx = (Math.min(...sibCxs) + Math.max(...sibCxs)) / 2;
    const both = father && mother;
    const pw = both ? CW * 2 + COUPLE : CW;
    const px = pCx - pw / 2;
    parentsMinX = px; parentsMaxX = px + pw;
    let dropY;
    if (both) {
      const mx = px + CW + COUPLE;
      nodes.push({ p: father, x: px, y: y0, rel: 'Father' });
      nodes.push({ p: mother, x: mx, y: y0, rel: 'Mother' });
      L(imgR(px), y0 + IMG / 2, imgL(mx), y0 + IMG / 2);
      dropY = y0 + IMG / 2;
    } else {
      nodes.push({ p: father || mother, x: px, y: y0, rel: father ? 'Father' : 'Mother' });
      dropY = y0 + IMG;
    }
    const bus = y1 - BUS;
    L(pCx, dropY, pCx, bus);
    const bl = Math.min(...sibCxs, pCx), br = Math.max(...sibCxs, pCx);
    if (br > bl) L(bl, bus, br, bus);
    sibCxs.forEach((cx) => L(cx, bus, cx, y1));
  }

  mid.forEach((m) => nodes.push({ ...m, y: y1 }));

  // ---- children, grouped by the spouse they belong to ----
  const groups = spouses.map((s, i) => ({ anchor: anchors[i], kids: [] }));
  const loose = [];
  children.forEach((c) => {
    const gi = spouses.findIndex((s) => s.spouse_group != null && String(s.spouse_group) === String(c.spouse_group));
    if (gi >= 0) groups[gi].kids.push(c); else loose.push(c);
  });
  if (loose.length) {
    if (groups.length === 1) groups[0].kids.push(...loose);
    else groups.push({ anchor: { x: meCx, y: y1 + IMG }, kids: loose });
  }
  const active = groups.filter((g) => g.kids.length).sort((a, b) => a.anchor.x - b.anchor.x);
  let prevRight = -Infinity, childMin = Infinity, childMax = -Infinity;
  const prevSpans = [];
  active.forEach((g) => {
    const w = g.kids.length * CW + (g.kids.length - 1) * GAP;
    let left = g.anchor.x - w / 2;
    if (left < prevRight + GAP * 2) left = prevRight + GAP * 2;   // never overlap the neighbouring family
    prevRight = left + w;
    childMin = Math.min(childMin, left); childMax = Math.max(childMax, left + w);
    const cxs = g.kids.map((k, i) => {
      const kx = left + i * (CW + GAP);
      nodes.push({ p: k, x: kx, y: y2, rel: 'Child' });
      return kx + CW / 2;
    });
    // if this family's line would drop straight onto another family's children, run it one level higher
    const clash = prevSpans.some((sp) => g.anchor.x >= sp.a - 4 && g.anchor.x <= sp.b + 4);
    const bus = y2 - BUS - (clash ? 14 : 0);
    L(g.anchor.x, g.anchor.y, g.anchor.x, bus);
    const bl = Math.min(...cxs, g.anchor.x), br = Math.max(...cxs, g.anchor.x);
    if (br > bl) L(bl, bus, br, bus);
    cxs.forEach((cx) => L(cx, bus, cx, y2));
    prevSpans.push({ a: cxs[0], b: cxs[cxs.length - 1] });
  });

  // ---- make the selected person the exact horizontal middle of the canvas ----
  const minX0 = Math.min(0, parentsMinX, childMin);
  const maxX0 = Math.max(x, parentsMaxX, childMax);
  const span = Math.max(meCx - minX0, maxX0 - meCx);
  const minX = meCx - span, maxX = meCx + span;
  const dx = PAD - minX;
  const dy = PAD;
  const shiftPath = (d) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, a, b) => `${+a + dx} ${+b + dy}`);
  const bottom = (active.length ? y2 : y1) + CH;
  return {
    nodes: nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })),
    paths: lines.map(shiftPath),
    dots: dots.map((d) => ({ x: d.x + dx, y: d.y + dy })),
    width: maxX - minX + PAD * 2,
    height: bottom + PAD * 2,
    meCx: meCx + dx,
  };
}

// one person in the tree: just the photo, name and relation (no box). Photo zooms up while the mouse is on it.
function Person({ node, D, isLogin, onPick, onView }) {
  const { p, rel, center } = node;
  const [imgOk, setImgOk] = useState(true);
  const [hover, setHover] = useState(false);
  const src = photoOf(p);
  const label = rel === 'Self' ? (isLogin ? 'You' : 'Selected') : rel + (isLogin ? ' • You' : '');
  return (
    <button
      type="button"
      onClick={() => { if (!center) onPick(p, rel); else if (onView && !isLogin) onView(p); }}
      title={center ? (onView && !isLogin ? `View ${p.display_name}'s profile` : p.display_name) : `Open ${p.display_name}'s family`}
      style={{
        position: 'absolute', left: node.x, top: node.y, width: D.CW, height: D.CH, padding: 0, border: 'none', background: 'none',
        font: 'inherit', cursor: center && !(onView && !isLogin) ? 'default' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center',
        zIndex: hover ? 20 : 1,
      }}
    >
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'relative', zIndex: hover ? 5 : 0,
          width: D.IMG, height: D.IMG, borderRadius: 12, overflow: 'hidden', background: '#e8d5b0', flexShrink: 0, boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: D.IMG * 0.4, color: '#5a4524',
          border: center ? '3px solid #1a1a1a' : '2px solid #fff',
          boxShadow: hover ? '0 10px 24px rgba(0,0,0,.35)' : center ? '0 4px 12px rgba(0,0,0,.22)' : '0 1px 4px rgba(0,0,0,.18)',
          transform: hover ? 'scale(1.75)' : 'none', transformOrigin: 'center', transition: 'transform .18s ease, box-shadow .18s ease',
        }}
      >
        {src && imgOk ? <img src={src} alt="" onError={() => setImgOk(false)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initialOf(p)}
      </div>
      {/* the white background lets a line pass behind the text instead of through it */}
      <div style={{ position: 'relative', zIndex: 1, background: 'white', width: '100%', marginTop: 6, fontWeight: 600, fontSize: 12, lineHeight: '15px', maxHeight: 30, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word', color: '#1a1a1a' }}>
        {p.display_name}
      </div>
      <div style={{ position: 'relative', zIndex: 1, background: 'white', width: '100%', fontWeight: 600, fontSize: 11, lineHeight: '14px', color: center ? '#1a1a1a' : '#8a7a5c' }}>{label}</div>
    </button>
  );
}

// one step of the path in Line view
function Chip({ item, p, index, isLast, isLogin, x, y = 14, D, onJump, onView }) {
  const [imgOk, setImgOk] = useState(true);
  const src = photoOf(p);
  const sub = index === 0 ? (isLogin ? 'You' : '') : isLast ? 'Showing' : item.rel;
  return (
    <button
      type="button"
      disabled={isLast && !(onView && p && !isLogin)}
      onClick={() => { if (isLast) { if (onView && p) onView(p); } else onJump(index); }}
      title={isLast ? (onView && p && !isLogin ? `View ${p.display_name}'s profile` : '') : `Go back to ${p ? p.display_name : ''}`}
      style={{
        position: 'absolute', left: x - D.TW / 2, top: y, width: D.TW, height: D.TH, padding: 5, boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 7, textAlign: 'left', font: 'inherit', color: '#1a1a1a',
        background: isLast ? '#fffaf0' : '#fff', border: isLast ? '2px solid #1a1a1a' : '1px solid #e3d3b3',
        borderRadius: 10, cursor: isLast ? 'default' : 'pointer',
        boxShadow: isLast ? '0 4px 12px rgba(0,0,0,.18)' : '0 1px 4px rgba(0,0,0,.08)',
      }}
    >
      <div style={{ width: D.TIMG, height: D.TIMG, borderRadius: 8, overflow: 'hidden', background: '#e8d5b0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 13, color: '#5a4524', flexShrink: 0 }}>
        {src && imgOk ? <img src={src} alt="" onError={() => setImgOk(false)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initialOf(p)}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, lineHeight: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p ? p.display_name : '…'}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#8a7a5c', lineHeight: '13px' }}>{sub}{isLogin && index !== 0 ? ' • You' : ''}</div>
      </div>
    </button>
  );
}

/**
 * <FamilyTree userId={loggedInUserOrProfileId} onFocus={(profile) => ...} />
 *
 * Two views (toggle at the top):
 *  - Tree view: the selected person in the middle with parents / siblings / spouses / children.
 *    Click anyone to re-centre the tree on them.
 *  - Line view: same tree, but the path you followed stays on top as a connected line
 *    (You → Father → Father's sibling → ...). Click any earlier person on the path to jump back to them.
 */
function FamilyTree({ userId, onFocus, openReq, readOnly = false, onViewProfile }) {
  const D = useDims();
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('clandeck_tree_view') === 'line' ? 'line' : 'tree'; } catch { return 'tree'; }
  });
  const [trail, setTrail] = useState([{ id: userId, rel: '' }]);   // trail[0] = logged-in person, last = person shown
  const [home, setHome] = useState(null);
  const [data, setData] = useState(null);       // {myProfile, family}
  const [myProfileId, setMyProfileId] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef(null);
  const rootRef = useRef(null);
  const famCache = useRef({});                // family of every person we have opened, to spot direct relations
  const [fitW, setFitW] = useState(0);        // width available for the tree
  const [invite, setInvite] = useState(null); // invite pop-up

  const focusId = trail[trail.length - 1].id;
  const atHome = trail.length === 1;

  useEffect(() => { setTrail([{ id: userId, rel: '' }]); }, [userId]);

  // opened straight onto a line (from search): my own card at the start of the line still needs its name and photo
  useEffect(() => {
    if (home || readOnly || !userId) return undefined;
    let dead = false;
    fetch(`${API_URL}/api/profiles/family-tree?user_id=${encodeURIComponent(userId)}`).then((r) => r.json()).then((j) => { if (!dead && j.success && j.myProfile) { setHome(j.myProfile); setMyProfileId(j.myProfile.id); } }).catch(() => {});
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, readOnly, !!home]);

  useEffect(() => {
    if (!focusId) return;
    let alive = true;
    setLoading(true); setError('');
    fetch(`${API_URL}/api/profiles/family-tree?user_id=${encodeURIComponent(focusId)}${readOnly || focusId !== userId ? '&exact=1' : ''}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (!j.success) throw new Error(j.error || 'Could not load the family tree');
        famCache.current[focusId] = j.family || {};
        if (j.myProfile) famCache.current[j.myProfile.id] = j.family || {};
        setData(j);
        if (focusId === userId) { setHome(j.myProfile); if (!readOnly) setMyProfileId(j.myProfile.id); }
        if (onFocus) onFocus(j.myProfile);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, userId]);

  const chooseView = (v) => { setView(v); try { localStorage.setItem('clandeck_tree_view', v); } catch { /* ignore */ } };

  const layout = useMemo(() => (data ? buildLayout(data.myProfile, data.family || {}, D) : null), [data, D]);

  const lineMode = view === 'line';
  const T = trail.length;
  // line view: the line wraps onto the next row (with a connecting arrow) when it does not fit the width
  const W = layout ? (lineMode ? Math.max(layout.width, fitW || 0, 2 * D.PAD + D.TW) : layout.width) : 0;
  const avail = Math.min(W, fitW || W);   // the width you can see at once; the line wraps to it
  const per = lineMode ? Math.max(1, Math.floor((avail - 2 * D.PAD + D.EW) / (D.TW + D.EW))) : 1;   // how many people fit in one row
  const rowH = D.TH + 46;
  const rows = lineMode ? Math.ceil(T / per) : 0;
  const trailH = lineMode ? D.TRAIL_H + Math.max(0, rows - 1) * rowH : 0;
  // shrink the whole tree to fit the space it has (never below 55%, after that it scrolls inside its own box)
  const scale = 1;   // people keep their normal size; a big tree scrolls (sideways and up/down) inside its own box
  const needScroll = W * scale > fitW + 1;

  // keep the selected person in the horizontal middle of the view
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !layout) return;
    el.scrollLeft = Math.max(0, (W * scale) / 2 - el.clientWidth / 2);
  }, [layout, W, scale]);

  // watch the width of the box the tree lives in
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const measure = () => setFitW(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // cards pass (person, relation); a person already on the path just jumps back to that point, so it never loops
  const pick = useCallback((p, rel) => {
    setTrail((t) => {
      const idx = t.findIndex((x, i) => x.id === p.id || (x.p && x.p.id === p.id) || (i === 0 && home && home.id === p.id));
      if (idx >= 0) return t.slice(0, idx + 1);
      // directly related to someone earlier on the path (e.g. Me -> Mother -> my Sister)?  Then join straight to that person
      for (let i = t.length - 2; i >= 0; i--) {
        const r = relationIn(famCache.current[t[i].id], p.id);
        if (r) return [...t.slice(0, i + 1), { id: p.id, p, rel: r }];
      }
      return [...t, { id: p.id, p, rel: rel || '' }];
    });
  }, [home]);

  const jump = (i) => setTrail((t) => t.slice(0, i + 1));
  // clicking the person who is already selected opens their profile (view only); the path from me is kept as the breadcrumb
  const viewSelected = onViewProfile && !(readOnly && trail.length === 1) ? (p) => {
    const way = readOnly ? '' : ['You', ...trail.slice(1).map((x) => `${x.rel ? x.rel + ': ' : ''}${x.p ? x.p.display_name : ''}`)].join(' › ');
    onViewProfile(p, way);
  } : undefined;

  // a person was picked in My Groups or in the search box: show their tree, joined to ME by the whole path
  // (e.g. Me > Sister > College friends > Arun). The line before a group member carries the group's name.
  const lastReq = useRef(null);
  useEffect(() => {
    if (!openReq || lastReq.current === openReq.n) return;
    lastReq.current = openReq.n;
    setView('line');   // coming from search: show the line  Me > friend > ... > person
    setTrail((t) => {
      if (!t.length) return t;
      const items = (openReq.path || [])
        .filter((x) => x.p && x.p.id !== t[0].id && !(home && home.id === x.p.id))
        .map((x) => ({ id: x.p.id, p: x.p, rel: x.rel || '' }));
      return items.length ? [t[0], ...items] : t.slice(0, 1);
    });
    if (rootRef.current && rootRef.current.scrollIntoView) rootRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [openReq, home]);
  const back = () => setTrail((t) => (t.length > 1 ? t.slice(0, -1) : t));
  const goHome = () => setTrail((t) => t.slice(0, 1));

  const chipY = 14 + D.TH / 2;
  const nRow = Math.min(per, T);
  const rowLeft = (W - (nRow * D.TW + (nRow - 1) * D.EW)) / 2;   // centred on the selected person
  const cxOf = (i) => rowLeft + D.TW / 2 + (i % per) * (D.TW + D.EW);
  const topOf = (i) => 14 + Math.floor(i / per) * rowH;
  const canInvite = (p) => !readOnly && !!(p && home && !p.is_claimed && p.id !== home.id && p.owner_user_id && p.owner_user_id === home.owner_user_id);
  const profileOf = (item, i) => item.p || (i === 0 ? home : null);

  return (
    <div ref={rootRef} style={{ width: '100%', minWidth: 0, fontFamily: 'inherit' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 14px', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => chooseView('tree')} style={navBtn(!lineMode)}>🌳 Tree view</button>
        <button type="button" onClick={() => chooseView('line')} style={navBtn(lineMode)}>➖ Line view</button>
        <button type="button" style={navBtn(false, atHome)} disabled={atHome} onClick={back}>← Back</button>
        <button type="button" style={navBtn(false, atHome)} disabled={atHome} onClick={goHome}>{readOnly ? '⌂ Start' : '⌂ My tree'}</button>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#8a7a5c' }}>
          {data ? <>Showing <span style={{ color: '#1a1a1a' }}>{data.myProfile.display_name}</span>{atHome ? '' : "'s family"} · tap anyone to open their tree</> : ''}
        </span>
      </div>

      {error && <div style={{ padding: 16, color: '#b00020', fontWeight: 600, fontSize: 12 }}>{error}</div>}
      {loading && !data && <div style={{ padding: 24, color: '#8a7a5c', fontWeight: 600, fontSize: 12 }}>Loading family tree…</div>}

      {layout && (
        <div ref={scrollRef} style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '78vh', opacity: loading ? 0.5 : 1, transition: 'opacity .15s' }}>
         <div style={{ position: 'relative', width: W * scale, height: (trailH + layout.height) * scale, margin: '0 auto' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: trailH + layout.height, transformOrigin: '0 0', transform: scale < 1 ? `scale(${scale})` : 'none' }}>

            {lineMode && (
              <>
                <svg width={W} height={trailH} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
                  {trail.slice(1).map((item, k) => {
                    const i = k + 1;
                    const sameRow = Math.floor((i - 1) / per) === Math.floor(i / per);
                    if (sameRow) {
                      const y = topOf(i) + D.TH / 2, x1 = cxOf(i - 1) + D.TW / 2, x2 = cxOf(i) - D.TW / 2;
                      return (
                        <g key={i}>
                          <path d={`M${x1} ${y} L${x2 - 2} ${y}`} stroke={LINE} strokeWidth={LINE_W} />
                          <path d={`M${x2} ${y} l-7 -4.5 l0 9 z`} fill={LINE} />
                        </g>
                      );
                    }
                    // end of a row: the arrow drops down and runs back to the start of the next row
                    const yA = topOf(i - 1) + D.TH, yMid = yA + 23, yB = topOf(i);
                    return (
                      <g key={i}>
                        <path d={`M${cxOf(i - 1)} ${yA} L${cxOf(i - 1)} ${yMid} L${cxOf(i)} ${yMid} L${cxOf(i)} ${yB - 2}`} fill="none" stroke={LINE} strokeWidth={LINE_W} strokeLinejoin="round" />
                        <path d={`M${cxOf(i)} ${yB} l-4.5 -7 l9 0 z`} fill={LINE} />
                      </g>
                    );
                  })}
                  {(() => {
                    const lx = cxOf(T - 1), yA = topOf(T - 1) + D.TH, yMid = yA + 18;
                    return (
                      <>
                        <path d={`M${lx} ${yA} L${lx} ${yMid} L${W / 2} ${yMid} L${W / 2} ${trailH - 4}`} fill="none" stroke={LINE} strokeWidth={LINE_W} strokeDasharray="4 4" />
                        <path d={`M${W / 2} ${trailH} l-5 -8 l10 0 z`} fill={LINE} />
                      </>
                    );
                  })()}
                </svg>
                {trail.slice(1).map((item, k) => {
                  const i = k + 1;
                  const sameRow = Math.floor((i - 1) / per) === Math.floor(i / per);
                  const y = sameRow ? topOf(i) + D.TH / 2 : topOf(i - 1) + D.TH + 23;
                  const mx = sameRow ? (cxOf(i - 1) + D.TW / 2 + cxOf(i) - D.TW / 2) / 2 : (cxOf(i - 1) + cxOf(i)) / 2;
                  const w = D.EW - 4;
                  return (
                    <span key={'l' + i} title={item.rel} style={{ position: 'absolute', left: Math.max(2, mx - w / 2), width: w, top: y - 4, transform: 'translateY(-100%)', textAlign: 'center', fontSize: 11, lineHeight: '12px', fontWeight: 600, color: '#8a7a5c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.rel}
                    </span>
                  );
                })}
                {trail.map((item, i) => (
                  <Chip key={item.id + i} item={item} p={profileOf(item, i)} index={i} isLast={i === T - 1} D={D}
                    isLogin={!!myProfileId && profileOf(item, i) && profileOf(item, i).id === myProfileId}
                    x={cxOf(i)} y={topOf(i)} onJump={jump} onView={viewSelected} />
                ))}
              </>
            )}

            <div style={{ position: 'absolute', left: W / 2 - layout.width / 2, top: trailH, width: layout.width, height: layout.height }}>
              <svg width={layout.width} height={layout.height} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
                {layout.paths.map((d, i) => (
                  <path key={i} d={d} fill="none" stroke={LINE} strokeWidth={LINE_W} strokeLinecap="round" strokeLinejoin="round" />
                ))}
                {layout.dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={3} fill={LINE} />)}
              </svg>
              {layout.nodes.map((n) => (
                <Person key={n.p.id + n.rel} node={n} D={D} isLogin={!!myProfileId && n.p.id === myProfileId} onPick={pick} onView={viewSelected} />
              ))}
              {layout.nodes.filter((n) => canInvite(n.p)).map((n) => (
                <button key={'inv' + n.p.id} type="button" title={`Invite ${n.p.display_name} (temporary login by WhatsApp / SMS)`} aria-label={`Invite ${n.p.display_name}`}
                  onClick={() => setInvite({ person: n.p, mobile: n.p.mobile_number || '', result: null })}
                  style={{ position: 'absolute', left: n.x + (D.CW + D.IMG) / 2 - 13, top: n.y - 9, width: 24, height: 24, padding: 0, borderRadius: '50%', border: '2px solid #fff', background: '#1a1a1a', color: '#fff', fontSize: 11, lineHeight: '20px', cursor: 'pointer', zIndex: 30, boxShadow: '0 1px 4px rgba(0,0,0,.3)' }}>
                  📤
                </button>
              ))}
            </div>
          </div>
         </div>
        </div>
      )}
      {invite && home && <InviteModal invite={invite} setInvite={setInvite} home={home} />}
    </div>
  );
}


// ================= INVITE (temporary login to share by WhatsApp / SMS) =================
const invInput = { width: '100%', padding: '12px 16px', borderRadius: '20px', border: 'none', background: '#f0ede8', fontSize: '13px', boxSizing: 'border-box', outline: 'none' };
const invLabel = { fontSize: '9px', fontWeight: 600, color: '#8a7a65', letterSpacing: '0.5px', marginBottom: '6px', display: 'block' };

function InviteModal({ invite, setInvite, home }) {
  const [busy, setBusy] = useState(false);
  const close = () => { if (!busy) setInvite(null); };

  const create = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/profiles/invite`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: invite.person.id, home_id: home.id, mobile: invite.mobile }),
      });
      let data = {}; try { data = await r.json(); } catch { /* not JSON */ }
      if (!r.ok || !data.success) throw new Error(data.error || 'Could not create the login');
      setInvite((i) => ({ ...i, result: data }));
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  const text = () => {
    const r = invite.result;
    return `Hi ${r.name}, ${home.display_name || 'a family member'} added you to the family tree on ClanDeck.\n\nOpen https://clandeck.com and log in with\nUsername: ${r.username}\nPassword: ${r.password}\n\nThis temporary login works for ${r.valid_days} days. After you log in, please set your own username and password.`;
  };
  // digits only; a plain 10-digit number gets the India code 91
  const num = () => { const d = String(invite.mobile || '').replace(/\D/g, ''); return d.length === 10 ? '91' + d : d; };
  const whatsapp = () => window.open(`https://wa.me/${num()}?text=${encodeURIComponent(text())}`, '_blank', 'noopener');
  const sms = () => { window.location.href = `sms:${num() ? '+' + num() : ''}?body=${encodeURIComponent(text())}`; };
  const copy = async () => { try { await navigator.clipboard.writeText(text()); alert('Message copied'); } catch { alert('Could not copy, please select the text and copy it'); } };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }} onClick={close}>
      <div style={{ background: '#f7f4ef', borderRadius: 16, padding: 20, width: '100%', maxWidth: 440, maxHeight: '92vh', overflowY: 'auto', boxSizing: 'border-box' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontWeight: 600, margin: 0 }}>Invite {invite.person.display_name}</h3>
        {!invite.result ? (
          <>
            <p style={{ fontSize: 13, color: '#555', lineHeight: 1.5 }}>This makes a <b>temporary username and password</b> for {invite.person.display_name}, valid for 7 days. They log in, see their own family tree, and add their own family members.</p>
            <label style={invLabel}>MOBILE NUMBER (FOR WHATSAPP / SMS)</label>
            <input value={invite.mobile} onChange={(e) => setInvite((i) => ({ ...i, mobile: e.target.value }))} placeholder="e.g. 9876543210" inputMode="tel" style={invInput} />
            <div style={{ fontSize: 10, color: '#8a7a65', marginTop: 4 }}>A 10-digit number gets the India code (91). For other countries type the full number with the country code.</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button type="button" onClick={close} style={{ flex: 1, padding: 12, borderRadius: 20, border: '1px solid #ddd', background: 'white', fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
              <button type="button" disabled={busy} onClick={create} style={{ flex: 2, padding: 12, borderRadius: 20, border: 'none', background: 'black', color: 'white', fontWeight: 600, cursor: 'pointer' }}>{busy ? 'Creating...' : 'Create temporary login'}</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ margin: '12px 0', padding: 12, background: 'white', border: '1px solid #e9e2d6', borderRadius: 12, fontSize: 13, lineHeight: 1.7 }}>
              <div><span style={{ color: '#8a7a65', fontSize: 11, fontWeight: 500 }}>USERNAME</span><br /><b style={{ fontFamily: 'monospace', fontSize: 15 }}>{invite.result.username}</b></div>
              <div style={{ marginTop: 6 }}><span style={{ color: '#8a7a65', fontSize: 11, fontWeight: 500 }}>PASSWORD</span><br /><b style={{ fontFamily: 'monospace', fontSize: 15 }}>{invite.result.password}</b></div>
            </div>
            <div style={{ fontSize: 11, color: '#8a5a10', background: '#fff8e1', border: '1px solid #f1dc9a', borderRadius: 10, padding: '8px 10px' }}>⚠️ The password is shown only now. Share it right away. If it is lost, press Invite again to make a new one.</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button type="button" onClick={whatsapp} style={{ flex: 1, minWidth: 120, padding: 11, borderRadius: 20, border: 'none', background: '#25d366', color: 'white', fontWeight: 600, cursor: 'pointer' }}>WhatsApp</button>
              <button type="button" onClick={sms} style={{ flex: 1, minWidth: 90, padding: 11, borderRadius: 20, border: 'none', background: '#1a73e8', color: 'white', fontWeight: 600, cursor: 'pointer' }}>SMS</button>
              <button type="button" onClick={copy} style={{ flex: 1, minWidth: 90, padding: 11, borderRadius: 20, border: '1px solid #ddd', background: 'white', fontWeight: 600, cursor: 'pointer' }}>Copy</button>
            </div>
            <button type="button" onClick={() => setInvite(null)} style={{ width: '100%', marginTop: 10, padding: 10, borderRadius: 20, border: 'none', background: 'transparent', color: '#8a7a65', fontWeight: 500, cursor: 'pointer' }}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}


// ================= MY GROUPS (friends, school, college, custom) =================
const KIND_ICON = { friends: '👫', school: '🏫', college: '🎓', custom: '⭐' };
const KIND_HINT = { friends: 'e.g. Weekend cricket gang', school: "e.g. St. Mary's 2005 batch", college: 'e.g. NIT Calicut Mech 2012', custom: 'e.g. Neighbours, Office team' };
const gPost = async (path, body) => {
  const r = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data = {}; try { data = await r.json(); } catch { /* not JSON */ }
  if (!r.ok || data.success === false) throw new Error(data.error || 'Something went wrong');
  return data;
};
const smallPill = (dark) => ({ padding: '5px 12px', borderRadius: 14, border: dark ? 'none' : '1px solid #e0d2b4', background: dark ? '#1a1a1a' : '#fff', color: dark ? '#fff' : '#5a4524', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' });

function Avatar({ p, size = 28 }) {
  const [ok, setOk] = useState(true);
  const src = photoOf(p) || (p && p.photo) || '';
  return (
    <div style={{ width: size, height: size, borderRadius: 8, overflow: 'hidden', background: '#e8d5b0', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: size * 0.42, color: '#5a4524' }}>
      {src && ok ? <img src={src} alt="" onError={() => setOk(false)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initialOf(p)}
    </div>
  );
}

function AddMemberModal({ group, homeId, members, onClose, onChange }) {
  const [tab, setTab] = useState('find');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [name, setName] = useState('');
  const [gender, setGender] = useState('Male');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const inGroup = new Set(members.map((m) => m.id));

  useEffect(() => {
    const term = q.trim();
    if (tab !== 'find' || term.length < 2) { setResults([]); return undefined; }
    let dead = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`${API_URL}/api/profiles/search?q=${encodeURIComponent(term)}&owner_profile_id=${encodeURIComponent(homeId)}&include_linked=1`);
        const j = await r.json();
        if (!dead) setResults(j.success ? j.data : []);
      } catch { if (!dead) setResults([]); }
      if (!dead) setSearching(false);
    }, 300);
    return () => { dead = true; clearTimeout(t); };
  }, [q, tab, homeId]);

  const add = async (body, label) => {
    setBusy(true); setMsg('');
    try {
      const j = await gPost(`/api/groups/${group.id}/members`, { home_id: homeId, ...body });
      onChange(j.data); setMsg(`✓ ${label} added`);
      if (body.display_name) setName('');
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }} onClick={onClose}>
      <div style={{ background: '#f7f4ef', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420, maxHeight: '92vh', overflowY: 'auto', boxSizing: 'border-box' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontWeight: 600, margin: '0 0 12px', fontSize: 15 }}>Add to {group.name}</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button type="button" onClick={() => { setTab('find'); setMsg(''); }} style={navBtn(tab === 'find')}>Find on ClanDeck</button>
          <button type="button" onClick={() => { setTab('new'); setMsg(''); }} style={navBtn(tab === 'new')}>New person</button>
        </div>
        {tab === 'find' ? (
          <>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name, or an exact email / mobile number" style={{ width: '100%', padding: '11px 14px', borderRadius: 20, border: 'none', background: '#f0ede8', fontSize: 13, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }} />
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {searching && <div style={{ fontSize: 12, color: '#8a7a65' }}>Searching...</div>}
              {!searching && q.trim().length >= 2 && results.length === 0 && <div style={{ fontSize: 12, color: '#8a7a65' }}>Nobody found. Use "New person" to add them by name.</div>}
              {results.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', borderRadius: 12, padding: 8 }}>
                  <Avatar p={r} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.display_name}</div>
                    <div style={{ fontSize: 11, color: '#8a7a65' }}>{[r.nickname, r.location].filter(Boolean).join(' • ') || (r.is_claimed ? 'On ClanDeck' : 'Added by you')}</div>
                  </div>
                  {inGroup.has(r.id)
                    ? <span style={{ fontSize: 11, color: '#4a8a3a', fontWeight: 600 }}>✓ In group</span>
                    : <button type="button" disabled={busy} onClick={() => add({ profile_id: r.id }, r.display_name)} style={smallPill(true)}>Add</button>}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" maxLength={80} style={{ width: '100%', padding: '11px 14px', borderRadius: 20, border: 'none', background: '#f0ede8', fontSize: 13, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {['Male', 'Female'].map((g) => (
                <button key={g} type="button" onClick={() => setGender(g)} style={{ ...smallPill(gender === g), flex: 1, padding: '9px' }}>{g}</button>
              ))}
            </div>
            <button type="button" disabled={busy || !name.trim()} onClick={() => add({ display_name: name, gender }, name.trim())} style={{ ...smallPill(true), width: '100%', marginTop: 12, padding: 12, borderRadius: 20, fontSize: 13, opacity: busy || !name.trim() ? 0.5 : 1 }}>{busy ? 'Adding...' : 'Add person'}</button>
            <div style={{ fontSize: 10, color: '#8a7a65', marginTop: 6 }}>You can invite them later with a temporary login, and add their own family.</div>
          </>
        )}
        {msg && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: msg.startsWith('✓') ? '#4a8a3a' : '#b3261e' }}>{msg}</div>}
        <button type="button" onClick={onClose} style={{ width: '100%', marginTop: 12, padding: 10, borderRadius: 20, border: 'none', background: 'transparent', color: '#8a7a65', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Done</button>
      </div>
    </div>
  );
}

function GroupsCard({ groups, homeId, ownerId, onChange, onOpen, onInvite }) {
  const [open, setOpen] = useState({});        // expanded groups
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState('school');
  const [adding, setAdding] = useState(null);  // group id the "Add" pop-up is for
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // keep the first group (My Friends) open the first time
  useEffect(() => { if (groups.length && Object.keys(open).length === 0) setOpen({ [groups[0].id]: true }); }, [groups]); // eslint-disable-line

  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(e.message); } setBusy(false); };
  const create = () => run(async () => {
    const j = await gPost('/api/groups', { home_id: homeId, name: newName, kind: newKind });
    onChange(j.data); setNewName(''); setShowNew(false);
    const made = j.data.find((g) => g.name.toLowerCase() === newName.trim().replace(/\s+/g, ' ').toLowerCase());
    if (made) setOpen((o) => ({ ...o, [made.id]: true }));
  });
  const rename = (g) => { const n = window.prompt('New name for this group', g.name); if (n && n.trim() && n.trim() !== g.name) run(async () => onChange((await gPost(`/api/groups/${g.id}/rename`, { home_id: homeId, name: n })).data)); };
  const del = (g) => { if (window.confirm(`Delete the group "${g.name}"? The people in it are not deleted from ClanDeck.`)) run(async () => onChange((await gPost(`/api/groups/${g.id}/delete`, { home_id: homeId })).data)); };
  const removeMember = (g, m) => { if (window.confirm(`Remove ${m.display_name} from "${g.name}"?`)) run(async () => onChange((await gPost(`/api/groups/${g.id}/members/remove`, { home_id: homeId, profile_id: m.id })).data)); };
  const toggleShare = (g) => run(async () => onChange((await gPost(`/api/groups/${g.id}/visibility`, { home_id: homeId, visibility: g.visibility === 'family' ? 'private' : 'family' })).data));
  const addingGroup = groups.find((g) => g.id === adding);

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ fontWeight: 600, fontSize: 12, margin: 0 }}>My Groups ({groups.length})</h3>
        <button type="button" onClick={() => { setShowNew((v) => !v); setErr(''); }} style={smallPill(!showNew)}>{showNew ? 'Cancel' : '＋ New group'}</button>
      </div>

      {showNew && (
        <div style={{ background: '#faf6ee', border: '1px solid #f0e0c0', borderRadius: 10, padding: 10, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {Object.keys(KIND_ICON).map((k) => (
              <button key={k} type="button" onClick={() => setNewKind(k)} style={smallPill(newKind === k)}>{KIND_ICON[k]} {k === 'custom' ? 'Other' : k[0].toUpperCase() + k.slice(1)}</button>
            ))}
          </div>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} placeholder={KIND_HINT[newKind]} onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) create(); }}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 16, border: '1px solid #e8dcc2', background: '#fff', fontSize: 12, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }} />
          <button type="button" disabled={busy || !newName.trim()} onClick={create} style={{ ...smallPill(true), width: '100%', marginTop: 8, padding: 9, opacity: busy || !newName.trim() ? 0.5 : 1 }}>Create group</button>
        </div>
      )}
      {err && <div style={{ fontSize: 11, color: '#b3261e', marginBottom: 8 }}>{err}</div>}

      {groups.length === 0 && <p style={{ fontSize: 11, color: '#aaa' }}>Loading your groups…</p>}
      {groups.map((g) => {
        const isOpen = !!open[g.id];
        return (
          <div key={g.id} style={{ border: '1px solid #f0e0c0', borderRadius: 10, marginBottom: 8, background: '#fff', overflow: 'hidden' }}>
            <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))} aria-expanded={isOpen}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', border: 'none', background: isOpen ? '#faf6ee' : '#fff', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              <span style={{ fontSize: 15 }}>{KIND_ICON[g.kind] || '⭐'}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
              <span style={{ fontSize: 11, color: '#8a7a65' }}>{g.members.length}</span>
              <span style={{ fontSize: 10, color: '#8a7a65' }}>{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
              <div style={{ padding: '4px 8px 8px' }}>
                {g.members.length === 0 && <div style={{ fontSize: 11, color: '#aaa', padding: '6px 2px' }}>No one here yet.</div>}
                {g.members.map((m) => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button type="button" onClick={() => onOpen(m, g.name)} title={`Open ${m.display_name}'s family tree`}
                      style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: 8, fontFamily: 'inherit' }}>
                      <Avatar p={m} size={28} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.display_name}</span>
                      {m.status === 'pending' && <span title="Waiting for them to accept" style={{ fontSize: 9, color: '#8a5a10', background: '#fff8e1', border: '1px solid #f1dc9a', borderRadius: 10, padding: '1px 6px', flexShrink: 0 }}>⏳ waiting</span>}
                    </button>
                    {!m.is_claimed && ownerId && m.owner_user_id === ownerId && (
                      <button type="button" onClick={() => onInvite(m)} title={`Invite ${m.display_name} (temporary login by WhatsApp / SMS)`} aria-label={`Invite ${m.display_name}`}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, padding: '4px 5px' }}>📤</button>
                    )}
                    <button type="button" onClick={() => removeMember(g, m)} title={`Remove ${m.display_name} from this group`} aria-label={`Remove ${m.display_name}`}
                      style={{ border: 'none', background: 'none', color: '#b0a088', cursor: 'pointer', fontSize: 13, padding: '4px 6px' }}>✕</button>
                  </div>
                ))}
                <button type="button" onClick={() => toggleShare(g)} disabled={busy} aria-pressed={g.visibility === 'family'}
                  title="When this is on, your relatives can find these people by searching, and see the path through you"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', margin: '6px 0 2px', padding: '6px 8px', borderRadius: 10, border: '1px solid #ece0c6', background: g.visibility === 'family' ? '#eef7ea' : '#faf7f2', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: g.visibility === 'family' ? '#3f7a2f' : '#8a7a65', fontFamily: 'inherit', textAlign: 'left' }}>
                  <span>{g.visibility === 'family' ? '👨‍👩‍👧 Shared with my family' : '🔒 Only I can see this'}</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 500, textDecoration: 'underline' }}>{g.visibility === 'family' ? 'Make private' : 'Share'}</span>
                </button>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  <button type="button" onClick={() => setAdding(g.id)} style={smallPill(true)}>＋ Add people</button>
                  {!g.is_default && <button type="button" onClick={() => rename(g)} style={smallPill(false)}>Rename</button>}
                  {!g.is_default && <button type="button" onClick={() => del(g)} style={{ ...smallPill(false), color: '#b3261e' }}>Delete</button>}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {addingGroup && <AddMemberModal group={addingGroup} homeId={homeId} members={addingGroup.members} onClose={() => setAdding(null)} onChange={onChange} />}
    </div>
  );
}


// ================= HEADER SEARCH RESULTS =================
function SearchPanel({ q, homeId, onPick, onClose }) {
  const [rows, setRows] = useState(null);   // null = loading
  const term = q.trim();
  useEffect(() => {
    if (term.length < 2) { setRows([]); return undefined; }
    let dead = false;
    setRows(null);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${API_URL}/api/search?q=${encodeURIComponent(term)}&home_id=${encodeURIComponent(homeId)}`);
        const j = await r.json();
        if (!dead) setRows(j.success ? j.data : []);
      } catch { if (!dead) setRows([]); }
    }, 300);
    return () => { dead = true; clearTimeout(t); };
  }, [term, homeId]);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  if (term.length < 2) return null;

  const how = (r) => {
    const names = r.path.slice(0, -1).map((x) => x.p.display_name.split(' ')[0]);
    if (r.kind === 'member') return 'Member · view profile';
    if (r.kind === 'group' && r.path.length <= 1) return `${r.owner ? `${r.owner}'s` : 'Your'} group · ${r.group}`;
    return r.path.map((x) => x.rel).join(' › ') + (names.length ? ` (via ${names.join(' › ')})` : '');
  };
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'transparent' }} />
      <div className="search-panel" role="listbox" style={{ position: 'fixed', zIndex: 9001, left: '50%', transform: 'translateX(-50%)', width: 'min(560px, 94vw)', maxHeight: '60vh', overflowY: 'auto', background: '#fff', border: '1px solid #e9e2d6', borderRadius: 14, boxShadow: '0 10px 30px rgba(0,0,0,.18)', padding: 6 }}>
        <style>{`.search-panel{ top: 58px; } @media(max-width: 900px){ .search-panel{ top: 128px; } }`}</style>
        {rows === null && <div style={{ padding: 12, fontSize: 12, color: '#8a7a65' }}>Searching...</div>}
        {rows && rows.length === 0 && <div style={{ padding: 12, fontSize: 12, color: '#8a7a65' }}>Nobody found.</div>}
        {rows && rows.map((r) => (
          <button key={r.person.id} type="button" onClick={() => onPick(r)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: 'none', background: 'none', borderRadius: 10, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
            <Avatar p={r.person} size={36} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.person.display_name}</span>
              <span style={{ display: 'block', fontSize: 11, color: '#8a7a5c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{how(r)}</span>
            </span>
            <span style={{ fontSize: 10, color: '#8a7a65', flexShrink: 0 }}>{r.kind === 'group' ? '👥' : r.kind === 'member' ? '👤' : '🌳'}</span>
          </button>
        ))}
      </div>
    </>
  );
}

// ================= REQUESTS: "X added you ... Accept / Reject" =================
// ================= LANGUAGE (English / Malayalam / Hindi) =================
// Covers the words on this page. Other pages follow later. Malayalam and Hindi wording is a first draft for a native speaker to check.
const LANGS = [['en', 'English'], ['ml', 'മലയാളം'], ['hi', 'हिन्दी']];
const STR = {
  en: { changeCover: 'Change cover photo', newsCredit: 'Headlines from', newsOpen: 'Tap a headline to read it on the publisher\'s site.', newsLoading: 'Loading headlines…', newsDown: 'News is not available right now.', newsOld: 'Showing the last headlines we got.', edit: 'Edit', save: 'Save', cancel: 'Cancel', saving: 'Saving…', changePhoto: 'Change photo', waiting: 'Waiting for you', nothing: 'Nothing is waiting for you right now', waitingN: 'waiting for you', myGroups: 'My groups', newsT: 'News corner', bio: 'BIO', noBio: 'Add a few lines about yourself', male: 'Male', female: 'Female', pub: 'Public', priv: 'Private', saveFail: 'Could not save', points: 'POINTS', cards: 'CARDS IN DECK', card: 'CARD IN DECK', family: 'FAMILY MEMBERS', groups: 'GROUPS', openChats: 'Open chats', editProfile: 'Edit profile', about: 'ABOUT', userId: 'USER ID', name: 'NAME', nick: 'NICK NAME', visibility: 'VISIBILITY', gender: 'GENDER', born: 'BORN', status: 'STATUS', location: 'LOCATION', living: 'Living', passed: 'Passed away', photos: 'Photos and videos', news: 'News corner', scrap: 'Scrap wall', soon: 'coming soon', hidden: 'Hidden', language: 'Language', member: 'Member of ClanDeck', added: 'Added by a relative or friend', publicNote: 'Everyone can see cards and points' },
  ml: { changeCover: 'കവർ ഫോട്ടോ മാറ്റുക', newsCredit: 'തലക്കെട്ടുകൾ:', newsOpen: 'പ്രസാധകരുടെ സൈറ്റിൽ വായിക്കാൻ തലക്കെട്ടിൽ തൊടുക.', newsLoading: 'തലക്കെട്ടുകൾ ലോഡ് ചെയ്യുന്നു…', newsDown: 'ഇപ്പോൾ വാർത്ത ലഭ്യമല്ല.', newsOld: 'അവസാനം ലഭിച്ച തലക്കെട്ടുകൾ കാണിക്കുന്നു.', edit: 'തിരുത്തുക', save: 'സേവ്', cancel: 'റദ്ദാക്കുക', saving: 'സേവ് ചെയ്യുന്നു…', changePhoto: 'ഫോട്ടോ മാറ്റുക', waiting: 'നിങ്ങളെ കാത്തിരിക്കുന്നത്', nothing: 'ഇപ്പോൾ ഒന്നും കാത്തിരിക്കുന്നില്ല', waitingN: 'നിങ്ങളെ കാത്തിരിക്കുന്നു', myGroups: 'എന്റെ ഗ്രൂപ്പുകൾ', newsT: 'വാർത്താ കോർണർ', bio: 'ചെറുവിവരണം', noBio: 'നിങ്ങളെക്കുറിച്ച് ചില വരികൾ ചേർക്കുക', male: 'പുരുഷൻ', female: 'സ്ത്രീ', pub: 'പൊതു', priv: 'സ്വകാര്യം', saveFail: 'സേവ് ചെയ്യാനായില്ല', points: 'പോയിന്റ്', cards: 'ഡെക്കിലെ കാർഡുകൾ', card: 'ഡെക്കിലെ കാർഡ്', family: 'കുടുംബാംഗങ്ങൾ', groups: 'ഗ്രൂപ്പുകൾ', openChats: 'ചാറ്റുകൾ തുറക്കുക', editProfile: 'പ്രൊഫൈൽ എഡിറ്റ്', about: 'വിവരങ്ങൾ', userId: 'യൂസർ ഐഡി', name: 'പേര്', nick: 'വിളിപ്പേര്', visibility: 'ദൃശ്യത', gender: 'ലിംഗം', born: 'ജനനം', status: 'നില', location: 'സ്ഥലം', living: 'ജീവിച്ചിരിക്കുന്നു', passed: 'മരണമടഞ്ഞു', photos: 'ഫോട്ടോകളും വീഡിയോകളും', news: 'വാർത്താ കോർണർ', scrap: 'സ്ക്രാപ്പ് ഭിത്തി', soon: 'ഉടൻ വരുന്നു', hidden: 'മറച്ചിരിക്കുന്നു', language: 'ഭാഷ', member: 'ക്ലാൻഡെക്ക് അംഗം', added: 'ബന്ധുവോ സുഹൃത്തോ ചേർത്തത്', publicNote: 'കാർഡുകളും പോയിന്റും എല്ലാവർക്കും കാണാം' },
  hi: { changeCover: 'कवर फ़ोटो बदलें', newsCredit: 'सुर्खियाँ:', newsOpen: 'प्रकाशक की साइट पर पढ़ने के लिए सुर्खी पर टैप करें।', newsLoading: 'सुर्खियाँ लोड हो रही हैं…', newsDown: 'अभी समाचार उपलब्ध नहीं है।', newsOld: 'पिछली मिली सुर्खियाँ दिखा रहे हैं।', edit: 'बदलें', save: 'सहेजें', cancel: 'रद्द करें', saving: 'सहेज रहे हैं…', changePhoto: 'फ़ोटो बदलें', waiting: 'आपका इंतज़ार', nothing: 'अभी आपका कुछ इंतज़ार नहीं कर रहा', waitingN: 'आपका इंतज़ार कर रहे हैं', myGroups: 'मेरे ग्रुप', newsT: 'समाचार कोना', bio: 'संक्षिप्त परिचय', noBio: 'अपने बारे में कुछ पंक्तियाँ जोड़ें', male: 'पुरुष', female: 'महिला', pub: 'सार्वजनिक', priv: 'निजी', saveFail: 'सहेज नहीं सके', points: 'पॉइंट', cards: 'डेक में कार्ड', card: 'डेक में कार्ड', family: 'परिवार के सदस्य', groups: 'ग्रुप', openChats: 'चैट खोलें', editProfile: 'प्रोफ़ाइल बदलें', about: 'परिचय', userId: 'यूज़र आईडी', name: 'नाम', nick: 'उपनाम', visibility: 'दृश्यता', gender: 'लिंग', born: 'जन्म', status: 'स्थिति', location: 'स्थान', living: 'जीवित', passed: 'स्वर्गवासी', photos: 'फ़ोटो और वीडियो', news: 'समाचार कोना', scrap: 'स्क्रैप वॉल', soon: 'जल्द आ रहा है', hidden: 'छिपा हुआ', language: 'भाषा', member: 'क्लैनडेक सदस्य', added: 'रिश्तेदार या दोस्त ने जोड़ा', publicNote: 'कार्ड और पॉइंट सभी देख सकते हैं' },
};
function useLang() {
  const [lang, setLangState] = useState(() => { try { const v = localStorage.getItem('clandeck_lang'); return STR[v] ? v : 'en'; } catch { return 'en'; } });
  const setLang = (v) => { setLangState(v); try { localStorage.setItem('clandeck_lang', v); } catch { /* ignore */ } };
  return [lang, setLang, STR[lang]];
}

// ================= CARDS IN DECK + POINTS (public: everyone can see anyone's cards and points) =================
function usePoints(profileId) {
  const [d, setD] = useState(null);
  useEffect(() => {
    if (!profileId) return undefined;
    let dead = false;
    const load = () => fetch(`${API_URL}/api/points/${encodeURIComponent(profileId)}`).then((r) => r.json()).then((j) => { if (!dead) setD(j && j.success ? j : null); }).catch(() => {});
    setD(null);
    load();
    const t = setInterval(load, 60000);
    return () => { dead = true; clearInterval(t); };
  }, [profileId]);
  return d;
}
const fmtPoints = (n) => { const v = Math.round(Number(n || 0) * 100) / 100; return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, ''); };

// ================= EDIT IN PLACE (own profile only: a pen next to each field) =================
const PenIcon = ({ size = 14 }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
);
function EditableRow({ label, display, value, type = 'text', options, multiline, canEdit, onSave, T }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const start = () => { setDraft(value == null ? '' : String(value)); setErr(''); setEditing(true); };
  const save = async () => {
    setBusy(true); setErr('');
    try { await onSave(draft); setEditing(false); } catch (e) { setErr(`${T.saveFail}: ${e.message || ''}`); }
    setBusy(false);
  };
  const field = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', border: '1px solid #d8c5a3', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', background: '#fff' };
  const pen = canEdit && !editing && (
    <button type="button" onClick={start} aria-label={`${T.edit}: ${label}`} title={T.edit} style={{ border: 'none', background: 'transparent', color: '#8a7a5c', cursor: 'pointer', padding: 6, margin: '-6px -4px -6px 0', minWidth: 28, minHeight: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><PenIcon /></button>
  );
  if (!canEdit && !display) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#888', fontWeight: 500, fontSize: 11 }}>{label}</span>
        {!editing && !multiline && <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}><span style={{ fontWeight: 500, textAlign: 'right', wordBreak: 'break-word', fontSize: 11 }}>{display || <i style={{ color: '#bbb' }}>–</i>}</span>{pen}</span>}
        {!editing && multiline && pen}
      </div>
      {!editing && multiline && <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: '19px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{display || <i style={{ color: '#bbb' }}>{T.noBio}</i>}</p>}
      {editing && (
        <div style={{ marginTop: 6 }}>
          {multiline ? <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} maxLength={1000} style={{ ...field, resize: 'vertical' }} autoFocus />
            : options ? <select value={draft} onChange={(e) => setDraft(e.target.value)} style={field} autoFocus>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            : <input type={type} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} style={field} autoFocus />}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" disabled={busy} onClick={save} style={{ padding: '7px 16px', borderRadius: 20, border: 'none', background: '#111', color: '#fff', fontWeight: 600, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>{busy ? T.saving : T.save}</button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)} style={{ padding: '7px 16px', borderRadius: 20, border: '1px solid #d8c5a3', background: '#fff', color: '#111', fontWeight: 600, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>{T.cancel}</button>
          </div>
          {err && <p style={{ margin: '6px 0 0', fontSize: 11, color: '#b3261e' }}>{err}</p>}
        </div>
      )}
    </div>
  );
}

// the "Waiting for you" card: people who want to chat, join a group or be added as family
function WaitingCard({ notes, busyId, onAnswer, onOpen, T }) {
  const text = (n) => {
    const who = n.from ? n.from.display_name : 'Someone';
    if (n.kind === 'chat_request') return <><b>{who}</b> wants to chat with you</>;
    if (n.kind === 'group_add') return <><b>{who}</b> added you to the group <b>{n.group_name}</b></>;
    if (n.kind === 'family_add') return <><b>{who}</b> added you as {n.message ? <>{n.message}'s </> : 'their '}<b>{n.relation_type || 'relative'}</b></>;
    return <>{n.message}</>;
  };
  const btn = (bg, fg) => ({ flex: 1, minHeight: 36, padding: '7px 12px', borderRadius: 20, border: bg === '#fff' ? '1px solid #d8c5a3' : 'none', background: bg, color: fg, fontWeight: 600, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' });
  return (
    <div id="waiting-card" className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{T.waiting}</span>
        {notes.length > 0 && <span style={{ background: '#b3261e', color: '#fff', borderRadius: 999, minWidth: 20, height: 20, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>{notes.length}</span>}
      </div>
      {!notes.length && <p style={{ margin: 0, fontSize: 12, color: '#aaa' }}>{T.nothing}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {notes.map((n) => (
          <div key={n.id} style={{ padding: '10px 12px', background: n.kind === 'info' ? '#f3f7f1' : '#fff8e1', border: `1px solid ${n.kind === 'info' ? '#cfe3c8' : '#f1dc9a'}`, borderRadius: 12, fontSize: 12, minWidth: 0 }}>
            <div style={{ wordBreak: 'break-word', marginBottom: 8 }}>{n.kind === 'info' ? 'ℹ️ ' : '🔔 '}{text(n)}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {n.from && n.kind !== 'info' && <button type="button" onClick={() => onOpen(n.from)} style={btn('#fff', '#1a1a1a')}>View profile</button>}
              {n.kind === 'info'
                ? <button type="button" disabled={busyId === n.id} onClick={() => onAnswer(n, 'dismiss')} style={btn('#111', '#fff')}>OK</button>
                : <>
                    <button type="button" disabled={busyId === n.id} onClick={() => onAnswer(n, 'accept')} style={btn('#111', '#fff')}>Accept</button>
                    <button type="button" disabled={busyId === n.id} onClick={() => onAnswer(n, 'reject')} style={btn('#fff', '#b3261e')}>Reject</button>
                  </>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ================= NEWS CORNER: headlines from official feeds, read on the publisher's own site =================
function NewsCorner({ T }) {
  const [sources, setSources] = useState([]);
  const [sel, setSel] = useState(() => { try { return localStorage.getItem('clandeck_news_source') || ''; } catch { return ''; } });
  const [state, setState] = useState({ loading: true, items: [], error: '', stale: false, name: '' });
  useEffect(() => {
    let dead = false;
    fetch(`${API_URL}/api/news/sources`).then((r) => r.json()).then((j) => { if (!dead && j.success) setSources(j.data); }).catch(() => {});
    return () => { dead = true; };
  }, []);
  useEffect(() => {
    let dead = false;
    setState((s) => ({ ...s, loading: true, error: '' }));
    fetch(`${API_URL}/api/news?source=${encodeURIComponent(sel)}&limit=5`).then((r) => r.json()).then((j) => {
      if (dead) return;
      if (j.success) setState({ loading: false, items: j.data || [], error: '', stale: !!j.stale, name: j.source ? j.source.name : '' });
      else setState({ loading: false, items: [], error: j.error || T.newsDown, stale: false, name: j.source ? j.source.name : '' });
    }).catch(() => { if (!dead) setState({ loading: false, items: [], error: T.newsDown, stale: false, name: '' }); });
    return () => { dead = true; };
  }, [sel]); // eslint-disable-line
  const pick = (v) => { setSel(v); try { localStorage.setItem('clandeck_news_source', v); } catch { /* ignore */ } };
  const ago = (iso) => { if (!iso) return ''; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); if (!Number.isFinite(m) || m < 0) return ''; if (m < 60) return `${Math.max(m, 1)}m`; if (m < 1440) return `${Math.round(m / 60)}h`; return `${Math.round(m / 1440)}d`; };
  const current = sel || (sources[0] && sources[0].id) || '';
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{T.newsT}</div>
      {sources.length > 1 && (
        <select value={current} onChange={(e) => pick(e.target.value)} aria-label={T.newsT} style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #d8c5a3', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', background: '#fff', marginBottom: 8 }}>
          {sources.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      )}
      {state.loading && <p style={{ margin: 0, fontSize: 12, color: '#aaa' }}>{T.newsLoading}</p>}
      {!state.loading && state.error && <p style={{ margin: 0, fontSize: 12, color: '#b3261e' }}>{state.error}</p>}
      {!state.loading && !state.error && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {state.items.map((n, i) => (
            <a key={n.link + i} href={n.link} target="_blank" rel="noopener noreferrer" style={{ display: 'block', padding: '9px 0', borderTop: i ? '1px solid #f0e9dc' : 'none', color: '#1a1a1a', textDecoration: 'none' }}>
              <div style={{ fontWeight: 600, fontSize: 12, lineHeight: '17px', wordBreak: 'break-word' }}>{n.title}</div>
              {n.snippet && <div style={{ fontSize: 11, color: '#777', lineHeight: '16px', marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.snippet}</div>}
              {ago(n.published) && <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{ago(n.published)}</div>}
            </a>
          ))}
          <p style={{ margin: '8px 0 0', fontSize: 10, color: '#aaa', lineHeight: '14px' }}>{T.newsCredit} {state.name}. {T.newsOpen}{state.stale ? ` ${T.newsOld}` : ''}</p>
        </div>
      )}
    </div>
  );
}

// small helpers for a new profile photo: a square, centred crop at 600px, and the original shrunk to 1600px
const readAsDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the photo')); r.readAsDataURL(file); });
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file is not a picture')); i.src = src; });
const jpegOf = async (src, side, square, quality) => {
  const img = await loadImg(src);
  const c = document.createElement('canvas');
  let sx = 0, sy = 0, sw = img.width, sh = img.height, w, h;
  if (square) { const m = Math.min(img.width, img.height); sx = (img.width - m) / 2; sy = (img.height - m) / 2; sw = sh = m; w = h = Math.min(side, m); }
  else { const k = Math.min(1, side / Math.max(img.width, img.height)); w = Math.max(1, Math.round(img.width * k)); h = Math.max(1, Math.round(img.height * k)); }
  c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return c.toDataURL('image/jpeg', quality);
};
const coverJpegOf = async (src) => {           // wide banner crop from the middle of the picture
  const img = await loadImg(src);
  const W = Math.min(1600, img.width), H = Math.round(W * 0.25);
  let sw = img.width, sh = Math.round(img.width * 0.25);
  if (sh > img.height) { sh = img.height; sw = Math.round(img.height * 4); }
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, W, H);
  return c.toDataURL('image/jpeg', 0.82);
};
const dateOnlyStr = (v) => (v ? String(v).split('T')[0] : '');

// groups other people made and I accepted: they show up in my own profile
function JoinedGroups({ groups, onOpen }) {
  const [open, setOpen] = useState({});
  if (!groups.length) return null;
  return (
    <div className="card" style={{ marginTop: 16, padding: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Groups I'm in ({groups.length})</div>
      {groups.map((g) => (
        <div key={g.id} style={{ border: '1px solid #f0e0c0', borderRadius: 10, marginBottom: 8, background: '#fff', overflow: 'hidden' }}>
          <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
              {g.owner && <span style={{ display: 'block', fontSize: 10, color: '#8a7a65' }}>by {g.owner.display_name}</span>}
            </span>
            <span style={{ fontSize: 11, color: '#8a7a65' }}>{g.members.length + (g.owner ? 1 : 0)} {open[g.id] ? '▲' : '▼'}</span>
          </button>
          {open[g.id] && (
            <div style={{ padding: '2px 8px 8px' }}>
              {[g.owner, ...g.members].filter(Boolean).map((m, i) => (
                <button key={m.id} type="button" onClick={() => onOpen(m, g.name)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: 8, fontFamily: 'inherit' }}>
                  <Avatar p={m} size={26} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.display_name}</span>
                  {i === 0 && <span style={{ fontSize: 9, color: '#8a7a65' }}>owner</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ================= AD SLOTS =================
// Shows a labelled empty box until real ads are switched on. To go live, put these in the frontend .env.production
// (Google AdSense) and rebuild:  VITE_ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXXXXXX
//                                VITE_ADSENSE_SLOT_BANNER=<slot id of the thin banner>
//                                VITE_ADSENSE_SLOT_SQUARE=<slot id of the square ad>
// To hide the empty boxes until then, add  VITE_HIDE_AD_PLACEHOLDERS=1
// only real-looking AdSense values switch ads on (so example text like ca-pub-XXXX or ... is ignored)
const adClient = String(import.meta.env.VITE_ADSENSE_CLIENT || '').trim();
const adSlot = (v) => (/^\d{6,}$/.test(String(v || '').trim()) ? String(v).trim() : '');
const ADS = {
  client: /^ca-pub-\d{10,}$/.test(adClient) ? adClient : '',
  banner: adSlot(import.meta.env.VITE_ADSENSE_SLOT_BANNER),
  square: adSlot(import.meta.env.VITE_ADSENSE_SLOT_SQUARE),
  hidePlaceholder: import.meta.env.VITE_HIDE_AD_PLACEHOLDERS === '1',
};

function AdSlot({ kind, style }) {
  const slotId = ADS[kind];
  const live = !!(ADS.client && slotId);
  const isBanner = kind === 'banner';
  useEffect(() => {
    if (!live) return;
    try {
      if (!document.querySelector('script[data-clandeck-ads]')) {
        const sc = document.createElement('script');
        sc.async = true; sc.crossOrigin = 'anonymous'; sc.setAttribute('data-clandeck-ads', '1');
        sc.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADS.client}`;
        document.head.appendChild(sc);
      }
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch { /* ads must never break the page */ }
  }, [live]);
  if (!live && ADS.hidePlaceholder) return null;
  const box = isBanner ? { width: '100%', height: 'clamp(50px, 6vw, 80px)' } : { width: '100%', maxWidth: 300, aspectRatio: '1 / 1' };
  return (
    <div aria-label="Advertisement" style={{ ...box, boxSizing: 'border-box', overflow: 'hidden', borderRadius: 14, border: live ? 'none' : '1px dashed #d8c5a3', background: live ? 'transparent' : '#fffefb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', ...style }}>
      {live ? (
        <ins className="adsbygoogle" style={{ display: 'block', width: '100%', height: '100%' }} data-ad-client={ADS.client} data-ad-slot={slotId} data-ad-format={isBanner ? 'horizontal' : 'rectangle'} data-full-width-responsive={isBanner ? 'true' : 'false'} />
      ) : (
        <>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, color: '#b8a98a' }}>ADVERTISEMENT</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#c9bb9d', marginTop: 2 }}>{isBanner ? 'Banner ad space' : 'Square ad space'}</span>
        </>
      )}
    </div>
  );
}

// ================= DECK PAGE =================

const fmtDate = (d) => {
  if (!d) return '';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? String(d).slice(0, 10) : t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function Deck({ onGoProfile, onLogout, onGoNotifications }) {
  const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
  const [family, setFamily] = useState([]);
  const [groups, setGroups] = useState([]);
  const [privacy, setPrivacy] = useState({});
  const [showChat, setShowChat] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);          // unread chat messages (badge on the 💬 button)
  useEffect(() => {
    const token = (() => { try { return localStorage.getItem('token') || ''; } catch { return ''; } })();
    if (!token) return undefined;
    const check = () => fetch(`${API_URL}/api/chat/unread`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()).then((j) => { if (j && j.success) setChatUnread(j.total); }).catch(() => {});
    check();
    const t = setInterval(check, 60000);
    // keeping one live link open while the Deck is open also shows this person as "Online" to others, and updates the badge at once
    let es = null;
    if (typeof EventSource !== 'undefined') {
      es = new EventSource(`${API_URL}/api/chat/stream?token=${encodeURIComponent(token)}`);
      es.addEventListener('message', check);
    }
    return () => { clearInterval(t); if (es) es.close(); };
  }, []);
  const [groupInvite, setGroupInvite] = useState(null);    // invite pop-up for a friend from My Groups
  const [notes, setNotes] = useState([]);                 // requests waiting for my Accept / Reject
  const [noteBusy, setNoteBusy] = useState('');
  const [joined, setJoined] = useState([]);               // groups made by others that I accepted
  const [viewing, setViewing] = useState(null);           // a member opened from search: view-only profile
  const [viewInfo, setViewInfo] = useState(null);         // that member's full public details
  useEffect(() => {
    setViewInfo(null);
    if (!viewing) return undefined;
    let dead = false;
    fetch(`${API_URL}/api/profiles/public/${encodeURIComponent(viewing.id)}?home_id=${encodeURIComponent(storedUser.id || storedUser.uname || '')}`)
      .then((r) => r.json()).then((j) => { if (!dead) setViewInfo(j.success ? j.data : { error: j.error || 'Could not load profile' }); })
      .catch(() => { if (!dead) setViewInfo({ error: 'Could not load profile' }); });
    return () => { dead = true; };
  }, [viewing]); // eslint-disable-line
  const [openReq, setOpenReq] = useState(null);
  const [searchQ, setSearchQ] = useState('');             // what is typed in the header search box
  const [searchOpen, setSearchOpen] = useState(true);       // results panel shown (closes after a pick, opens again when you type)          // a group member was clicked -> show their tree
  const [tempLogin, setTempLogin] = useState(false);   // still on a temporary password?
  const [photoUrl, setPhotoUrl] = useState(localStorage.getItem('photo_url') || '');
  const [pos, setPos] = useState(JSON.parse(localStorage.getItem('clandeck_photo_pos') || '{"x":50,"y":50,"zoom":100}'));
  const [profileInfo, setProfileInfo] = useState({
    nickname: localStorage.getItem('profile_nickname') || '',
    visibility: String(localStorage.getItem('profile_visibility') || 'public').toLowerCase()
  });
  const [lang, setLang, T] = useLang();
  const selfId = storedUser?.id || storedUser?.uname || '';
  const pts = usePoints(viewing ? viewing.id : selfId);
  const [selfInfo, setSelfInfo] = useState(null);            // my own public details (bio, born, place)
  useEffect(() => {
    if (!selfId) return undefined;
    let dead = false;
    fetch(`${API_URL}/api/profiles/public/${encodeURIComponent(selfId)}?home_id=${encodeURIComponent(selfId)}`)
      .then((r) => r.json()).then((j) => { if (!dead && j && j.success) setSelfInfo(j.data); }).catch(() => {});
    return () => { dead = true; };
  }, [selfId]);
  const [photoBusy, setPhotoBusy] = useState('');
  const [coverVer, setCoverVer] = useState('');
  const [coverOk, setCoverOk] = useState(true);
  useEffect(() => { setCoverOk(true); }, [viewing ? viewing.id : selfId]); // eslint-disable-line
  const changeCover = async (file) => {
    if (!file) return;
    setPhotoBusy('Uploading…');
    try {
      const src = await readAsDataUrl(file);
      const compressed = await coverJpegOf(src);
      const pr = await fetch(`${API_URL}/api/profile/${encodeURIComponent(selfId)}/photo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'cover', compressed }) }).then((r) => r.json());
      if (!pr || !pr.success) throw new Error((pr && pr.error) || 'Photo upload failed');
      setCoverOk(true); setCoverVer(String(Date.now())); setPhotoBusy('');
    } catch (e) { setPhotoBusy(`${T.saveFail}: ${e.message}`); setTimeout(() => setPhotoBusy(''), 4000); }
  };
  // save one or more of MY fields: fetch my full record first so the other fields (dates etc.) are kept as they are
  const saveSelf = async (changes) => {
    const g = await fetch(`${API_URL}/api/profile/${encodeURIComponent(selfId)}`).then((r) => r.json());
    if (!g || !g.success) throw new Error((g && g.error) || 'Could not load your profile');
    const q = g.data;
    const payload = {
      display_name: q.display_name, nickname: q.nickname || '', gender: q.gender, dob: dateOnlyStr(q.dob) || null,
      email: q.email, mobile: q.mobile_number, mobile_number: q.mobile_number, visibility: q.visibility || 'Public',
      show_in_deck: q.show_in_deck, is_alive: q.is_alive, dod: dateOnlyStr(q.dod) || null,
      location: q.location || '', bio: q.bio || '', ...changes,
    };
    const r = await fetch(`${API_URL}/api/profile/${encodeURIComponent(selfId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await r.json();
    if (!j || !j.success) throw new Error((j && j.error) || 'Save failed');
    // keep this page and the other pages in step
    setSelfInfo((prev) => ({ ...(prev || {}), ...payload, dob: payload.dob, bio: payload.bio, location: payload.location }));
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      if (changes.display_name) { u.name = changes.display_name; localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('profile_name', changes.display_name); }
      if (changes.photo_url) { u.photo_url = changes.photo_url; localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('photo_url', changes.photo_url); }
      if ('nickname' in changes) localStorage.setItem('profile_nickname', changes.nickname || '');
      if (changes.visibility) localStorage.setItem('profile_visibility', String(changes.visibility).toLowerCase());
    } catch { /* ignore */ }
    if ('nickname' in changes || changes.visibility) setProfileInfo((prev) => ({ ...prev, ...('nickname' in changes ? { nickname: changes.nickname || '' } : {}), ...(changes.visibility ? { visibility: String(changes.visibility).toLowerCase() } : {}) }));
    return payload;
  };
  const changePhoto = async (file) => {
    if (!file) return;
    setPhotoBusy('Uploading…');
    try {
      const src = await readAsDataUrl(file);
      const compressed = await jpegOf(src, 600, true, 0.8);
      const original = await jpegOf(src, 1600, false, 0.9);
      const pr = await fetch(`${API_URL}/api/profile/${encodeURIComponent(selfId)}/photo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ compressed, original }) }).then((r) => r.json());
      if (!pr || !pr.success) throw new Error((pr && pr.error) || 'Photo upload failed');
      await saveSelf({ photo_url: pr.compressed_url, photo_original_url: pr.original_url || null, photo_compressed_url: pr.compressed_url, photo_bucket_key: pr.bucket_key || null, photo_x: 0, photo_y: 0, photo_zoom: 1 });
      setPhotoUrl(pr.compressed_url);
      const np = { x: 50, y: 50, zoom: 100 }; setPos(np);
      try { localStorage.setItem('clandeck_photo_pos', JSON.stringify(np)); } catch { /* ignore */ }
      setPhotoBusy('');
    } catch (e) { setPhotoBusy(`${T.saveFail}: ${e.message}`); setTimeout(() => setPhotoBusy(''), 4000); }
  };

  const loadGroups = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/groups?home_id=${encodeURIComponent(storedUser.id || storedUser.uname || '')}`);
      const j = await r.json();
      if (j.success) setGroups(j.data);
    } catch { /* groups stay empty; the rest of the page still works */ }
  }, []); // eslint-disable-line
  useEffect(() => { loadGroups(); }, [loadGroups]);

  // "View profile" on the Notification wall page sends the person here
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('clandeck_open_profile');
      if (raw) { sessionStorage.removeItem('clandeck_open_profile'); setViewing({ ...JSON.parse(raw), way: '' }); }
    } catch { /* ignore */ }
  }, []);

  const loadNotes = useCallback(async () => {
    const home = encodeURIComponent(storedUser.id || storedUser.uname || '');
    try {
      const [a, b] = await Promise.all([fetch(`${API_URL}/api/notifications?home_id=${home}`).then((r) => r.json()), fetch(`${API_URL}/api/groups/joined?home_id=${home}`).then((r) => r.json())]);
      if (a.success) setNotes(a.data);
      if (b.success) setJoined(b.data);
    } catch { /* offline: try again on the next tick */ }
  }, []); // eslint-disable-line
  useEffect(() => {
    loadNotes();
    const t = setInterval(loadNotes, 60000);
    const onVis = () => { if (document.visibilityState === 'visible') loadNotes(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [loadNotes]);
  const answerNote = async (n, action) => {
    setNoteBusy(n.id);
    try {
      await fetch(`${API_URL}/api/notifications/${n.id}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ home_id: storedUser.id || storedUser.uname, action }) });
    } catch { /* the list below is refreshed either way */ }
    setNoteBusy('');
    await loadNotes();
  };

  useEffect(() => {
    const safeParse = (key) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(p => p && !p.photo_url?.startsWith('blob:') && !p.photo?.startsWith('blob:'));
      } catch { return []; }
    };
    
    try { 
      const p = JSON.parse(localStorage.getItem('clandeck_privacy') || '{}');
      setPrivacy(p);
      // If visibility is private, override
      const vis = String(localStorage.getItem('profile_visibility') || 'public').toLowerCase();
      if (vis === 'private') setPrivacy(prev => ({...prev, showName: false}));
    } catch { setPrivacy({}); }

    setPhotoUrl(localStorage.getItem('photo_url') || '');
    try { setPos(JSON.parse(localStorage.getItem('clandeck_photo_pos') || '{"x":50,"y":50,"zoom":100}')); } catch { setPos({x:50,y:50,zoom:100}); }

    setProfileInfo({
      nickname: localStorage.getItem('profile_nickname') || '',
      visibility: String(localStorage.getItem('profile_visibility') || 'public').toLowerCase()
    });

    const userId = storedUser?.id || storedUser?.uname || 'self';
    fetch(`${API_URL}/api/account/status/${encodeURIComponent(userId)}`).then(r => r.json()).then(j => setTempLogin(!!(j && j.is_temp))).catch(() => {});
    fetch(`${API_URL}/api/family?user_id=${userId}`)
      .then(r => r.json())
      .then(j => {
        if (j?.success && j?.data?.length) {
          const clean = j.data.filter(p => p && !p.photo_url?.startsWith('blob:') && !p.photo_url?.startsWith('data:'));
          console.log('Loaded from MySQL profiles:', clean.length);
          setFamily(clean);
          localStorage.setItem('clandeck_family', JSON.stringify(clean));
        } else {
          setFamily(safeParse('clandeck_family'));
        }
      })
      .catch(() => setFamily(safeParse('clandeck_family')));

    fetch(`${API_URL}/api/profile/${userId}`)
      .then(r => r.json())
      .then(j => {
        if (j?.data?.photo_url && !j.data.photo_url.startsWith('blob:')) {
          setPhotoUrl(j.data.photo_url);
          localStorage.setItem('photo_url', j.data.photo_url);
        }
        if (j?.data?.photo_pos) {
          try {
            const savedPos = typeof j.data.photo_pos === 'string' ? JSON.parse(j.data.photo_pos) : j.data.photo_pos;
            setPos(savedPos);
            localStorage.setItem('clandeck_photo_pos', JSON.stringify(savedPos));
          } catch {}
        }
        if (j?.data) {
          if (j.data.nickname) {
            localStorage.setItem('profile_nickname', j.data.nickname);
            setProfileInfo(prev => ({...prev, nickname: j.data.nickname}));
          }
          if (j.data.visibility) {
            const visNow = String(j.data.visibility).toLowerCase();
            localStorage.setItem('profile_visibility', visNow);
            setProfileInfo(prev => ({...prev, visibility: visNow}));
            if (visNow === 'private') setPrivacy(prev => ({...prev, showName: false}));
          }
        }
      })
      .catch(() => {});
  }, []);

  const visibleFamily = (family || []).filter(f => {
    if (!f) return false;
    if (f.photo_url?.startsWith('blob:') || f.photo?.startsWith('blob:')) return false;
    if (f.id === storedUser?.id) return false;
    if (f.id === storedUser?.uname) return false;
    if ((f.display_name || f.name || '').trim().toLowerCase() === (storedUser?.name || '').trim().toLowerCase()) return false;
    const v = f.show_in_deck ?? f.visible ?? 1;
    return v !== false && v !== 0 && v !== '0' && v !== null;
  });

  const getName = () => storedUser?.name || localStorage.getItem('profile_name') || storedUser?.display_name || 'User';
  const isPublic = profileInfo.visibility === 'public' && privacy.showName !== false;

  return (
    <div className="pg-font" style={{minHeight:'100vh', background:'#f7f4ef', width:'100%', maxWidth:'100%', overflowX:'hidden', boxSizing:'border-box'}}>
      <style>{`
        .pg-font :not(header):not(header *) { font-family: Arial, Helvetica, sans-serif; }
        .deck-grid > * { min-width: 0; }
        .deck-grid { display: grid; grid-template-columns: 300px minmax(0, 1fr) 300px; gap: 16px; width: 100%; padding: 16px 20px; box-sizing: border-box; }
        .waiting-jump { display: none; }
        @media(max-width: 1100px){ .waiting-jump { display: block; } }
        .card { background: #fffefb; border: 1px solid #e9e2d6; border-radius: 14px; padding: 18px; }
        .deck-hero .hero-text, .deck-hero .hero-btns { padding-top: 52px; }
        @media(max-width: 700px){
          .deck-hero .hero-text, .deck-hero .hero-btns { padding-top: 0 !important; flex: 1 1 100% !important; }
          .deck-hero .lang-btn { padding: 0 9px !important; font-size: 11px !important; height: 28px !important; }
        }
        @media(max-width: 1100px){ .deck-grid { grid-template-columns: 260px minmax(0, 1fr); } }
        @media(max-width: 700px){ .deck-grid { grid-template-columns: minmax(0, 1fr); padding: 12px; } .deck-grid .ad-square { margin-left: auto; margin-right: auto; } }
      `}</style>

      <CommonHeader self={storedUser} page="deck" onDeck={()=>{}} onProfile={onGoProfile} onNotifications={onGoNotifications} onLogout={onLogout} onSearch={(v) => { setSearchQ(v); setSearchOpen(true); }} />
      {groupInvite && <InviteModal invite={groupInvite} setInvite={setGroupInvite} home={{ id: storedUser?.id || storedUser?.uname, display_name: storedUser?.name || storedUser?.Name || '' }} />}
      {searchOpen && <SearchPanel q={searchQ} homeId={storedUser?.id || storedUser?.uname} onClose={() => setSearchOpen(false)}
        onPick={(r) => {
          setSearchOpen(false);
          // every search result opens that person's profile (view only); the path from me is shown above it
          const way = r.kind === 'member' ? '' : ['You', ...r.path.map((x) => `${x.rel ? x.rel + ': ' : ''}${x.p.display_name}`)].join(' › ');
          // people connected to me: the line view starts from ME and follows the path (Me > Sanu > Meenu > Meenu's father)
          const connected = r.kind !== 'member';
          if (connected) setOpenReq({ n: Date.now(), path: r.path });
          setViewing({ ...r.person, way, inMyTree: connected });
          window.scrollTo({ top: 0 });
        }} />}

      {viewing && (
        <div style={{margin:'12px 20px 0', padding:'10px 14px', background:'#eef4ff', border:'1px solid #c9daf8', borderRadius:'12px', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap', fontSize:'13px'}}>
          <span style={{flex:1, minWidth:0}}>👁 You are viewing <b>{viewing.display_name}</b>'s profile (view only){viewing.way && !viewing.inMyTree && <span style={{display:'block', fontSize:'11px', color:'#5a6b8a', marginTop:2, wordBreak:'break-word'}}>{viewing.way}</span>}</span>
          <button type="button" onClick={() => setViewing(null)} style={{padding:'8px 16px', borderRadius:'20px', border:'none', background:'#111', color:'white', fontWeight: 500, fontSize:'11px', cursor:'pointer'}}>← Back to my deck</button>
        </div>
      )}

      {!viewing && notes.length > 0 && <button type="button" className="waiting-jump" onClick={() => { const el = document.getElementById('waiting-card'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} style={{margin:'12px 20px 0', width:'calc(100% - 40px)', textAlign:'left', padding:'10px 14px', background:'#fff8e1', border:'1px solid #f1dc9a', borderRadius:12, fontSize:13, fontFamily:'inherit', cursor:'pointer'}}>🔔 <b>{notes.length}</b> {T.waitingN}</button>}

      {!viewing && tempLogin && (
        <div style={{margin:'12px 20px 0', padding:'10px 14px', background:'#fff8e1', border:'1px solid #f1dc9a', borderRadius:'12px', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap', fontSize:'13px'}}>
          <span style={{flex:1, minWidth:200}}>🔑 You are using a <b>temporary login</b>. Please set your own username and password in Profile Edit.</span>
          <button onClick={onGoProfile} style={{padding:'8px 16px', borderRadius:'20px', border:'none', background:'#111', color:'white', fontWeight: 500, fontSize:'11px', cursor:'pointer'}}>Set now</button>
        </div>
      )}

      {(() => {
        const info = viewing ? viewInfo : selfInfo;
        const shownName = viewing ? viewing.display_name : (isPublic ? getName() : T.hidden);
        const nick = viewing ? viewing.nickname : (isPublic ? profileInfo.nickname : '');
        const photo = viewing ? ((viewInfo && viewInfo.photo_url) || viewing.photo_url) : photoUrl;
        const sub = viewing ? (viewInfo && viewInfo.uname ? `@${viewInfo.uname}` : (viewing.is_claimed ? T.member : T.added)) : (privacy.showUsername !== false ? `@${storedUser?.uname || 'user'}` : '');
        const place = info && info.location ? info.location : '';
        const pill = (v, label, bg) => (
          <span key={label} style={{background:bg, borderRadius:'999px', padding:'6px 14px', fontSize:'12px', fontWeight:600, whiteSpace:'nowrap'}}><b style={{fontSize:'14px'}}>{v}</b> <span style={{color:'#6b6358', letterSpacing:'.5px', fontSize:'10px'}}>{label}</span></span>
        );
        return (
          <section className="deck-hero" style={{margin:'12px 20px 0', background:'#fffefb', border:'1px solid #e9e2d6', borderRadius:'18px', overflow:'hidden', position:'relative'}}>
            <div style={{height:'96px', background:'#eadcc0', position:'relative', overflow:'hidden'}}>
              {coverOk && <img key={(viewing ? viewing.id : selfId) + coverVer} src={`${API_URL}/api/photos/${encodeURIComponent(viewing ? viewing.id : selfId)}/cover.jpg${coverVer ? `?v=${coverVer}` : ''}`} alt="" onError={() => setCoverOk(false)} style={{position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover'}} />}
              {!viewing && (
                <label title={T.changeCover} aria-label={T.changeCover} style={{position:'absolute', right:'12px', top:'12px', width:'34px', height:'34px', borderRadius:'50%', background:'#fff', border:'1px solid #d8c5a3', color:'#1f1a14', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 1px 4px rgba(0,0,0,.15)'}}>
                  <PenIcon size={16} />
                  <input type="file" accept="image/*" onChange={(e) => { changeCover(e.target.files && e.target.files[0]); e.target.value = ''; }} style={{display:'none'}} />
                </label>
              )}
            </div>
            <div style={{padding:'0 20px 18px', display:'flex', flexWrap:'wrap', gap:'16px', alignItems:'flex-end', marginTop:'-48px'}}>
              <div style={{width:'112px', height:'112px', background:'#c9ad83', color:'white', borderRadius:'22px', border:'4px solid #fff', boxSizing:'border-box', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'42px', fontWeight:600, overflow:'hidden', flexShrink:0}}>
                {photo
                  ? (viewing
                    ? <img src={photo} alt={shownName} style={{width:'100%', height:'100%', objectFit:'cover'}} />
                    : <img src={photo} alt="profile" style={{width:'100%', height:'100%', objectFit:'cover', objectPosition:`${pos.x}% ${pos.y}%`, transform:`scale(${pos.zoom/100})`}} onError={() => setPhotoUrl('')} />)
                  : (shownName || '?')[0].toUpperCase()}
              </div>
              {!viewing && (
                <label title={T.changePhoto} aria-label={T.changePhoto} style={{position:'absolute', left:'104px', top:'132px', width:'34px', height:'34px', borderRadius:'50%', background:'#fff', border:'1px solid #d8c5a3', color:'#1f1a14', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 1px 4px rgba(0,0,0,.15)'}}>
                  <PenIcon size={16} />
                  <input type="file" accept="image/*" onChange={(e) => { changePhoto(e.target.files && e.target.files[0]); e.target.value = ''; }} style={{display:'none'}} />
                </label>
              )}
              {photoBusy && <span role="status" style={{position:'absolute', left:'20px', top:'12px', background:'#fff8e1', border:'1px solid #f1dc9a', borderRadius:12, padding:'4px 10px', fontSize:11}}>{photoBusy}</span>}
              <div className="hero-text" style={{flex:'1 1 260px', minWidth:0}}>
                <h1 style={{margin:0, fontWeight:600, fontSize:'22px', lineHeight:'28px', wordBreak:'break-word'}}>{shownName}{nick && <span style={{fontWeight:400, fontSize:'13px', color:'#888'}}> ({nick})</span>}</h1>
                <p style={{margin:'2px 0 10px', fontSize:'12px', color:'#888', fontWeight:500}}>{[sub, place].filter(Boolean).join('  ·  ')}</p>
                <div style={{display:'flex', flexWrap:'wrap', gap:'8px'}}>
                  {pill(pts ? fmtPoints(pts.points) : '–', T.points, '#fdebc4')}
                  {pill(pts ? pts.cards : '–', pts && pts.cards === 1 ? T.card : T.cards, '#fdebc4')}
                  {!viewing && pill(visibleFamily.length + 1, T.family, '#f3ead8')}
                  {!viewing && pill(groups.length, T.groups, '#f3ead8')}
                </div>
              </div>
              <div className="hero-btns" style={{display:'flex', alignItems:'center'}}>
                <div role="group" aria-label={T.language} style={{display:'flex', background:'#f3ead8', borderRadius:'999px', padding:'3px', gap:'2px'}}>
                  {LANGS.map(([code, label]) => (
                    <button key={code} className="lang-btn" type="button" onClick={() => setLang(code)} aria-pressed={lang === code} style={{height:'34px', padding:'0 14px', borderRadius:'999px', border:'none', cursor:'pointer', background: lang === code ? '#1f1a14' : 'transparent', color: lang === code ? '#fff' : '#1f1a14', fontWeight:700, fontSize:'12px', fontFamily:'inherit'}}>{label}</button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        );
      })()}

      <div className="deck-grid">
        <div>
          <div className="card">
            <div style={{fontSize:'11px', fontWeight:600, color:'#888', letterSpacing:'1px', marginBottom:8}}>{T.about}{viewing ? ` ${viewing.display_name.split(' ')[0].toUpperCase()}` : ''}</div>
            {(() => {
              const me = !viewing;
              const info = me ? selfInfo : viewInfo;
              const sv = (field) => async (v) => { await saveSelf({ [field]: v }); };
              const visLabel = (v) => (String(v || '').toLowerCase() === 'private' ? T.priv : T.pub);
              return (
                <>
                  <EditableRow T={T} label={T.bio} canEdit={me} multiline value={info && info.bio} display={info && info.bio} onSave={sv('bio')} />
                  <div style={{textAlign:'left', background:'#faf7f2', borderRadius:'10px', padding:'10px 10px 2px', border:'1px solid #f0e9dc', marginTop:8}}>
                    {me && <div style={{display:'flex', justifyContent:'space-between', gap:8, marginBottom:8, fontSize:11}}><span style={{color:'#888', fontWeight:500}}>{T.userId}</span><span style={{fontWeight:500}}>{(storedUser?.id || 'self').slice(0, 22)}</span></div>}
                    <EditableRow T={T} label={T.name} canEdit={me} value={me ? getName() : ''} display={me ? (isPublic ? getName() : T.hidden) : viewing.display_name} onSave={async (v) => { if (!String(v).trim()) throw new Error('Name is needed'); await saveSelf({ display_name: String(v).trim() }); }} />
                    <EditableRow T={T} label={T.nick} canEdit={me} value={me ? profileInfo.nickname : ''} display={me ? profileInfo.nickname : (viewing.nickname || '')} onSave={sv('nickname')} />
                    <EditableRow T={T} label={T.gender} canEdit={me} value={info && info.gender} display={info && info.gender} options={[['Male', T.male], ['Female', T.female]]} onSave={sv('gender')} />
                    <EditableRow T={T} label={T.born} canEdit={me} type="date" value={info && dateOnlyStr(info.dob)} display={info && info.dob ? fmtDate(info.dob) : ''} onSave={async (v) => { await saveSelf({ dob: v || null }); }} />
                    <EditableRow T={T} label={T.location} canEdit={me} value={info && info.location} display={info && info.location} onSave={sv('location')} />
                    {me
                      ? <EditableRow T={T} label={T.visibility} canEdit value={profileInfo.visibility === 'private' ? 'Private' : 'Public'} display={visLabel(profileInfo.visibility)} options={[['Public', T.pub], ['Private', T.priv]]} onSave={sv('visibility')} />
                      : <EditableRow T={T} label={T.status} canEdit={false} display={viewInfo && !viewInfo.error ? (viewInfo.is_alive ? T.living : (viewInfo.dod ? `${T.passed} ${fmtDate(viewInfo.dod)}` : T.passed)) : ''} />}
                  </div>
                </>
              );
            })()}
            {viewing && viewInfo && viewInfo.error && <p style={{fontSize:'12px', color:'#b3261e', marginTop:10}}>{viewInfo.error}</p>}
            <p style={{fontSize:'10px', color:'#aaa', margin:'10px 0 0', lineHeight:'14px'}}>{T.publicNote}</p>
          </div>

          {!viewing && <div style={{marginTop:'12px'}}><GroupsCard groups={groups} homeId={storedUser?.id || storedUser?.uname} ownerId={storedUser?.id} onInvite={(m) => setGroupInvite({ person: m, mobile: '', result: null })} onChange={setGroups} onOpen={(m, gname) => setOpenReq({ path: [{ p: m, rel: gname }], n: Date.now() })} /></div>}
          {!viewing && <JoinedGroups groups={joined} onOpen={(m) => { setViewing({ ...m, way: '' }); window.scrollTo({ top: 0 }); }} />}
        </div>

        <div style={{minWidth:0}}>
          <div style={{marginBottom:'12px'}}><AdSlot kind="banner" /></div>
          {viewing ? (
            <>
            <div style={{background:'white', border:'1px solid #e9e2d6', borderRadius:'14px', overflow:'hidden', minHeight:'540px'}}>
              <div style={{background:'#efe8d3', borderBottom:'1px solid #e9e2d6', padding:'12px 16px', fontWeight: 600, fontSize:'13px'}}>{viewing.inMyTree ? `Your line to ${viewing.display_name}` : `${viewing.display_name.split(' ')[0]}'s Family Tree`}</div>
              {viewing.inMyTree
                ? <FamilyTree key="mine" userId={storedUser?.id || storedUser?.uname} openReq={openReq} onViewProfile={(p, way) => { if (p.id !== viewing.id) { setViewing({ ...p, way, inMyTree: true }); window.scrollTo({ top: 0 }); } }} />
                : <FamilyTree key={viewing.id} userId={viewing.id} readOnly onViewProfile={(p, way) => { if (p.id !== viewing.id) { setViewing({ ...p, way }); window.scrollTo({ top: 0 }); } }} />}
            </div>
            </>
          ) : privacy.showFamilyTree!==false ? (
            <div style={{background:'white', border:'1px solid #e9e2d6', borderRadius:'14px', overflow:'hidden', minHeight:'540px'}}>
              <div style={{background:'#efe8d3', borderBottom:'1px solid #e9e2d6', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <span style={{fontWeight: 600, fontSize:'13px'}}>{isPublic ? getName().split(' ')[0] : 'Hidden'}'s Family Tree {isPublic && profileInfo.nickname ? `(${profileInfo.nickname})` : ''}</span>
                <span style={{fontSize:'10px', background:'white', padding:'4px 10px', borderRadius:'20px', fontWeight: 500, border:'1px solid #e9e2d6'}}>{visibleFamily.length + 1} Members • {profileInfo.visibility}</span>
              </div>
              <FamilyTree userId={storedUser?.id || storedUser?.uname} openReq={openReq} onViewProfile={(p, way) => { setViewing({ ...p, way }); window.scrollTo({ top: 0 }); }} />
            </div>
          ) : <div className="card" style={{textAlign:'center', padding:'40px'}}><p style={{color:'#aaa', fontSize:'13px'}}>Family Tree is hidden</p></div>}
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:'12px', marginTop:'12px'}}>
            {[T.photos, T.scrap].map((t) => (
              <div key={t} className="card" style={{minWidth:0}}>
                <div style={{fontSize:'11px', fontWeight:600, color:'#888', letterSpacing:'1px', marginBottom:6}}>{t}</div>
                <p style={{margin:0, fontSize:'12px', color:'#aaa'}}><i>({T.soon})</i></p>
              </div>
            ))}
          </div>
        </div>

        <div>
          {!viewing && <WaitingCard notes={notes} busyId={noteBusy} onAnswer={answerNote} onOpen={(p) => { setViewing({ ...p, way: '' }); window.scrollTo({ top: 0 }); }} T={T} />}
          {!viewing && <div style={{marginTop:'16px'}}><NewsCorner T={T} /></div>}
          <div style={{marginTop: viewing ? 0 : '16px'}}><AdSlot kind="square" /></div>
        </div>
      </div>

      <button onClick={()=>setShowChat(true)} aria-label={chatUnread ? `Chat, ${chatUnread} unread` : 'Chat'} style={{position:'fixed', bottom:'18px', right:'18px', width:'50px', height:'50px', background:'black', color:'white', borderRadius:'50%', border:'none', cursor:'pointer', zIndex:9999}}>
        💬
        {chatUnread > 0 && <span style={{position:'absolute', top:'-4px', right:'-4px', minWidth:'18px', height:'18px', padding:'0 5px', boxSizing:'border-box', borderRadius:'9px', background:'#d33', color:'white', fontSize:'10px', fontWeight:700, lineHeight:'18px', textAlign:'center'}}>{chatUnread > 99 ? '99+' : chatUnread}</span>}
      </button>
      {showChat && <ChatSystem self={storedUser} allProfiles={family} groups={groups} onUnread={setChatUnread} onClose={()=>setShowChat(false)} />}
    </div>
  );
}