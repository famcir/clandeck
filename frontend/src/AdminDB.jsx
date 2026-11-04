import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || "https://clandeck-production.up.railway.app";

// File Tree Component
function FileTree({ node, level = 0 }) {
  const [open, setOpen] = useState(level < 2);
  const isFolder = node.type === 'folder';
  return (
    <div style={{ marginLeft: level * 16 }}>
      <div onClick={() => isFolder && setOpen(!open)} style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 0', cursor:isFolder?'pointer':'default', fontFamily:'monospace', fontSize:'13px' }}>
        <span>{isFolder ? (open ? '📂' : '📁') : '📄'}</span>
        <span style={{ fontWeight: isFolder ? 700 : 400, color: isFolder ? '#111' : '#444' }}>{node.name}</span>
        {!isFolder && <span style={{ fontSize:'10px', color:'#999', marginLeft:8 }}>{node.size || ''}</span>}
      </div>
      {isFolder && open && node.children?.map((c,i) => <FileTree key={i} node={c} level={level+1} />)}
    </div>
  );
}

export default function AdminDB() {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState('');
  const [err, setErr] = useState("");
  const [activeTab, setActiveTab] = useState('tables'); // NEW: tables | files
  const [fileStructure, setFileStructure] = useState(null);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // Your existing table fetch
  useEffect(() => {
    fetch(`${API_URL}/api/admin/all-tables`, {
      headers: { "x-admin-key": localStorage.getItem("admin_key") || "clandeck_2026_admin" }
    })
      .then(async r => {
        const text = await r.text();
        try { return JSON.parse(text); } catch { throw new Error(text.slice(0,200)); }
      })
      .then(d => {
        let normalized = d;
        if (d.tables && Array.isArray(d.tables)) {
          const obj = {};
          d.tables.forEach(t => {
            const name = t.name || t;
            obj[name] = { totalCount: t.count || 0, columns: t.columns || [], columnsDetail: [], rows: [] };
          });
          normalized = obj;
        }
        if (normalized.success && normalized.tables) normalized = normalized.tables;
        
        const keys = Object.keys(normalized).filter(k => k !== 'success');
        if (keys.length === 0) throw new Error("No tables found");
        
        setData(normalized);
        setSelected(keys[0]);
      })
      .catch(e => setErr(e.message));
  }, []);

  // NEW: File Structure Fetch
  const loadFileStructure = async () => {
    setLoadingFiles(true);
    try{
      const res = await fetch(`${API_URL}/api/admin/file-structure`, {
        headers: { "x-admin-key": localStorage.getItem("admin_key") || "clandeck_2026_admin" }
      });
      const text = await res.text();
      const json = JSON.parse(text);
      setFileStructure(json);
    }catch(e){
      // Fallback mock until backend endpoint added
      setFileStructure({
        name: 'clandeck-project', type:'folder', children:[
          {name:'frontend', type:'folder', children:[
            {name:'src', type:'folder', children:[
              {name:'App.jsx', type:'file', size:'2.1 KB'},
              {name:'Login.jsx', type:'file', size:'4.3 KB'},
              {name:'Deck.jsx', type:'file', size:'8.9 KB'},
              {name:'ProfileEdit.jsx', type:'file', size:'5.2 KB'},
              {name:'AdminDB.jsx', type:'file', size:'6.1 KB'},
              {name:'components', type:'folder', children:[
                {name:'CommonHeader.jsx', type:'file', size:'3.4 KB'}
              ]}
            ]},
            {name:'vercel.json', type:'file', size:'0.1 KB'},
            {name:'package.json', type:'file', size:'0.8 KB'}
          ]},
          {name:'backend', type:'folder', children:[
            {name:'index.js', type:'file', size:'3.2 KB'},
            {name:'routes', type:'folder', children:[
              {name:'auth.js', type:'file'},
              {name:'profiles.js', type:'file'}
            ]}
          ]},
          {name:'clandeck.sql', type:'file', size:'12 KB'}
        ]
      });
    }
    setLoadingFiles(false);
  };

  useEffect(()=>{ if(activeTab==='files' && !fileStructure) loadFileStructure(); },[activeTab]);

  if(err) return <div style={{padding:20, color:'red'}}>Error: {err}<br/>Check backend {API_URL}/api/admin/all-tables</div>
  if(!data) return <div style={{padding:20}}>Loading... from {API_URL}</div>

  const tables = Object.keys(data);
  const current = data[selected];

  return (
    <div style={{display:'flex', minHeight:'100vh', background:'#f8fafc'}}>
      {/* LEFT BUTTON STACK */}
      <div style={{width:'200px', background:'white', borderRight:'1px solid #e5e7eb', padding:'20px 12px', position:'sticky', top:0, height:'100vh'}}>
        <h3 style={{fontSize:'14px', fontWeight:800, marginBottom:16}}>Admin Panel</h3>
        <div style={{display:'flex', flexDirection:'column', gap:8}}>
          <button onClick={()=>setActiveTab('tables')} style={{textAlign:'left', padding:'10px 12px', borderRadius:'8px', border:'1px solid', borderColor:activeTab==='tables'?'#111':'#e5e7eb', background:activeTab==='tables'?'#111':'white', color:activeTab==='tables'?'white':'#111', fontWeight:700, fontSize:'12px', cursor:'pointer'}}>
            📊 Table Details
          </button>
          <button onClick={()=>setActiveTab('files')} style={{textAlign:'left', padding:'10px 12px', borderRadius:'8px', border:'1px solid', borderColor:activeTab==='files'?'#111':'#e5e7eb', background:activeTab==='files'?'#111':'white', color:activeTab==='files'?'white':'#111', fontWeight:700, fontSize:'12px', cursor:'pointer'}}>
            📁 File Structure
          </button>
        </div>
        <div style={{marginTop:16, fontSize:'10px', color:'#999'}}>Live from server</div>
        <button onClick={()=>window.location.href='/'} style={{marginTop:20, width:'100%', background:'white', border:'1px solid #ccc', padding:'6px 14px', borderRadius:'20px', cursor:'pointer', fontSize:'12px'}}>← Back to Home</button>
      </div>

      {/* RIGHT CONTENT */}
      <div style={{flex:1, padding:'20px', overflow:'auto'}}>
        <div style={{maxWidth:'1100px', margin:'0 auto'}}>
          
          {activeTab==='tables' ? (
            <>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px'}}>
                <h1 style={{fontSize:'28px', fontWeight:'bold'}}>ClanDeck - Tables ({tables.length})</h1>
              </div>

              <div style={{background:'white', padding:'16px', borderRadius:'10px', border:'1px solid #e5e7eb', marginBottom:'20px', display:'flex', gap:'12px', alignItems:'center'}}>
                <label style={{fontWeight:'600'}}>Select Table:</label>
                <select value={selected} onChange={e=>setSelected(e.target.value)} style={{padding:'8px 12px', borderRadius:'8px', border:'1px solid #d1d5db', minWidth:'300px', fontSize:'16px'}}>
                  {tables.map(t => <option key={t} value={t}>{t}  ({data[t]?.totalCount ?? 0} rows)</option>)}
                </select>
              </div>

              {current && (
                <>
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px', marginBottom:'20px'}}>
                    <div style={{background:'white', padding:'16px', borderRadius:'10px', border:'1px solid #e5e7eb'}}>
                      <div style={{fontSize:'12px', color:'#6b7280'}}>TABLE NAME</div>
                      <div style={{fontSize:'20px', fontWeight:'bold'}}>{selected}</div>
                    </div>
                    <div style={{background:'white', padding:'16px', borderRadius:'10px', border:'1px solid #e5e7eb'}}>
                      <div style={{fontSize:'12px', color:'#6b7280'}}>NO. OF FIELDS</div>
                      <div style={{fontSize:'20px', fontWeight:'bold'}}>{current.columnsDetail?.length || current.columns?.length || 0}</div>
                    </div>
                    <div style={{background:'white', padding:'16px', borderRadius:'10px', border:'1px solid #e5e7eb'}}>
                      <div style={{fontSize:'12px', color:'#6b7280'}}>NO. OF DATAS (ROWS)</div>
                      <div style={{fontSize:'20px', fontWeight:'bold', color:'#2563eb'}}>{current.totalCount}</div>
                    </div>
                  </div>

                  <div style={{background:'white', borderRadius:'10px', border:'1px solid #e5e7eb', overflow:'hidden'}}>
                    <div style={{padding:'14px 16px', fontWeight:'bold', background:'#f1f5f9', borderBottom:'1px solid #e5e7eb'}}>Field Details - Columns View</div>
                    <table style={{width:'100%', borderCollapse:'collapse', textAlign:'left'}}>
                      <thead><tr style={{background:'#f8fafc'}}><th style={{padding:'12px', borderBottom:'1px solid #e5e7eb'}}>#</th><th style={{padding:'12px', borderBottom:'1px solid #e5e7eb'}}>Field Name</th><th style={{padding:'12px', borderBottom:'1px solid #e5e7eb'}}>Field Type</th><th style={{padding:'12px', borderBottom:'1px solid #e5e7eb'}}>No. of Datas</th><th style={{padding:'12px', borderBottom:'1px solid #e5e7eb'}}>Null / Key</th></tr></thead>
                      <tbody>{(current.columnsDetail || []).map((col, i) => <tr key={col.Field} style={{borderBottom:'1px solid #f1f5f9'}}><td style={{padding:'12px'}}>{i+1}</td><td style={{padding:'12px', fontFamily:'monospace', fontWeight:'600'}}>{col.Field}</td><td style={{padding:'12px'}}><span style={{background:'#dbeafe', color:'#1e40af', padding:'3px 8px', borderRadius:'12px', fontSize:'12px'}}>{col.Type}</span></td><td style={{padding:'12px', fontWeight:'500'}}>{current.totalCount}</td><td style={{padding:'12px', color:'#6b7280'}}>{col.Null === 'YES' ? 'NULL' : 'NOT NULL'} {col.Key ? `| ${col.Key}` : ''}</td></tr>)}</tbody>
                    </table>
                  </div>

                  {current.rows && current.rows.length > 0 && (
                    <div style={{marginTop:'20px', background:'white', borderRadius:'10px', border:'1px solid #e5e7eb', overflow:'hidden'}}>
                      <div style={{padding:'14px 16px', fontWeight:'bold', background:'#f1f5f9', borderBottom:'1px solid #e5e7eb'}}>Data Preview (First {current.rows.length} rows)</div>
                      <div style={{overflowX:'auto'}}><table style={{width:'100%', borderCollapse:'collapse', textAlign:'left', fontSize:'13px'}}><thead><tr style={{background:'#f8fafc'}}>{current.columns.map(c => <th key={c} style={{padding:'10px', borderBottom:'1px solid #e5e7eb', whiteSpace:'nowrap'}}>{c}</th>)}</tr></thead><tbody>{current.rows.slice(0,10).map((row, ri) => <tr key={ri}>{current.columns.map(c => <td key={c} style={{padding:'10px', borderBottom:'1px solid #f1f5f9', maxWidth:'150px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{String(row[c] ?? '')}</td>)}</tr>)}</tbody></table></div>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px'}}>
                <h1 style={{fontSize:'28px', fontWeight:'bold'}}>Live File Structure</h1>
                <button onClick={loadFileStructure} style={{background:'white', border:'1px solid #ccc', padding:'6px 14px', borderRadius:'20px', cursor:'pointer', fontSize:'12px'}}>{loadingFiles ? 'Loading...' : '🔄 Refresh Live'}</button>
              </div>
              <div style={{background:'white', borderRadius:'10px', border:'1px solid #e5e7eb', padding:'16px', minHeight:'60vh'}}>
                {fileStructure ? <FileTree node={fileStructure} /> : <div>Loading files...</div>}
              </div>
              <div style={{marginTop:12, fontSize:'11px', color:'#888'}}>Add backend endpoint <code>/api/admin/file-structure</code> to make it truly live from Railway.</div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}