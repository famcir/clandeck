import { useState, useEffect } from 'react';

export default function Profile() {
  const [profiles, setProfiles] = useState([]);
  const [editing, setEditing] = useState(null);
  const currentUserId = localStorage.getItem('userId') || 'ur001'; // your logged user

  useEffect(() => {
    fetch(`/api/profiles?owner_user_id=${currentUserId}`)
     .then(r => r.json())
     .then(data => setProfiles(data));
  }, []);

  const saveProfile = async (p) => {
    await fetch(`/api/profiles/${p.id}`, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        display_name: p.display_name,
        relation_label: p.relation_label,
        dob: p.dob || null,
        photo_url: p.photo_url || null,
        is_claimed: p.is_claimed? 1 : 0
      })
    });
    setEditing(null);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6 flex justify-center">
      <div className="w-full max-w-4xl">
        <h1 className="text-3xl font-bold mb-2">My Profiles</h1>
        <p className="text-[#8a8a9a] mb-8">Manage your family profiles - {profiles.length} profiles</p>

        <div className="grid gap-4">
          {profiles.map((p) => (
            <div key={p.id} className="bg-[#15151d] border border-[#252535] rounded-[20px] p-6 flex gap-5 items-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-xl font-bold overflow-hidden">
                {p.photo_url? <img src={p.photo_url} className="w-full h-full object-cover" /> : p.display_name?.[0]}
              </div>

              <div className="flex-1">
                {editing === p.id? (
                  <div className="grid grid-cols-2 gap-3">
                    <input value={p.display_name} onChange={e=> setProfiles(profiles.map(x=> x.id===p.id? {...x, display_name:e.target.value}:x))} className="p-2.5 bg-[#1e1e2a] border border-[#2a2a3a] rounded-xl" placeholder="Display Name" />
                    <input value={p.relation_label} onChange={e=> setProfiles(profiles.map(x=> x.id===p.id? {...x, relation_label:e.target.value}:x))} className="p-2.5 bg-[#1e1e2a] border border-[#2a2a3a] rounded-xl" placeholder="Relation: Self, Father, Mother..." />
                    <input type="date" value={p.dob || ''} onChange={e=> setProfiles(profiles.map(x=> x.id===p.id? {...x, dob:e.target.value}:x))} className="p-2.5 bg-[#1e1e2a] border border-[#2a2a3a] rounded-xl" />
                    <input value={p.photo_url || ''} onChange={e=> setProfiles(profiles.map(x=> x.id===p.id? {...x, photo_url:e.target.value}:x))} className="p-2.5 bg-[#1e1e2a] border border-[#2a2a3a] rounded-xl" placeholder="Photo URL" />
                  </div>
                ) : (
                  <>
                    <h3 className="font-bold text-lg">{p.display_name} <span className="text-xs px-2 py-1 bg-[#1e1e2a] rounded-full text-[#8a8a9a] ml-2">{p.relation_label}</span></h3>
                    <p className="text-sm text-[#8a8a9a] mt-1">ID: {p.id} • Claimed: {p.is_claimed? 'Yes ✅' : 'No'} • DOB: {p.dob || 'Not set'}</p>
                  </>
                )}
              </div>

              <div className="flex gap-2">
                {editing === p.id? (
                  <>
                    <button onClick={()=> saveProfile(p)} className="px-4 py-2 bg-violet-600 rounded-xl font-bold">Save</button>
                    <button onClick={()=> setEditing(null)} className="px-4 py-2 bg-[#1e1e2a] rounded-xl">Cancel</button>
                  </>
                ) : (
                  <button onClick={()=> setEditing(p.id)} className="px-4 py-2 bg-white text-black rounded-xl font-bold">Edit</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}