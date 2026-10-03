import React, { useState, useEffect, useRef } from 'react';

export default function ChatSystem({ self, allProfiles = [], groups = [], groupMembers = [], onClose }) {
  const currentUserId = localStorage.getItem('userId') || 'ur001';
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMsg, setNewMsg] = useState('');
  const [recording, setRecording] = useState(false);
  const [inCall, setInCall] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const localVideoRef = useRef(null);

  const father = allProfiles.find(p => p.id === self?.father_id);
  const mother = allProfiles.find(p => p.id === self?.mother_id);
  const siblings = allProfiles.filter(p => p.id!== self?.id && self?.father_id && p.father_id === self?.father_id);
  const children = allProfiles.filter(p => p.father_id === self?.id || p.mother_id === self?.id);
  const immediateFamily = [father, mother,...siblings,...children].filter(Boolean);

  // --- CAMERA CLOSE FIX ---
  const stopCamera = () => {
    if (localVideoRef.current?.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach(t => t.stop());
      localVideoRef.current.srcObject = null;
    }
    if (mediaRecorderRef.current?.stream) {
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    setInCall(null);
  };
  const handleCloseAll = () => {
    stopCamera();
    onClose();
  };
  const handleBack = () => {
    stopCamera();
    setActiveChat(null);
  };
  // auto-stop on unmount
  useEffect(() => {
    return () => {
      if (localVideoRef.current?.srcObject) {
        localVideoRef.current.srcObject.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!activeChat) return;
    loadMessages();
    const id = setInterval(loadMessages, 2500);
    return () => clearInterval(id);
  }, [activeChat]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const loadMessages = async () => {
    if (!activeChat) return;
    const url = activeChat.type === 'group'
    ? `/api/chat/group/${activeChat.id}`
      : `/api/chat/direct?user1=${currentUserId}&user2=${activeChat.id}`;
    const data = await fetch(url).then(r => r.json()).catch(() => []);
    setMessages(Array.isArray(data)? data : []);
  };

  const sendText = async () => {
    if (!newMsg.trim() ||!activeChat) return;
    const payload = { sender_id: currentUserId, sender_name: self?.display_name, text: newMsg, type: 'text', direct_to: activeChat.type === 'direct'? activeChat.id : null, group_id: activeChat.type === 'group'? activeChat.id : null };
    setNewMsg(''); setMessages(prev => [...prev, payload]);
    await fetch('/api/chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  };

  const sendAttachment = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    const up = await fetch(`/api/upload?profileId=${currentUserId}`, { method: 'POST', body: fd }).then(r => r.json());
    const payload = { sender_id: currentUserId, sender_name: self?.display_name, text: up.url, type: file.type.startsWith('image/')? 'image' : 'file', fileName: file.name, direct_to: activeChat.type === 'direct'? activeChat.id : null, group_id: activeChat.type === 'group'? activeChat.id : null };
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
      const payload = { sender_id: currentUserId, sender_name: self?.display_name, text: up.url, type: 'voice', direct_to: activeChat.type === 'direct'? activeChat.id : null, group_id: activeChat.type === 'group'? activeChat.id : null };
      setMessages(prev => [...prev, payload]);
      await fetch('/api/chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    };
    mediaRecorderRef.current.start(); setRecording(true);
  };
  const stopVoice = () => { mediaRecorderRef.current?.stop(); setRecording(false); };

  useEffect(() => {
    if (inCall && localVideoRef.current) {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(s => localVideoRef.current.srcObject = s).catch(()=>{});
    }
  }, [inCall]);

  return (
    <div className="fixed bottom-[86px] right-4 z-[100] flex gap-3 items-end" style={{fontFamily:'Plus Jakarta Sans'}}>
      <div className="w-[360px] h-[520px] bg-[#fffefb] border border-[#e9e2d6] rounded-[14px] shadow-[0_12px_40px_rgba(0,0,0,0.2)] flex flex-col overflow-hidden">

        {/* HEADER */}
        <div className="h-[52px] bg-[#efe8d3] border-b border-[#e9e2d6] flex items-center justify-between px-4 shrink-0">
          {activeChat? (
            <>
              <div className="flex items-center gap-2">
                <button onClick={handleBack} className="w-7 h-7 bg-white border rounded-full flex items-center justify-center text-[12px]">←</button>
                {activeChat.photo? <img src={activeChat.photo} className="w-8 h-8 rounded-[6px] object-cover" /> : <div className="w-8 h-8 rounded-[6px] bg-black text-white flex items-center justify-center text-[11px] font-bold">{activeChat.name[0]}</div>}
                <div><p className="text-[12px] font-extrabold leading-none">{activeChat.name}</p><p className="text-[9px] text-gray-500">{activeChat.type === 'group'? `${activeChat.members?.length||0} members` : 'Tap for call'}</p></div>
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

        {/* CALL UI */}
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
            <p className="text-[10px] font-bold text-gray-400 px-4 pt-3 pb-1">IMMEDIATE FAMILY</p>
            {immediateFamily.length===0 && <p className="text-[11px] text-gray-400 px-4 py-2">No family yet</p>}
            {immediateFamily.map(p => (
              <div key={p.id} onClick={() => setActiveChat({ type: 'direct', id: p.id, name: p.display_name, photo: p.photo_url })} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#f8f5f0] cursor-pointer">
                {p.photo_url? <img src={p.photo_url} className="w-9 h-9 rounded-[8px] object-cover" /> : <div className="w-9 h-9 rounded-[8px] bg-[#c9ad83] text-white flex items-center justify-center font-bold text-[12px]">{p.display_name[0]}</div>}
                <div className="flex-1 min-w-0"><p className="text-[12px] font-bold truncate">{p.display_name}</p><p className="text-[10px] text-gray-500 truncate">Click for 1-1 chat, video call</p></div>
              </div>
            ))}
            <p className="text-[10px] font-bold text-gray-400 px-4 pt-4 pb-1">YOUR GROUPS</p>
            {groups.map(g => (
              <div key={g.id} onClick={() => {
                const mems = groupMembers.filter(gm => gm.group_id === g.id).map(gm => allProfiles.find(p => p.id === (gm.profile_id || gm.id))).filter(Boolean);
                setActiveChat({ type: 'group', id: g.id, name: g.name, members: mems });
              }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#f8f5f0] cursor-pointer">
                <div className="w-9 h-9 rounded-[8px] bg-black text-white flex items-center justify-center font-bold text-[11px]">{g.name[0]}</div>
                <div className="flex-1"><p className="text-[12px] font-bold">{g.name}</p><p className="text-[10px] text-gray-500">{groupMembers.filter(gm => gm.group_id === g.id).length} members</p></div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {activeChat.type === 'group' && (
              <div className="px-3 py-2 bg-[#f8f5f0] border-b flex gap-2 overflow-x-auto">
                {activeChat.members?.map(m => (
                  <div key={m.id} onClick={() => setActiveChat({ type: 'direct', id: m.id, name: m.display_name, photo: m.photo_url })} className="flex flex-col items-center cursor-pointer shrink-0">
                    {m.photo_url? <img src={m.photo_url} className="w-8 h-8 rounded-full object-cover" /> : <div className="w-8 h-8 rounded-full bg-[#c9ad83] text-white flex items-center justify-center text-[10px] font-bold">{m.display_name[0]}</div>}
                    <p className="text-[8px] font-bold mt-1 max-w-[40px] truncate">{m.display_name.split(' ')[0]}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#fcfaf6]">
              {messages.map((m,i) => {
                const isMe = m.sender_id === currentUserId;
                return <div key={i} className={`flex ${isMe? 'justify-end' : 'justify-start'}`}><div className={`max-w-[72%] px-3 py-2 rounded-[12px] text-[12px] ${isMe? 'bg-black text-white rounded-br-none' : 'bg-white border border-[#e9e2d6] rounded-bl-none'}`}>{m.type==='image'? <img src={m.text} className="rounded-[6px] max-w-[160px]" /> : m.type==='file'? <a href={m.text} target="_blank" className="underline">📎 {m.fileName}</a> : m.type==='voice'? <audio controls src={m.text} className="w-[160px]" /> : m.text}</div></div>
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