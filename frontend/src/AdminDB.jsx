import { useEffect, useState, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || "https://clandeck-production.up.railway.app";

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

function buildLocalTree(files){
  const root = { name: 'Local Folder', type:'folder', children:[], rootPath:'', fullPath:'' };
  const map = {'': root};
  let firstPath = '';
  for(let f of files){
    if(!firstPath) firstPath = f.webkitRelativePath;
    const parts = f.webkitRelativePath.split('/');
    let curPath = '';
    for(let i=0;i<parts.length;i++){
      const part = parts[i];
      const isFile = i===parts.length-1;
      const parentPath = curPath;
      curPath = curPath ? curPath + '/' + part : part;
      if(!map[curPath]){
        const node = isFile ? { name: part, type:'file', size:`${(f.size/1024).toFixed(1)} KB` } : { name: part, type:'folder', children:[] };
        map[curPath] = node;
        map[parentPath].children.push(node);
      }
    }
  }
  const finalTree = root.children[0] || root;
  finalTree.rootPath = firstPath ? firstPath.split('/')[0] : 'Local';
  finalTree.fullPath = firstPath;
  return finalTree;
}

export default function AdminDB() {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState('');
  const [err, setErr] = useState("");
  const [activeTab, setActiveTab] = useState('tables');
  const [fileStructure, setFileStructure] = useState(null);
  const [localFileStructure, setLocalFileStructure] = useState(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const folderInputRef = useRef(null);

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
          d.tables.forEach(t => { const name = t.name || t; obj[name] = { totalCount: t.count || 0, columns: t.columns || [], columnsDetail: [], rows: [] }; });
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

  const loadFileStructure = async () => {
    setLoadingFiles(true);
    try{
      const res = await fetch(`${API_URL}/api/admin/file-structure`, { headers: { "x-admin-key": localStorage.getItem("admin_key") || "clandeck_2026_admin" } });
      const json = await res.json();
      setFileStructure(json);
    }catch(e){
      setFileStructure({ name: 'clandeck-project', type:'folder', rootPath: '/app (fallback)', children:[
        {name:'frontend', type:'folder', children:[{name:'src', type:'folder', children:[{name:'App.jsx', type:'file'}]}]},
        {name:'backend', type:'folder', children:[{name:'server.js', type:'file'}]}
      ]});
    }
    setLoadingFiles(false);
  };

  const loadLocalFileStructure = async () => {
    setLoadingFiles(true);
    try{
      let res = null;
      try{ res = await fetch(`http://localhost:3000/api/admin/local-file-structure`, { headers: { "x-admin-key": localStorage.getItem("admin_key") || "clandeck_2026_admin" } }); }catch{}
      if(!res || !res.ok){
        res = await fetch(`${API_URL}/api/admin/local-file-structure`, { headers: { "x-admin-key": localStorage.getItem("admin_key") || "clandeck_2026_admin" } });
      }
      const json = await res.json();
      setLocalFileStructure(json);
    }catch(e){
      setLocalFileStructure({ name: 'No local API - Pick folder below', type:'folder', children:[], rootPath: 'Not connected', needPicker:true });
    }
    setLoadingFiles(false);
  };

  const handleLocalFolderPick = (e) => {
    const files = e.target.files;
    if(!files || files.length===0) return;
    const tree = buildLocalTree(files);
    tree.name = tree.name + ' (Local Picked)';
    setLocalFileStructure(tree);
  };

  useEffect(()=>{ if(activeTab==='files' && !fileStructure) loadFileStructure(); },[activeTab]);
  useEffect(()=>{ if(activeTab==='local' && !localFileStructure) loadLocalFileStructure(); },[activeTab]);

  if(err) return <div style={{padding:20, color:'red'}}>Error: {err}<br/>Check backend {API_URL}/api/admin/all-tables</div>
  if(!data) return <div style={{padding:20}}>Loading... from {API_URL}</div>

  const tables = Object.keys(data);
  const current = data[selected];

  const btnStyle = (isActive) => ({
    textAlign:'left', padding:'10px 12px', borderRadius:'8px', border:'1px solid', borderColor:isActive?'#111':'#e5e7eb',
    background:isActive?'#111':'white', color:isActive?'white':'#111', fontWeight:700, fontSize:'12px', cursor:'pointer'
  });

  return (
    <div style={{display:'flex', minHeight:'100vh', background:'#f8fafc'}}>
      <div style={{width:'210px', background:'white', borderRight:'1px solid #e5e7eb', padding:'20px 12px', position:'sticky', top:0, height:'100vh', overflowY:'auto'}}>
        <h3 style={{fontSize:'14px', fontWeight:800, marginBottom:16}}>Admin Panel</h3>
        <div style={{display:'flex', flexDirection:'column', gap:8}}>
          <button onClick={()=>setActiveTab('tables')} style={btnStyle(activeTab==='tables')}>📊 Table Details</button>
          <button onClick={()=>setActiveTab('files')} style={btnStyle(activeTab==='files')}>📁 File Structure</button>
          <button onClick={()=>{setActiveTab('local'); if(!localFileStructure) loadLocalFileStructure();}} style={btnStyle(activeTab==='local')}>💻 Local File Structure</button>
        </div>
        <div style={{marginTop:16, fontSize:'10px', color:'#999'}}>Deployed vs Local</div>
        <button onClick={()=>window.location.href='/'} style={{marginTop:20, width:'100%', background:'white', border:'1px solid #ccc', padding:'6px 14px', borderRadius:'20px', cursor:'pointer', fontSize:'12px'}}>← Back to Home</button>
      </div>

      <div style={{flex:1, padding:'20px', overflow:'auto'}}>
        <div style={{maxWidth:'1100px', margin:'0 auto'}}>
          
          {activeTab==='tables' && (
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
                    <div style={{background:'white', padding:'16px', borderRadius:'10px', border:'1px solid #e5e7eb'}}><div style={{fontSize:'12px', color:'#6b7280'}}>TABLE NAME</div><div style={{fontSize:'20px', fontWeight:'bold'}}>{selected}</div></div>
                    <div style={{background:'white', padding:'16px', borderRadius:'10px', border:'1px solid #e5e7eb'}}><div style={{fontSize:'12px', color:'#6b7280'}}>NO. OF FIELDS</div><div style={{fontSize:'20px', fontWeight:'bold'}}>{current.columnsDetail?.length || current.columns?.length || 0}</div></div>
                    <div style={{background:'white', padding:'16px', borderRadius:'10px', border:'1px solid #e5e7eb'}}><div style={{fontSize:'12px', color:'#6b7280'}}>NO. OF DATAS (ROWS)</div><div style={{fontSize:'20px', fontWeight:'bold', color:'#2563eb'}}>{current.totalCount}</div></div>
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
          )}

          {activeTab==='files' && (
            <>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px'}}>
                <h1 style={{fontSize:'28px', fontWeight:'bold'}}>File Structure (Deployed - Railway)</h1>
                <button onClick={loadFileStructure} style={{background:'white', border:'1px solid #ccc', padding:'6px 14px', borderRadius:'20px', cursor:'pointer', fontSize:'12px'}}>{loadingFiles ? 'Loading...' : '🔄 Refresh Live'}</button>
              </div>
              <div style={{marginBottom:'16px', background:'#f1f5f9', border:'1px solid #e5e7eb', borderRadius:'8px', padding:'10px 14px', display:'flex', alignItems:'center', gap:8}}>
                <span style={{fontSize:'12px', fontWeight:700, color:'#6b7280'}}>📍 Path:</span>
                <span style={{fontFamily:'monospace', fontSize:'12px', color:'#111', fontWeight:600}}>{fileStructure?.rootPath || fileStructure?.name || '/app (Deployed)'}</span>
              </div>
              <div style={{background:'white', borderRadius:'10px', border:'1px solid #e5e7eb', padding:'16px', minHeight:'60vh'}}>
                {fileStructure ? <FileTree node={fileStructure} /> : <div>Loading files...</div>}
              </div>
            </>
          )}

          {activeTab==='local' && (
            <>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap'}}>
                <h1 style={{fontSize:'28px', fontWeight:'bold'}}>Local File Structure (Laptop)</h1>
                <div style={{display:'flex', gap:8}}>
                  <button onClick={loadLocalFileStructure} style={{background:'white', border:'1px solid #ccc', padding:'6px 14px', borderRadius:'20px', cursor:'pointer', fontSize:'12px'}}>{loadingFiles ? 'Loading...' : '🔄 Refresh from API'}</button>
                  <button onClick={()=>folderInputRef.current?.click()} style={{background:'#111', color:'white', border:'1px solid #111', padding:'6px 14px', borderRadius:'20px', cursor:'pointer', fontSize:'12px'}}>📂 Choose Local Folder</button>
                </div>
              </div>

              {/* PATH JUST BELOW TITLE - REQUIRED */}
              <div style={{marginTop:'10px', marginBottom:'16px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:'8px', padding:'10px 14px', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                <span style={{fontSize:'12px', fontWeight:800, color:'#92400e', whiteSpace:'nowrap'}}>📍 Path:</span>
                <span style={{fontFamily:'monospace', fontSize:'13px', color:'#111', fontWeight:700, wordBreak:'break-all'}}>
                  {localFileStructure?.rootPath || localFileStructure?.fullPath || localFileStructure?.name || 'Not loaded - Click Choose Local Folder or Refresh from API'}
                </span>
                <button onClick={()=>{const p=localFileStructure?.rootPath||localFileStructure?.fullPath||''; if(p) navigator.clipboard.writeText(p)}} style={{marginLeft:'auto', fontSize:'10px', background:'white', border:'1px solid #fcd34d', borderRadius:'6px', padding:'4px 8px', cursor:'pointer'}}>Copy</button>
              </div>

              <input ref={folderInputRef} type="file" webkitdirectory="true" directory="" multiple style={{display:'none'}} onChange={handleLocalFolderPick} />
              <div style={{background:'white', borderRadius:'10px', border:'1px solid #e5e7eb', padding:'16px', minHeight:'60vh'}}>
                {localFileStructure ? <FileTree node={localFileStructure} /> : <div>Click "Choose Local Folder" to pick your clandeck-project folder from laptop, or Refresh from API if running locally.</div>}
              </div>
              <div style={{marginTop:12, fontSize:'11px', color:'#888'}}>Local picker works 100% offline in browser. API method works when you run <code>node server.js</code> on localhost:3000</div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}