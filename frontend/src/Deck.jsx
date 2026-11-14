import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import CommonHeader from './CommonHeader.jsx';
import ChatSystem from './ChatSystem.jsx';
import mangoBasket from './assets/mango-basket.png';

const API_URL = import.meta.env.VITE_API_URL || 'https://api.clandeck.com';

// ================= FAMILY TREE (tree view + line view) =================
// ---- sizes: smaller on phones. IMG = photo size, CW/CH = space one person takes (photo + name + relation) ----
const DIMS = {
  desk: { IMG: 60, CW: 96, CH: 118, GAP: 24, COUPLE: 52, ROW: 190, PAD: 30, BUS: 26, TW: 128, TH: 48, EW: 84, TIMG: 34, TRAIL_H: 116 },
  mob:  { IMG: 44, CW: 72, CH: 96,  GAP: 14, COUPLE: 34, ROW: 154, PAD: 14, BUS: 22, TW: 104, TH: 42, EW: 54, TIMG: 28, TRAIL_H: 100 },
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
    x += CW + (i === siblings.length - 1 ? GAP + 10 : GAP);
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
function Person({ node, D, isLogin, onPick }) {
  const { p, rel, center } = node;
  const [imgOk, setImgOk] = useState(true);
  const [hover, setHover] = useState(false);
  const src = photoOf(p);
  const label = rel === 'Self' ? (isLogin ? 'You' : 'Selected') : rel + (isLogin ? ' • You' : '');
  return (
    <button
      type="button"
      onClick={() => !center && onPick(p, rel)}
      title={center ? p.display_name : `Open ${p.display_name}'s family`}
      style={{
        position: 'absolute', left: node.x, top: node.y, width: D.CW, height: D.CH, padding: 0, border: 'none', background: 'none',
        font: 'inherit', cursor: center ? 'default' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center',
        zIndex: hover ? 20 : 1,
      }}
    >
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'relative', zIndex: hover ? 5 : 0,
          width: D.IMG, height: D.IMG, borderRadius: 12, overflow: 'hidden', background: '#e8d5b0', flexShrink: 0, boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: D.IMG * 0.4, color: '#5a4524',
          border: center ? '3px solid #1a1a1a' : '2px solid #fff',
          boxShadow: hover ? '0 10px 24px rgba(0,0,0,.35)' : center ? '0 4px 12px rgba(0,0,0,.22)' : '0 1px 4px rgba(0,0,0,.18)',
          transform: hover ? 'scale(1.75)' : 'none', transformOrigin: 'center', transition: 'transform .18s ease, box-shadow .18s ease',
        }}
      >
        {src && imgOk ? <img src={src} alt="" onError={() => setImgOk(false)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initialOf(p)}
      </div>
      {/* the white background lets a line pass behind the text instead of through it */}
      <div style={{ position: 'relative', zIndex: 1, background: 'white', width: '100%', marginTop: 6, fontWeight: 800, fontSize: 12, lineHeight: '15px', maxHeight: 30, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word', color: '#1a1a1a' }}>
        {p.display_name}
      </div>
      <div style={{ position: 'relative', zIndex: 1, background: 'white', width: '100%', fontWeight: 800, fontSize: 11, lineHeight: '14px', color: center ? '#1a1a1a' : '#8a7a5c' }}>{label}</div>
    </button>
  );
}

// one step of the path in Line view
function Chip({ item, p, index, isLast, isLogin, x, D, onJump }) {
  const [imgOk, setImgOk] = useState(true);
  const src = photoOf(p);
  const sub = index === 0 ? 'You' : isLast ? 'Showing' : item.rel;
  return (
    <button
      type="button"
      disabled={isLast}
      onClick={() => onJump(index)}
      title={isLast ? '' : `Go back to ${p ? p.display_name : ''}`}
      style={{
        position: 'absolute', left: x - D.TW / 2, top: 14, width: D.TW, height: D.TH, padding: 5, boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 7, textAlign: 'left', font: 'inherit', color: '#1a1a1a',
        background: isLast ? '#fffaf0' : '#fff', border: isLast ? '2px solid #1a1a1a' : '1px solid #e3d3b3',
        borderRadius: 10, cursor: isLast ? 'default' : 'pointer',
        boxShadow: isLast ? '0 4px 12px rgba(0,0,0,.18)' : '0 1px 4px rgba(0,0,0,.08)',
      }}
    >
      <div style={{ width: D.TIMG, height: D.TIMG, borderRadius: 8, overflow: 'hidden', background: '#e8d5b0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: '#5a4524', flexShrink: 0 }}>
        {src && imgOk ? <img src={src} alt="" onError={() => setImgOk(false)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initialOf(p)}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 800, lineHeight: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p ? p.display_name : '…'}</div>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#8a7a5c', lineHeight: '13px' }}>{sub}{isLogin && index !== 0 ? ' • You' : ''}</div>
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
function FamilyTree({ userId, onFocus }) {
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

  const focusId = trail[trail.length - 1].id;
  const atHome = trail.length === 1;

  useEffect(() => { setTrail([{ id: userId, rel: '' }]); }, [userId]);

  useEffect(() => {
    if (!focusId) return;
    let alive = true;
    setLoading(true); setError('');
    fetch(`${API_URL}/api/profiles/family-tree?user_id=${encodeURIComponent(focusId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (!j.success) throw new Error(j.error || 'Could not load the family tree');
        setData(j);
        if (focusId === userId) { setHome(j.myProfile); setMyProfileId(j.myProfile.id); }
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
  const trailLeft = (T - 1) * (D.TW + D.EW) + D.TW / 2;
  const trailH = lineMode ? D.TRAIL_H : 0;
  const W = layout ? (lineMode ? Math.max(layout.width, 2 * (trailLeft + D.PAD)) : layout.width) : 0;

  // keep the selected person in the horizontal middle of the view
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && layout) el.scrollLeft = Math.max(0, W / 2 - el.clientWidth / 2);
  }, [layout, W]);

  // cards pass (person, relation); a person already on the path just jumps back to that point, so it never loops
  const pick = useCallback((p, rel) => {
    setTrail((t) => {
      const idx = t.findIndex((x, i) => x.id === p.id || (x.p && x.p.id === p.id) || (i === 0 && home && home.id === p.id));
      if (idx >= 0) return t.slice(0, idx + 1);
      return [...t, { id: p.id, p, rel: rel || '' }];
    });
  }, [home]);

  const jump = (i) => setTrail((t) => t.slice(0, i + 1));
  const back = () => setTrail((t) => (t.length > 1 ? t.slice(0, -1) : t));
  const goHome = () => setTrail((t) => t.slice(0, 1));

  const chipY = 14 + D.TH / 2;
  const cxOf = (i) => W / 2 - (T - 1 - i) * (D.TW + D.EW);
  const profileOf = (item, i) => item.p || (i === 0 ? home : null);

  return (
    <div style={{ width: '100%', fontFamily: 'inherit' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 14px', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => chooseView('tree')} style={navBtn(!lineMode)}>🌳 Tree view</button>
        <button type="button" onClick={() => chooseView('line')} style={navBtn(lineMode)}>➖ Line view</button>
        <button type="button" style={navBtn(false, atHome)} disabled={atHome} onClick={back}>← Back</button>
        <button type="button" style={navBtn(false, atHome)} disabled={atHome} onClick={goHome}>⌂ My tree</button>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#8a7a5c' }}>
          {data ? <>Showing <span style={{ color: '#1a1a1a' }}>{data.myProfile.display_name}</span>{atHome ? '' : "'s family"} · tap anyone to open their tree</> : ''}
        </span>
      </div>

      {error && <div style={{ padding: 16, color: '#b00020', fontWeight: 800, fontSize: 12 }}>{error}</div>}
      {loading && !data && <div style={{ padding: 24, color: '#8a7a5c', fontWeight: 800, fontSize: 12 }}>Loading family tree…</div>}

      {layout && (
        <div ref={scrollRef} style={{ overflowX: 'auto', overflowY: 'hidden', opacity: loading ? 0.5 : 1, transition: 'opacity .15s' }}>
          <div style={{ position: 'relative', width: W, height: trailH + layout.height, margin: '0 auto' }}>

            {lineMode && (
              <>
                <svg width={W} height={trailH} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
                  {trail.slice(1).map((item, k) => {
                    const i = k + 1;
                    const x1 = cxOf(i - 1) + D.TW / 2, x2 = cxOf(i) - D.TW / 2;
                    return (
                      <g key={i}>
                        <path d={`M${x1} ${chipY} L${x2 - 2} ${chipY}`} stroke={LINE} strokeWidth={LINE_W} />
                        <path d={`M${x2} ${chipY} l-7 -4.5 l0 9 z`} fill={LINE} />
                      </g>
                    );
                  })}
                  <path d={`M${W / 2} ${14 + D.TH} L${W / 2} ${trailH - 4}`} stroke={LINE} strokeWidth={LINE_W} strokeDasharray="4 4" />
                  <path d={`M${W / 2} ${trailH} l-5 -8 l10 0 z`} fill={LINE} />
                </svg>
                {trail.slice(1).map((item, k) => {
                  const i = k + 1;
                  const mx = (cxOf(i - 1) + D.TW / 2 + cxOf(i) - D.TW / 2) / 2;
                  return (
                    <span key={'l' + i} style={{ position: 'absolute', left: mx - 36, width: 72, top: chipY - 20, textAlign: 'center', fontSize: 11, fontWeight: 800, color: '#8a7a5c' }}>
                      {item.rel}
                    </span>
                  );
                })}
                {trail.map((item, i) => (
                  <Chip key={item.id + i} item={item} p={profileOf(item, i)} index={i} isLast={i === T - 1} D={D}
                    isLogin={!!myProfileId && profileOf(item, i) && profileOf(item, i).id === myProfileId}
                    x={cxOf(i)} onJump={jump} />
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
                <Person key={n.p.id + n.rel} node={n} D={D} isLogin={!!myProfileId && n.p.id === myProfileId} onPick={pick} />
              ))}
            </div>
          </div>
        </div>
      )}
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
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: '#b8a98a' }}>ADVERTISEMENT</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#c9bb9d', marginTop: 2 }}>{isBanner ? 'Banner ad space' : 'Square ad space'}</span>
        </>
      )}
    </div>
  );
}

// ================= DECK PAGE =================

export default function Deck({ onGoProfile, onLogout }) {
  const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
  const [family, setFamily] = useState([]);
  const [groups, setGroups] = useState([]);
  const [privacy, setPrivacy] = useState({});
  const [showChat, setShowChat] = useState(false);
  const [tempLogin, setTempLogin] = useState(false);   // still on a temporary password?
  const [photoUrl, setPhotoUrl] = useState(localStorage.getItem('photo_url') || '');
  const [pos, setPos] = useState(JSON.parse(localStorage.getItem('clandeck_photo_pos') || '{"x":50,"y":50,"zoom":100}'));
  const [profileInfo, setProfileInfo] = useState({
    nickname: localStorage.getItem('profile_nickname') || '',
    visibility: localStorage.getItem('profile_visibility') || 'public'
  });

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
    
    setGroups(safeParse('clandeck_groups'));
    try { 
      const p = JSON.parse(localStorage.getItem('clandeck_privacy') || '{}');
      setPrivacy(p);
      // If visibility is private, override
      const vis = localStorage.getItem('profile_visibility') || 'public';
      if (vis === 'private') setPrivacy(prev => ({...prev, showName: false}));
    } catch { setPrivacy({}); }

    setPhotoUrl(localStorage.getItem('photo_url') || '');
    try { setPos(JSON.parse(localStorage.getItem('clandeck_photo_pos') || '{"x":50,"y":50,"zoom":100}')); } catch { setPos({x:50,y:50,zoom:100}); }

    setProfileInfo({
      nickname: localStorage.getItem('profile_nickname') || '',
      visibility: localStorage.getItem('profile_visibility') || 'public'
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
            localStorage.setItem('profile_visibility', j.data.visibility);
            setProfileInfo(prev => ({...prev, visibility: j.data.visibility}));
            if (j.data.visibility === 'private') setPrivacy(prev => ({...prev, showName: false}));
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
    <div style={{minHeight:'100vh', background:'#f7f4ef', width:'100vw'}}>
      <style>{`
        .deck-grid { display: grid; grid-template-columns: 300px 1fr 300px; gap: 16px; width: 100%; padding: 16px 20px; box-sizing: border-box; }
        .card { background: #fffefb; border: 1px solid #e9e2d6; border-radius: 14px; padding: 18px; }
        @media(max-width: 1100px){ .deck-grid { grid-template-columns: 300px 1fr; } }
        @media(max-width: 700px){ .deck-grid { grid-template-columns: 1fr; padding: 12px; } }
      `}</style>

      <CommonHeader self={storedUser} page="deck" onDeck={()=>{}} onProfile={onGoProfile} onLogout={onLogout} />

      {tempLogin && (
        <div style={{margin:'12px 20px 0', padding:'10px 14px', background:'#fff8e1', border:'1px solid #f1dc9a', borderRadius:'12px', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap', fontSize:'13px'}}>
          <span style={{flex:1, minWidth:200}}>🔑 You are using a <b>temporary login</b>. Please set your own username and password in Profile Edit.</span>
          <button onClick={onGoProfile} style={{padding:'8px 16px', borderRadius:'20px', border:'none', background:'#111', color:'white', fontWeight:700, fontSize:'11px', cursor:'pointer'}}>Set now</button>
        </div>
      )}

      <div className="deck-grid">
        <div>
          <div className="card" style={{textAlign:'center'}}>
            <div style={{width:'144px', height:'144px', background:'#c9ad83', color:'white', borderRadius:'18px', margin:'0 auto', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'52px', fontWeight:800, overflow:'hidden'}}>
              {photoUrl ? <img src={photoUrl} alt="profile" style={{width:'100%', height:'100%', objectFit:'cover', objectPosition: `${pos.x}% ${pos.y}%`, transform: `scale(${pos.zoom/100})`}} onError={()=>setPhotoUrl('')} /> : getName()[0]?.toUpperCase()}
            </div>
            <h2 style={{fontWeight:800, fontSize:'16px', marginTop:'12px'}}>
              {isPublic ? getName() : 'Hidden'}
              {isPublic && profileInfo.nickname && <span style={{fontWeight:400, fontSize:'12px', color:'#888'}}> ({profileInfo.nickname})</span>}
            </h2>
            {privacy.showUsername!==false && <p style={{fontSize:'11px', color:'#888', fontWeight:700}}>@{storedUser?.uname || 'user'}{isPublic && profileInfo.nickname ? ` • ${profileInfo.nickname}` : ''}</p>}

            <div style={{marginTop:'14px', textAlign:'left', background:'#faf7f2', borderRadius:'10px', padding:'10px', border:'1px solid #f0e9dc', fontSize:'11px'}}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:'6px'}}><span style={{color:'#888', fontWeight:700}}>USER ID</span><span style={{fontWeight:700, fontSize:'10px'}}>{(storedUser?.id || 'self').slice(0,22)}</span></div>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:'6px'}}><span style={{color:'#888', fontWeight:700}}>NAME</span><span style={{fontWeight:700}}>{isPublic ? getName() : 'Hidden'}</span></div>
              {profileInfo.nickname && <div style={{display:'flex', justifyContent:'space-between', marginBottom:'6px'}}><span style={{color:'#888', fontWeight:700}}>NICK NAME</span><span style={{fontWeight:700}}>{isPublic ? profileInfo.nickname : 'Hidden'}</span></div>}
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:'6px'}}><span style={{color:'#888', fontWeight:700}}>VISIBILITY</span><span style={{fontWeight:700, color: profileInfo.visibility==='public' ? 'green' : 'red'}}>{profileInfo.visibility?.toUpperCase()}</span></div>
            </div>

            {privacy.showMangoes!==false && (
              <>
                <div style={{marginTop:'14px'}}><img src={mangoBasket} alt="basket" style={{width:'54px', height:'54px', margin:'0 auto', display:'block'}} /></div>
                <p style={{fontSize:'8px', letterSpacing:'2px', color:'#aaa', fontWeight:800, marginTop:'4px'}}>MANGOS IN BASKET</p>
              </>
            )}
          </div>
        </div>

        <div style={{minWidth:0}}>
          <div style={{marginBottom:'12px'}}><AdSlot kind="banner" /></div>
          {privacy.showFamilyTree!==false ? (
            <div style={{background:'white', border:'1px solid #e9e2d6', borderRadius:'14px', overflow:'hidden', minHeight:'540px'}}>
              <div style={{background:'#efe8d3', borderBottom:'1px solid #e9e2d6', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <span style={{fontWeight:800, fontSize:'13px'}}>{isPublic ? getName().split(' ')[0] : 'Hidden'}'s Family Tree {isPublic && profileInfo.nickname ? `(${profileInfo.nickname})` : ''}</span>
                <span style={{fontSize:'10px', background:'white', padding:'4px 10px', borderRadius:'20px', fontWeight:700, border:'1px solid #e9e2d6'}}>{visibleFamily.length + 1} Members • {profileInfo.visibility}</span>
              </div>
              <FamilyTree userId={storedUser?.id || storedUser?.uname} />
            </div>
          ) : <div className="card" style={{textAlign:'center', padding:'40px'}}><p style={{color:'#aaa', fontSize:'13px'}}>Family Tree is hidden</p></div>}
        </div>

        <div>
          <div className="card">
            <h3 style={{fontWeight:800, fontSize:'12px', marginBottom:'10px'}}>My Groups ({groups.length})</h3>
            {groups.length===0 ? <p style={{fontSize:'11px', color:'#aaa'}}>No groups yet. Create in Profile Edit.</p> : groups.map(g=>(
              g && <div key={g.id} style={{padding:'8px', border:'1px solid #f0e0c0', borderRadius:'8px', marginBottom:'6px', fontSize:'12px'}}><strong>{g.name}</strong><br/><span style={{color:'#888'}}>{g.members?.length || 0} members</span></div>
            ))}
          </div>
          <div style={{marginTop:'16px'}}><AdSlot kind="square" /></div>
        </div>
      </div>

      <button onClick={()=>setShowChat(true)} style={{position:'fixed', bottom:'18px', right:'18px', width:'50px', height:'50px', background:'black', color:'white', borderRadius:'50%', border:'none', cursor:'pointer', zIndex:9999}}>💬</button>
      {showChat && <ChatSystem self={storedUser} allProfiles={family} groups={groups} onClose={()=>setShowChat(false)} />}
    </div>
  );
}