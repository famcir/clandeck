import React, { useState, useEffect, useCallback } from 'react';
import CommonHeader from './CommonHeader.jsx';

const API_URL = import.meta.env.VITE_API_URL || 'https://api.clandeck.com';

const Avatar = ({ p, size = 34 }) => {
  const [bad, setBad] = useState(false);
  const url = p && p.photo_url && !bad ? p.photo_url : '';
  return (
    <div style={{ width: size, height: size, borderRadius: 8, overflow: 'hidden', background: '#e8d5b0', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: size * 0.42, color: '#5a4524' }}>
      {url ? <img src={url} alt="" onError={() => setBad(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : ((p && p.display_name) || '?').trim().charAt(0).toUpperCase()}
    </div>
  );
};

const pill = (bg, fg) => ({ padding: '7px 14px', borderRadius: 20, border: bg === '#fff' ? '1px solid #d8c5a3' : 'none', background: bg, color: fg, fontWeight: 600, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' });
const tab = (active) => ({ padding: '7px 16px', borderRadius: 8, border: '1px solid #d8c5a3', cursor: 'pointer', fontWeight: 600, fontSize: 12, fontFamily: 'inherit', background: active ? '#1a1a1a' : '#c9ad83', color: 'white' });

const when = (d) => {
  if (!d) return '';
  const raw = String(d);
  const t = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

// Every request and notice for the logged-in person, newest first.
export default function NotificationWall({ onGoDeck, onGoProfile, onLogout }) {
  const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
  const homeId = storedUser.id || storedUser.uname || '';
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    try {
      const j = await (await fetch(`${API_URL}/api/notifications?home_id=${encodeURIComponent(homeId)}&all=1`)).json();
      setRows(j.success ? j.data : []);
    } catch { setRows([]); }
  }, [homeId]);
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const answer = async (n, action) => {
    setBusyId(n.id);
    try { await fetch(`${API_URL}/api/notifications/${n.id}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ home_id: homeId, action }) }); } catch { /* reloaded below */ }
    setBusyId('');
    await load();
  };
  // open that person's view-only profile on the Deck
  const viewProfile = (p) => {
    try { sessionStorage.setItem('clandeck_open_profile', JSON.stringify(p)); } catch { /* ignore */ }
    onGoDeck();
  };

  const text = (n) => {
    const who = n.from ? n.from.display_name : 'Someone';
    if (n.kind === 'group_add') return <><b>{who}</b> added you to the group <b>{n.group_name || 'a group'}</b></>;
    if (n.kind === 'family_add') return <><b>{who}</b> added you as {n.message ? <>{n.message}'s </> : 'their '}<b>{n.relation_type || 'relative'}</b></>;
    return <>{n.message}</>;
  };
  const list = (rows || []).filter((n) => filter === 'all' || (filter === 'requests' ? n.kind !== 'info' : n.kind === 'info'));
  const waiting = (rows || []).filter((n) => n.status === 'pending').length;

  return (
    <div style={{ minHeight: '100vh', background: '#f7f4ef', width: '100%', maxWidth: '100%', overflowX: 'hidden', boxSizing: 'border-box' }}>
      <style>{`.nw-font :not(header):not(header *) { font-family: Arial, Helvetica, sans-serif; }`}</style>
      <CommonHeader self={storedUser} page="notifications" onDeck={onGoDeck} onProfile={onGoProfile} onLogout={onLogout} />
      <div className="nw-font" style={{ maxWidth: 760, margin: '0 auto', padding: '16px 20px 40px', boxSizing: 'border-box', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, flex: 1, minWidth: 160 }}>🔔 Notification wall{waiting > 0 && <span style={{ marginLeft: 8, background: '#b3261e', color: '#fff', borderRadius: 10, padding: '1px 8px', fontSize: 11 }}>{waiting} waiting</span>}</h2>
          <button type="button" onClick={onGoDeck} style={pill('#111', '#fff')}>← Back to my deck</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {[['all', 'All'], ['requests', 'Requests'], ['updates', 'Updates']].map(([k, l]) => <button key={k} type="button" onClick={() => setFilter(k)} style={tab(filter === k)}>{l}</button>)}
        </div>

        {rows === null && <div style={{ color: '#8a7a65', fontSize: 13 }}>Loading…</div>}
        {rows && list.length === 0 && (
          <div style={{ background: '#fffefb', border: '1px solid #e9e2d6', borderRadius: 14, padding: 24, textAlign: 'center', color: '#aaa', fontSize: 13 }}>
            Nothing here yet. When someone adds you to a group or to their family, it shows up here.
          </div>
        )}
        {list.map((n) => {
          const isWaiting = n.status === 'pending';
          return (
            <div key={n.id} style={{ background: isWaiting ? '#fff8e1' : '#fffefb', border: `1px solid ${isWaiting ? '#f1dc9a' : '#e9e2d6'}`, borderRadius: 12, padding: '10px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
              {n.from ? <Avatar p={n.from} /> : <span style={{ fontSize: 20 }}>ℹ️</span>}
              <div style={{ flex: 1, minWidth: 170, fontSize: 13, wordBreak: 'break-word' }}>
                <div>{text(n)}</div>
                <div style={{ fontSize: 10, color: '#8a7a65', marginTop: 2 }}>
                  {when(n.created_at)}
                  {n.status === 'accepted' && ' · ✓ You accepted'}
                  {n.status === 'rejected' && ' · ✗ You declined'}
                </div>
              </div>
              {isWaiting && n.from && <button type="button" onClick={() => viewProfile(n.from)} style={pill('#fff', '#1a1a1a')}>View profile</button>}
              {isWaiting && <>
                <button type="button" disabled={busyId === n.id} onClick={() => answer(n, 'accept')} style={pill('#111', '#fff')}>Accept</button>
                <button type="button" disabled={busyId === n.id} onClick={() => answer(n, 'reject')} style={pill('#fff', '#b3261e')}>Reject</button>
              </>}
              {n.status === 'info' && <button type="button" disabled={busyId === n.id} onClick={() => answer(n, 'dismiss')} style={pill('#fff', '#1a1a1a')}>Mark read</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}