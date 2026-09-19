import React, { useState, useEffect } from 'react';
import logo from './assets/clandeck_h.png';

export default function Deck({ onGoProfile, onLogout }) {
  const currentUserId = localStorage.getItem('userId') || 'ur001';
  const [profiles, setProfiles] = useState([]);
  const [self, setSelf] = useState(null);

  useEffect(() => {
    fetch(`/api/profiles?owner_user_id=${currentUserId}`)
     .then(r => r.json())
     .then(data => {
        setProfiles(data || []);
        const me = data?.find(p => p.id === currentUserId) || data?.find(p => p.relation_label?.toLowerCase() === 'self') || data?.[0];
        setSelf(me);
      });
  }, [currentUserId]);

  const get = (label) => profiles.find(p => p.relation_label?.toLowerCase() === label.toLowerCase());
  const getAll = (label) => profiles.filter(p => p.relation_label?.toLowerCase() === label.toLowerCase());

  const father = get('Father');
  const mother = get('Mother');
  const spouse = get('Spouse');
  const siblings = getAll('Sibling');
  const children = getAll('Child');

  const Node = ({ p, big }) => {
    if (!p) return <div className="w-[62px] h-[62px] bg-[#f8f5f0] rounded-[16px] border border-dashed flex items-center justify-center text-[20px] text-gray-300">+</div>;
    return (
      <div className="flex flex-col items-center">
        <div className={`${big? 'w-[72px] h-[72px] bg-[#c9ad83] text-white text-[24px]' : 'w-[62px] h-[62px] bg-[#f8f5f0] text-[22px]'} rounded-[16px] border flex items-center justify-center overflow-hidden shadow-sm`}>
          {p.photo_url? <img src={p.photo_url} className="w-full h-full object-cover" /> : p.display_name?.[0]}
        </div>
        <p className="text-[11px] font-bold mt-1 text-center leading-none">{p.display_name}</p>
        <p className="text-[9px] text-gray-500">{p.relation_label}</p>
      </div>
    );
  };

  return (
    <div className="min-h-screen w-full bg-[#f2efe8]" style={{ fontFamily: 'Plus Jakarta Sans' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&display=swap');.card{background:#fffefb;border:1px solid #e9e2d6;border-radius:28px}`}</style>

      {/* HEADER - same as Profile.jsx */}
      <header className="h-[68px] bg-[#fffefb] border-b border-[#e9e2d6] flex items-center px-6 justify-between sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <img src={logo} alt="Clandeck" className="h-[60px] w-auto object-contain" />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onLogout} className="px-5 h-9 bg-black text-white rounded-full text-[12px] font-bold">Logout</button>
          <img
            src={self?.photo_url}
            onClick={onGoProfile}
            className="w-9 h-9 rounded-full object-cover cursor-pointer border-2 border-[#c9ad83]"
            alt="profile"
            title="Go to Profile"
          />
        </div>
      </header>

      <div className="p-4 grid grid-cols-12 gap-4 max-w-[1400px] mx-auto">

        {/* LEFT - My Family Tree */}
        <div className="col-span-12 lg:col-span-8 card p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-extrabold text-[18px]">My Family Tree</h2>
            <span className="text-[11px] bg-[#f2efe8] px-3 py-1 rounded-full font-bold">{profiles.length} Members</span>
          </div>

          <div className="relative mx-auto" style={{ width: '540px', maxWidth: '100%', height: '440px' }}>
            {/* Parents */}
            <div className="absolute" style={{ left: '130px', top: '0' }}><Node p={father} /></div>
            <div className="absolute" style={{ left: '250px', top: '0' }}><Node p={mother} /></div>

            {/* You in center */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10"><Node p={self} big /></div>

            {/* Siblings */}
            <div className="absolute flex gap-2" style={{ left: '340px', top: '40px' }}>{siblings.length? siblings.map(s => <Node key={s.id} p={s} />) : <Node />}</div>

            {/* Spouse */}
            <div className="absolute" style={{ left: '60px', top: '180px' }}><Node p={spouse} /></div>

            {/* Children */}
            <div className="absolute flex gap-3" style={{ left: '110px', top: '310px' }}>{children.length? children.map(c => <Node key={c.id} p={c} />) : <><Node /><Node /></>}</div>

            {/* Lines - simple */}
            <div className="absolute top-[70px] left-[160px] w-[120px] h-[1px] bg-[#e9e2d6]"></div>
          </div>

          <div className="mt-4 flex gap-2">
            <button onClick={onGoProfile} className="px-5 py-2.5 bg-black text-white rounded-full text-[12px] font-bold">Manage Tree</button>
            <button className="px-5 py-2.5 bg-[#f8f5f0] border border-[#e9e2d6] rounded-full text-[12px] font-bold">Share Tree</button>
          </div>
        </div>

        {/* RIGHT - Stack */}
        <div className="col-span-12 lg:col-span-4 space-y-4">

          {/* My Points */}
          <div className="card p-5 bg-gradient-to-br from-[#fffefb] to-[#f8f5f0]">
            <h3 className="font-extrabold text-[13px] mb-3">My Points</h3>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[28px] font-extrabold leading-none">1,240</p>
                <p className="text-[11px] text-gray-500 mt-1">Clandeck Score</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-bold bg-[#c9ad83] text-white px-3 py-1 rounded-full">Level 4</p>
                <p className="text-[10px] text-gray-500 mt-1">+80 this week</p>
              </div>
            </div>
            <div className="mt-4 h-2 bg-[#f2efe8] rounded-full overflow-hidden">
              <div className="h-full bg-black w-[68%] rounded-full"></div>
            </div>
          </div>

          {/* My Groups */}
          <div className="card p-5">
            <h3 className="font-extrabold text-[13px] mb-3">My Groups</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-[#f8f5f0] p-3 rounded-xl">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-black text-white rounded-lg flex items-center justify-center text-[14px]">👨‍👩‍👧</div>
                  <div><p className="text-[12px] font-bold">Menon Family</p><p className="text-[10px] text-gray-500">8 members</p></div>
                </div>
                <span className="text-[10px] bg-white border px-2 py-1 rounded-full">Active</span>
              </div>
              <div className="flex items-center justify-between bg-[#f8f5f0] p-3 rounded-xl">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-[#c9ad83] text-white rounded-lg flex items-center justify-center text-[14px]">🏠</div>
                  <div><p className="text-[12px] font-bold">Paternal Side</p><p className="text-[10px] text-gray-500">12 members</p></div>
                </div>
                <span className="text-[10px] bg-white border px-2 py-1 rounded-full">New</span>
              </div>
            </div>
            <button className="w-full mt-4 h-9 bg-[#f2efe8] rounded-full text-[11px] font-bold">+ Create Group</button>
          </div>

          {/* Notification Wall */}
          <div className="card p-5">
            <h3 className="font-extrabold text-[13px] mb-3">Notification Wall</h3>
            <div className="space-y-3 text-[11px]">
              <div className="flex gap-2">
                <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center text-[12px]">✅</div>
                <p><b>{self?.display_name || 'You'}</b> added a new photo<br/><span className="text-[10px] text-gray-500">2h ago</span></p>
              </div>
              <div className="flex gap-2">
                <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-[12px]">👤</div>
                <p><b>{father?.display_name || 'Father'}</b> profile updated<br/><span className="text-[10px] text-gray-500">5h ago</span></p>
              </div>
              <div className="flex gap-2">
                <div className="w-6 h-6 bg-yellow-100 rounded-full flex items-center justify-center text-[12px]">🎉</div>
                <p>Family reunion reminder: Dec 25<br/><span className="text-[10px] text-gray-500">1d ago</span></p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}