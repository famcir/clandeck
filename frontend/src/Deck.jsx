import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import CommonHeader from './CommonHeader.jsx';
import ChatSystem from './ChatSystem.jsx';
import mangoBasket from './assets/mango-basket.png';

const API_URL = import.meta.env.VITE_API_URL || 'https://api.clandeck.com';

// ================= FAMILY TREE (tree view + line view) =================


// ---- card / spacing sizes (px) ----
const CW = 112;          // card width
const CH = 144;          // card height
const GAP = 30;          // gap between neighbours
const COUPLE_GAP = 56;   // gap between a person and a spouse (room for the marriage line)
const ROW = CH + 84;     // distance from one generation row to the next
const PAD = 40;          // canvas padding
const LINE = '#b89a6a';
const LINE_W = 2;

const photoOf = (p) => (p && (p.photo_compressed_url || p.photo_url)) || '';
const initialOf = (p) => ((p && p.display_name) || '?').trim().charAt(0).toUpperCase();

/**
 * Works out where every card goes and which lines join them.
 *
 *            [Father]==[Mother]
 *                  |
 *        ┌─────────┴─────────┐
 *   [Sibling]   [ ME ]━━━[Spouse 1]   [Spouse 2]
 *                  └────┬────┘
 *                   [Child] [Child]       <- centred under ME + that spouse
 */
function buildLayout(me, fam) {
  const father = fam.father || null;
  const mother = fam.mother || null;
  const siblings = fam.siblings || [];
  const spouses = fam.spouses || [];
  const children = fam.children || [];
  const hasParents = !!(father || mother);

  const nodes = [];   // {p, x, y, rel, center}
  const lines = [];   // {d}  svg path strings
  const dots = [];    // {x, y}
  const L = (x1, y1, x2, y2) => lines.push(`M${x1} ${y1} L${x2} ${y2}`);

  const y1 = hasParents ? ROW : 0;      // middle row (me, siblings, spouses)
  const y0 = 0;                         // parents row
  const y2 = y1 + ROW;                  // children row

  // ---- middle row: siblings (left) · me · spouses (right) ----
  let x = 0;
  const mid = [];
  siblings.forEach((s, i) => {
    mid.push({ p: s, x, rel: 'Sibling' });
    x += CW + (i === siblings.length - 1 ? GAP + 14 : GAP);
  });
  const meX = x;
  mid.push({ p: me, x: meX, rel: 'Self', center: true });
  x += CW;
  const spouseNodes = [];
  spouses.forEach((s, i) => {
    x += i === 0 ? COUPLE_GAP : GAP;
    const n = { p: s, x, rel: 'Spouse' };
    mid.push(n); spouseNodes.push(n);
    x += CW;
  });
  const meCx = meX + CW / 2;
  const midY = y1 + CH / 2;

  // ---- marriage lines ----
  const anchors = [];   // where each spouse's children hang from {x, y}
  spouseNodes.forEach((n, i) => {
    const spCx = n.x + CW / 2;
    if (i === 0) {
      L(meX + CW, midY, n.x, midY);
      anchors.push({ x: (meCx + spCx) / 2, y: midY });
    } else {
      const depth = y1 + CH + 16 * i;          // run underneath the cards
      lines.push(`M${meCx} ${y1 + CH} L${meCx} ${depth} L${spCx} ${depth} L${spCx} ${y1 + CH}`);
      anchors.push({ x: (meCx + spCx) / 2, y: depth });
      dots.push({ x: meCx, y: y1 + CH });
    }
  });

  // ---- parents ----
  const sibCxs = mid.filter((m) => m.rel !== 'Spouse').map((m) => m.x + CW / 2);
  let parentsMinX = Infinity, parentsMaxX = -Infinity;
  if (hasParents) {
    const pCx = (Math.min(...sibCxs) + Math.max(...sibCxs)) / 2;
    const both = father && mother;
    const pw = both ? CW * 2 + COUPLE_GAP : CW;
    const px = pCx - pw / 2;
    parentsMinX = px; parentsMaxX = px + pw;
    let dropX, dropY;
    if (both) {
      nodes.push({ p: father, x: px, y: y0, rel: 'Father' });
      nodes.push({ p: mother, x: px + CW + COUPLE_GAP, y: y0, rel: 'Mother' });
      L(px + CW, y0 + CH / 2, px + CW + COUPLE_GAP, y0 + CH / 2);
      dropX = pCx; dropY = y0 + CH / 2;
    } else {
      nodes.push({ p: father || mother, x: px, y: y0, rel: father ? 'Father' : 'Mother' });
      dropX = pCx; dropY = y0 + CH;
    }
    const bus = y1 - 34;
    L(dropX, dropY, dropX, bus);
    const bl = Math.min(...sibCxs, dropX), br = Math.max(...sibCxs, dropX);
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
    else groups.push({ anchor: { x: meCx, y: y1 + CH }, kids: loose });
  }
  const active = groups.filter((g) => g.kids.length).sort((a, b) => a.anchor.x - b.anchor.x);
  let prevRight = -Infinity, childMin = Infinity, childMax = -Infinity;
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
    const bus = y2 - 34;
    L(g.anchor.x, g.anchor.y, g.anchor.x, bus);
    const bl = Math.min(...cxs, g.anchor.x), br = Math.max(...cxs, g.anchor.x);
    if (br > bl) L(bl, bus, br, bus);
    cxs.forEach((cx) => L(cx, bus, cx, y2));
  });

  // ---- shift everything so the canvas starts at PAD ----
  // make the selected person the exact horizontal middle of the canvas
  const minX0 = Math.min(0, parentsMinX, childMin);
  const maxX0 = Math.max(x, parentsMaxX, childMax);
  const span = Math.max(meCx - minX0, maxX0 - meCx);
  const minX = meCx - span, maxX = meCx + span;
  const dx = PAD - minX;
  const dy = PAD;
  const shiftedNodes = nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy }));
  const shiftPath = (d) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, a, b) => `${+a + dx} ${+b + dy}`);
  const bottom = (active.length ? y2 : y1) + CH;
  return {
    nodes: shiftedNodes,
    paths: lines.map(shiftPath),
    dots: dots.map((d) => ({ x: d.x + dx, y: d.y + dy })),
    width: maxX - minX + PAD * 2,
    height: bottom + PAD * 2,
    meCx: meCx + dx,
  };
}

function Card({ node, isLogin, onPick }) {
  const { p, rel, center } = node;
  const [imgOk, setImgOk] = useState(true);
  const src = photoOf(p);
  return (
    <button
      type="button"
      onClick={() => !center && onPick(p, rel)}
      title={center ? p.display_name : `Open ${p.display_name}'s family`}
      style={{
        position: 'absolute', left: node.x, top: node.y, width: CW, height: CH,
        padding: 8, border: center ? '2px solid #111' : '1px solid #e3d3b3',
        background: center ? '#fffaf0' : '#fff', borderRadius: 14,
        boxShadow: center ? '0 6px 18px rgba(0,0,0,.18)' : '0 2px 6px rgba(0,0,0,.07)',
        cursor: center ? 'default' : 'pointer', textAlign: 'center', font: 'inherit',
        display: 'flex', flexDirection: 'column', alignItems: 'center', transition: 'transform .15s, box-shadow .15s',
      }}
      onMouseEnter={(e) => { if (!center) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,.15)'; } }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = center ? '0 6px 18px rgba(0,0,0,.18)' : '0 2px 6px rgba(0,0,0,.07)'; }}
    >
      <div style={{ width: 72, height: 72, borderRadius: 14, overflow: 'hidden', background: '#e8d5b0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 700, color: '#5a4524', flexShrink: 0 }}>
        {src && imgOk
          ? <img src={src} alt="" onError={() => setImgOk(false)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : initialOf(p)}
      </div>
      <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, lineHeight: '16px', height: 32, width: '100%', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word' }}>
        {p.display_name}
      </div>
      <div style={{ marginTop: 'auto', fontSize: 11, color: '#8a7a5c', lineHeight: '14px' }}>
        {rel === 'Self' ? (isLogin ? 'You' : 'Selected') : rel}{isLogin && rel !== 'Self' ? ' • You' : ''}
      </div>
    </button>
  );
}

// ---- line-view (path) sizes ----
const TW = 132;        // path chip width
const TH = 56;         // path chip height
const EW = 92;         // length of a connecting line between two chips
const TRAIL_H = 130;   // height of the path strip above the tree

function Chip({ item, p, index, isLast, isLogin, x, onJump }) {
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
        position: 'absolute', left: x - TW / 2, top: 16, width: TW, height: TH, padding: 6, boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', font: 'inherit', color: '#111',
        background: isLast ? '#fffaf0' : '#fff', border: isLast ? '2px solid #111' : '1px solid #e3d3b3',
        borderRadius: 12, cursor: isLast ? 'default' : 'pointer',
        boxShadow: isLast ? '0 4px 12px rgba(0,0,0,.18)' : '0 2px 5px rgba(0,0,0,.07)',
      }}
    >
      <div style={{ width: 38, height: 38, borderRadius: 9, overflow: 'hidden', background: '#e8d5b0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#5a4524', flexShrink: 0 }}>
        {src && imgOk ? <img src={src} alt="" onError={() => setImgOk(false)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initialOf(p)}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, lineHeight: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p ? p.display_name : '…'}</div>
        <div style={{ fontSize: 10, color: '#8a7a5c', lineHeight: '13px' }}>{sub}{isLogin && index !== 0 ? ' • You' : ''}</div>
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

  const layout = useMemo(() => (data ? buildLayout(data.myProfile, data.family || {}) : null), [data]);

  const lineMode = view === 'line';
  const T = trail.length;
  const trailLeft = (T - 1) * (TW + EW) + TW / 2;
  const trailH = lineMode ? TRAIL_H : 0;
  const W = layout ? (lineMode ? Math.max(layout.width, 2 * (trailLeft + PAD)) : layout.width) : 0;

  // keep the selected person in the horizontal middle of the view
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && layout) el.scrollLeft = Math.max(0, W / 2 - el.clientWidth / 2);
  }, [layout, W]);

  // cards pass (person, relation); a person already on the path just jumps back to that point, so it never loops
  const pickWithRel = useCallback((p, rel) => {
    setTrail((t) => {
      const idx = t.findIndex((x, i) => x.id === p.id || (x.p && x.p.id === p.id) || (i === 0 && home && home.id === p.id));
      if (idx >= 0) return t.slice(0, idx + 1);
      return [...t, { id: p.id, p, rel: rel || '' }];
    });
  }, [home]);

  const jump = (i) => setTrail((t) => t.slice(0, i + 1));
  const back = () => setTrail((t) => (t.length > 1 ? t.slice(0, -1) : t));
  const goHome = () => setTrail((t) => t.slice(0, 1));

  const btn = { padding: '7px 14px', borderRadius: 999, border: '1px solid #d9c49b', background: '#fff', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 600 };
  const seg = (on) => ({ ...btn, borderRadius: 0, border: '1px solid #d9c49b', background: on ? '#111' : '#fff', color: on ? '#fff' : '#111' });
  const chipY = 16 + TH / 2;
  const cxOf = (i) => W / 2 - (T - 1 - i) * (TW + EW);
  const profileOf = (item, i) => item.p || (i === 0 ? home : null);

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex' }}>
          <button type="button" onClick={() => chooseView('tree')} style={{ ...seg(!lineMode), borderRadius: '999px 0 0 999px' }}>🌳 Tree view</button>
          <button type="button" onClick={() => chooseView('line')} style={{ ...seg(lineMode), borderRadius: '0 999px 999px 0', borderLeft: 'none' }}>➖ Line view</button>
        </div>
        <button type="button" style={{ ...btn, opacity: atHome ? 0.4 : 1 }} disabled={atHome} onClick={back}>← Back</button>
        <button type="button" style={{ ...btn, opacity: atHome ? 0.4 : 1 }} disabled={atHome} onClick={goHome}>⌂ My tree</button>
        <span style={{ fontSize: 13, color: '#8a7a5c' }}>
          {data ? <>Showing <b style={{ color: '#111' }}>{data.myProfile.display_name}</b>{atHome ? '' : "'s family"} · click anyone to open their tree</> : ''}
        </span>
      </div>

      {error && <div style={{ padding: 16, color: '#b00020' }}>{error}</div>}
      {loading && !data && <div style={{ padding: 24, color: '#8a7a5c' }}>Loading family tree…</div>}

      {layout && (
        <div ref={scrollRef} style={{ overflowX: 'auto', overflowY: 'hidden', opacity: loading ? 0.5 : 1, transition: 'opacity .15s' }}>
          <div style={{ position: 'relative', width: W, height: trailH + layout.height, margin: '0 auto' }}>

            {lineMode && (
              <>
                <svg width={W} height={trailH} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
                  {trail.slice(1).map((item, k) => {
                    const i = k + 1;
                    const x1 = cxOf(i - 1) + TW / 2, x2 = cxOf(i) - TW / 2;
                    return (
                      <g key={i}>
                        <path d={`M${x1} ${chipY} L${x2 - 2} ${chipY}`} stroke={LINE} strokeWidth={LINE_W} />
                        <path d={`M${x2} ${chipY} l-8 -5 l0 10 z`} fill={LINE} />
                      </g>
                    );
                  })}
                  <path d={`M${W / 2} ${16 + TH} L${W / 2} ${trailH - 4}`} stroke={LINE} strokeWidth={LINE_W} strokeDasharray="4 4" />
                  <path d={`M${W / 2} ${trailH} l-5 -8 l10 0 z`} fill={LINE} />
                </svg>
                {trail.slice(1).map((item, k) => {
                  const i = k + 1;
                  const mx = (cxOf(i - 1) + TW / 2 + cxOf(i) - TW / 2) / 2;
                  return (
                    <span key={'l' + i} style={{ position: 'absolute', left: mx - 40, width: 80, top: chipY - 22, textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#8a7a5c' }}>
                      {item.rel}
                    </span>
                  );
                })}
                {trail.map((item, i) => (
                  <Chip key={item.id + i} item={item} p={profileOf(item, i)} index={i} isLast={i === T - 1}
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
                {layout.dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={3.5} fill={LINE} />)}
              </svg>
              {layout.nodes.map((n) => (
                <Card key={n.p.id + n.rel} node={n} isLogin={!!myProfileId && n.p.id === myProfileId} onPick={pickWithRel} />
              ))}
            </div>
          </div>
        </div>
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
        </div>
      </div>

      <button onClick={()=>setShowChat(true)} style={{position:'fixed', bottom:'18px', right:'18px', width:'50px', height:'50px', background:'black', color:'white', borderRadius:'50%', border:'none', cursor:'pointer', zIndex:9999}}>💬</button>
      {showChat && <ChatSystem self={storedUser} allProfiles={family} groups={groups} onClose={()=>setShowChat(false)} />}
    </div>
  );
}