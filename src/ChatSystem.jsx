import React, { useState, useEffect, useRef } from 'react';

export default function ChatSystem({ self, allProfiles = [], groups = [], groupMembers = [], onClose }) {
  const currentUserId = localStorage.getItem('userId') || 'ur001';
  const chatUserId = self?.id || currentUserId;
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMsg, setNewMsg] = useState('');
  const [recording, setRecording] = useState(false);
  const [inCall, setInCall] = useState(null);
  const [onlineIds, setOnlineIds] = useState(new Set());
  const [groupCounts, setGroupCounts] = useState({});
  const [myFamily, setMyFamily] = useState([]);
  const [myGroups, setMyGroups] = useState([]); // FIX: login user's groups
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const localVideoRef = useRef(null);

  // FIX 1: always login user's family
  useEffect(() => {
    if(!self?.id) return;
    fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json()).then(data=>{
      if(Array.isArray(data) && data.length>0) setMyFamily(data);
    }).catch(()=>{});
  }, [self?.id, currentUserId]);

  // FIX 2: always login user's groups - this fixes Best Friends bug
  useEffect(() => {
    fetch(`/api/profile-groups?owner_user_id=${currentUserId}`).then(r=>r.json()).then(data=>{
      if(Array.isArray(data) && data.length>0) setMyGroups(data);
      else setMyGroups(groups);
    }).catch(()=> setMyGroups(groups));
  }, [currentUserId]);

  // fetch counts for MY groups, not prop groups
  useEffect(() => {
    const list = myGroups.length>0? myGroups : groups;
    if(!list.length) return;
    list.forEach(async (g)=>{
      try{
        const data = await fetch(`/api/group-members?group_id=${g.id}`).then(r=>r.json()).catch(()=>[]);
        if(Array.isArray(data)){
          setGroupCounts(prev=>({...prev, [g.id]: { total: data.length, members: data }}));
        }
      }catch{}
    });
  }, [myGroups, groups]);

  const baseProfiles = myFamily.length>0? myFamily : allProfiles;
  const baseGroups = myGroups.length>0? myGroups : groups;

  const spouses = baseProfiles.filter(p => p.computed_relation === 'Spouse' || p.relation_label === 'Spouse');
  const father = baseProfiles.find(p => p.computed_relation === 'Father' || p.id === self?.father_id);
  const mother = baseProfiles.find(p => p.computed_relation === 'Mother' || p.id === self?.mother_id);
  const siblings = baseProfiles.filter(p => p.computed_relation === 'Sibling');
  const children = baseProfiles.filter(p => p.computed_relation === 'Child');
  const rawFamily = [...spouses, father, mother,...siblings,...children].filter(Boolean);
  const immediateFamily = Array.from(new Map(rawFamily.map(p=>[p.id,p])).values());

  useEffect(() => {
    if(!self?.id) return;
    const fetchOnline = async () => {
      try {
        const data = await fetch('/api/chatbox/online').then(r=>r.json()).catch(()=>[]);
        if(Array.isArray(data)) setOnlineIds(new Set(data));
      } catch {}
    };
    const heartbeat = () => {
      fetch('/api/chatbox/heartbeat', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({userId: self.id, displayName: self?.display_name || currentUserId})
      }).catch(()=>{});
    };
    fetchOnline(); heartbeat();
    const id1 = setInterval(fetchOnline, 3000);
    const id2 = setInterval(heartbeat, 10000);
    return () => { clearInterval(id1); clearInterval(id2); };
  }, [self?.id]);

  const isOnline = (id) => onlineIds.has(id);
  const stopCamera = () => {
    if (localVideoRef.current?.srcObject) { localVideoRef.current.srcObject.getTracks().forEach(t => t.stop()); localVideoRef.current.srcObject = null; }
    if (mediaRecorderRef.current?.stream) { mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop()); }
    setInCall(null);
  };
  const handleCloseAll = () => { stopCamera(); onClose(); };
  const handleBack = () => { stopCamera(); setActiveChat(null); };
  useEffect(() => { return () => { if (localVideoRef.current?.srcObject) localVideoRef.current.srcObject.getTracks().forEach(t => t.stop()); } }, []);
  useEffect(() => {
    if (!activeChat) return;
    loadMessages();
    const id = setInterval(loadMessages, 2000);
    return () => clearInterval(id);
  }, [activeChat]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const loadMessages = async () => {
    if (!activeChat) return;
    const url = activeChat.type === 'group'? `/api/chat/group/${activeChat.id}` : `/api/chat/direct?user1=${chatUserId}&user2=${activeChat.id}`;
    const data = await fetch(url).then(r => r.json()).catch(() => []);
    setMessages(Array.isArray(data)? data : []);
  };

  const sendNotifyIfOffline = async (toId, textToSend) => {
    if(isOnline(toId)) return;
    await fetch('/api/chatbox/notify', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to_user_id: toId, from_user_id: chatUserId, from_name: self?.display_name || 'Family member', title: `You have chat from ${self?.display_name}`, body: textToSend }) }).catch(()=>{});
  };

  const sendText = async () => {
    if (!newMsg.trim() ||!activeChat) return;
    const textToSend = newMsg;
    const payload = { sender_id: chatUserId, sender_name: self?.display_name, text: textToSend, type: 'text', direct_to: activeChat.type === 'direct'? activeChat.id : null, group_id: activeChat.type === 'group'? activeChat.id : null };
    setNewMsg(''); setMessages(prev => [...prev, payload]);
    await fetch('/api/chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if(activeChat.type === 'direct'){ await sendNotifyIfOffline(activeChat.id, textToSend); }
    else { activeChat.members?.forEach(m=>{ if(m.id!==chatUserId) sendNotifyIfOffline(m.id, textToSend); }); }
  };

  const sendAttachment = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    const up = await fetch(`/api/upload?profileId=${currentUserId}`, { method: 'POST', body: fd }).then(r => r.json());
    const payload = { sender_id: chatUserId, sender_name: self?.display_name, text: up.url, type: file.type.startsWith('image/')? 'image' : 'file', fileName: file.name, direct_to: activeChat.type === 'direct'? activeChat.id : null, group_id: activeChat.type === 'group'? activeChat.id : null };
    setMessages(prev => [...prev, payload]);
    await fetch('/api/chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  };

  const startVoice = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorderRef.current = new MediaRecorder(stream); audioChunksRef.current = [];
    mediaRecorderRef.current.ondataavailable = e => audioChunksRef.current.push(e.data);
    mediaRecorderRef.current.onstop = async () => {
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const fd = new FormData(); fd.append('file', blob, 'voice.webm');
      const up = await fetch(`/api/upload?profileId=${currentUserId}`, { method: 'POST', body: fd }).then(r => r.json());
      const payload = { sender_id: chatUserId, sender_name: self?.display_name, text: up.url, type: 'voice', direct_to: activeChat.type === 'direct'? activeChat.id : null, group_id: activeChat.type === 'group'? activeChat.id : null };
      setMessages(prev => [...prev, payload]);
      await fetch('/api/chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    };
    mediaRecorderRef.current.start(); setRecording(true);
  };
  const stopVoice = () => { mediaRecorderRef.current?.stop(); setRecording(false); };
  useEffect(() => { if (inCall && localVideoRef.current) { navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(s => localVideoRef.current.srcObject = s).catch(()=>{}); } }, [inCall]);

  return (
    <div className="fixed inset-0 md:inset-auto md:bottom-[86px] md:right-4 z-[9999] flex items-end justify-center md:justify-end bg-black/30 md:bg-transparent p-0 md:p-0" style={{fontFamily:'Plus Jakarta Sans'}}>
      <div className="w-full md:w-[360px] h-[78vh] md:h-[520px] max-h-[85vh] bg-[#fffefb] border border-[#e9e2d6] rounded-t-[18px] md:rounded-[14px] shadow-[0_12px_40px_rgba(0,0,0,0.2)] flex flex-col overflow-hidden">
        <div className="h-[52px] bg-[#efe8d3] border-b border-[#e9e2d6] flex items-center justify-between px-4 shrink-0">
          {activeChat? (
            <>
              <div className="flex items-center gap-2">
                <button onClick={handleBack} className="w-7 h-7 bg-white border rounded-full flex items-center justify-center text-[12px]">←</button>
                <div className="relative">
                  {activeChat.photo? <img src={activeChat.photo} className="w-8 h-8 rounded-[6px] object-cover" /> : <div className="w-8 h-8 rounded-[6px] bg-black text-white flex items-center justify-center text-[11px] font-bold">{activeChat.name[0]}</div>}
                  {activeChat.type==='direct' && isOnline(activeChat.id) && <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></span>}
                </div>
                <div><p className="text-[12px] font-extrabold leading-none">{activeChat.name}</p><p className="text-[9px] text-gray-500">{activeChat.type === 'group'? `${activeChat.members?.length||groupCounts[activeChat.id]?.total||0} members` : isOnline(activeChat.id)? 'Online' : 'Offline'}</p></div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => setInCall({type:activeChat.type})} className="w-8 h-8 bg-white border rounded-[6px]">📹</button>
                <button onClick={handleCloseAll} className="w-7 h-7 bg-black text-white rounded-full text-[10px]">✕</button>
              </div>
            </>
          ) : (
            <>
              <h3 className="font-extrabold text-[13px]">Chats</h3>
              <button onClick={handleCloseAll} className="w-7 h-7 bg-black text-white rounded-full text-[10px]">✕</button>
            </>
          )}
        </div>

        {inCall && (
          <div className="absolute inset-0 bg-black z-50 flex flex-col">
            <video ref={localVideoRef} autoPlay muted className="flex-1 w-full object-cover" />
            <div className="h-[90px] bg-[#111] flex items-center justify-center gap-6">
              <button className="w-12 h-12 bg-[#333] rounded-full text-white">🎙️</button>
              <button onClick={stopCamera} className="w-14 h-14 bg-red-600 rounded-full text-white font-bold">✕</button>
              <button className="w-12 h-12 bg-[#333] rounded-full text-white">📹</button>
            </div>
          </div>
        )}

        {!activeChat? (
          <div className="flex-1 overflow-y-auto">
            {immediateFamily.map(p => (
              <div key={p.id} onClick={() => setActiveChat({ type: 'direct', id: p.id, name: p.display_name, photo: p.photo_url })} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#f8f5f0] cursor-pointer">
                <div className="relative">
                  {p.photo_url? <img src={p.photo_url} className="w-9 h-9 rounded-[8px] object-cover" /> : <div className="w-9 h-9 rounded-[8px] bg-[#c9ad83] text-white flex items-center justify-center font-bold text-[12px]">{p.display_name[0]}</div>}
                  {isOnline(p.id) && <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></span>}
                </div>
                <div className="flex-1 min-w-0"><p className="text-[12px] font-bold truncate">{p.display_name} <span className="text-[9px] text-gray-400">{p.computed_relation}</span></p><p className="text-[10px] text-gray-500">{isOnline(p.id)? 'Online' : p.computed_relation}</p></div>
              </div>
            ))}
            <p className="text-[10px] font-bold text-gray-400 px-4 pt-4 pb-1">YOUR GROUPS</p>
            {baseGroups.map(g => {
              const cnt = groupCounts[g.id]?.total?? 0;
              const onlineCnt = groupCounts[g.id]?.members?.filter(m=> isOnline(m.profile_id || m.id)).length?? 0;
              return (
              <div key={g.id} onClick={async () => {
                const data = await fetch(`/api/group-members?group_id=${g.id}`).then(r=>r.json()).catch(()=>[]);
                const mems = data.map(row=> ({ id: row.profile_id || row.id, display_name: row.display_name, photo_url: row.photo_url,...row }));
                setActiveChat({ type: 'group', id: g.id, name: g.name, members: mems });
              }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#f8f5f0] cursor-pointer">
                <div className="w-9 h-9 rounded-[8px] bg-black text-white flex items-center justify-center font-bold text-[11px]">{g.name[0]}</div>
                <div className="flex-1"><p className="text-[12px] font-bold">{g.name}</p><p className="text-[10px] text-gray-500">{cnt} members • {onlineCnt} online</p></div>
              </div>
            )})}
          </div>
        ) : (
          <>
            {activeChat.type === 'group' && (
              <div className="px-3 py-2 bg-[#f8f5f0] border-b flex gap-2 overflow-x-auto">
                {activeChat.members?.map(m => (
                  <div key={m.id} onClick={() => setActiveChat({ type: 'direct', id: m.id, name: m.display_name, photo: m.photo_url })} className="flex flex-col items-center cursor-pointer shrink-0 relative">
                    <div className="relative">
                      {m.photo_url? <img src={m.photo_url} className="w-8 h-8 rounded-full object-cover" /> : <div className="w-8 h-8 rounded-full bg-[#c9ad83] text-white flex items-center justify-center text-[10px] font-bold">{m.display_name?.[0]}</div>}
                      {isOnline(m.id) && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full"></span>}
                    </div>
                    <p className="text-[8px] font-bold mt-1 max-w-[40px] truncate">{m.display_name?.split(' ')[0]}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#fcfaf6]">
              {messages.map((m,i) => {
                const isMe = m.sender_id === chatUserId;
                return <div key={i} className={`flex ${isMe? 'justify-end' : 'justify-start'}`}><div className={`max-w-[72%] px-3 py-2 rounded-[12px] text-[12px] ${isMe? 'bg-black text-white rounded-br-none' : 'bg-white border border-[#e9e2d6] rounded-bl-none'}`}>{m.type==='image'? <img src={m.text} className="rounded-[6px] max-w-[160px]" /> : m.text}</div></div>
              })}
              <div ref={messagesEndRef} />
            </div>
            <div className="p-2 border-t border-[#e9e2d6] flex items-center gap-1.5 bg-white">
              <button onClick={() => fileInputRef.current.click()} className="w-8 h-8 bg-[#f8f5f0] border rounded-[8px]">📎</button>
              <input ref={fileInputRef} type="file" hidden onChange={sendAttachment} />
              <button onMouseDown={startVoice} onMouseUp={stopVoice} onTouchStart={startVoice} onTouchEnd={stopVoice} className={`w-8 h-8 border rounded-[8px] ${recording? 'bg-red-500 text-white animate-pulse' : 'bg-[#f8f5f0]'}`}>🎙️</button>
              <input value={newMsg} onChange={e=>setNewMsg(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendText()} placeholder="Type message..." className="flex-1 h-9 bg-[#f8f5f0] border border-[#e9e2d6] rounded-full px-3 text-[12px]" />
              <button onClick={sendText} className="w-9 h-9 bg-black text-white rounded-full">➤</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}