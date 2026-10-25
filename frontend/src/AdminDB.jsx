import { useEffect, useState } from 'react';

export default function AdminDB() {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState('');
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch('http://localhost:8080/api/admin/all-tables')
      .then(r => {
        if(!r.ok) throw new Error("API "+r.status);
        return r.json();
      })
      .then(d => {
        console.log("DATA:", d);
        setData(d);
        const firstTable = Object.keys(d)[0];
        if(firstTable) setSelected(firstTable);
      })
      .catch(e => setErr(e.message));
  }, []);

  if(err) return <div style={{padding:20, color:'red'}}>Error: {err}<br/>Check backend is running on 8080</div>
  if(!data) return <div style={{padding:20}}>Loading... Check backend http://localhost:8080/api/admin/all-tables</div>

  const tables = Object.keys(data);
  const current = data[selected];

  return (
    <div style={{minHeight:'100vh', background:'#f8fafc', padding:'20px'}}>
      <div style={{maxWidth:'1100px', margin:'0 auto'}}>
        
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px'}}>
          <h1 style={{fontSize:'28px', fontWeight:'bold'}}>ClanDeck - Tables ({tables.length})</h1>
          <button onClick={()=>window.location.href='/'} style={{background:'white', border:'1px solid #ccc', padding:'6px 14px', borderRadius:'6px', cursor:'pointer'}}>← Back to Home</button>
        </div>

        {/* Dropdown */}
        <div style={{background:'white', padding:'16px', borderRadius:'10px', border:'1px solid #e5e7eb', marginBottom:'20px', display:'flex', gap:'12px', alignItems:'center'}}>
          <label style={{fontWeight:'600'}}>Select Table:</label>
          <select 
            value={selected} 
            onChange={e=>setSelected(e.target.value)}
            style={{padding:'8px 12px', borderRadius:'8px', border:'1px solid #d1d5db', minWidth:'300px', fontSize:'16px'}}
          >
            {tables.map(t => (
              <option key={t} value={t}>{t}  ({data[t].totalCount} rows)</option>
            ))}
          </select>
        </div>

        {current && (
          <>
            {/* Stats Columns */}
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px', marginBottom:'20px'}}>
              <div style={{background:'white', padding:'16px', borderRadius:'10px', border:'1px solid #e5e7eb'}}>
                <div style={{fontSize:'12px', color:'#6b7280'}}>TABLE NAME</div>
                <div style={{fontSize:'20px', fontWeight:'bold'}}>{selected}</div>
              </div>
              <div style={{background:'white', padding:'16px', borderRadius:'10px', border:'1px solid #e5e7eb'}}>
                <div style={{fontSize:'12px', color:'#6b7280'}}>NO. OF FIELDS</div>
                <div style={{fontSize:'20px', fontWeight:'bold'}}>{current.columnsDetail.length}</div>
              </div>
              <div style={{background:'white', padding:'16px', borderRadius:'10px', border:'1px solid #e5e7eb'}}>
                <div style={{fontSize:'12px', color:'#6b7280'}}>NO. OF DATAS (ROWS)</div>
                <div style={{fontSize:'20px', fontWeight:'bold', color:'#2563eb'}}>{current.totalCount}</div>
              </div>
            </div>

            {/* Field Details Table */}
            <div style={{background:'white', borderRadius:'10px', border:'1px solid #e5e7eb', overflow:'hidden'}}>
              <div style={{padding:'14px 16px', fontWeight:'bold', background:'#f1f5f9', borderBottom:'1px solid #e5e7eb'}}>
                Field Details - Columns View
              </div>
              <table style={{width:'100%', borderCollapse:'collapse', textAlign:'left'}}>
                <thead>
                  <tr style={{background:'#f8fafc'}}>
                    <th style={{padding:'12px', borderBottom:'1px solid #e5e7eb'}}>#</th>
                    <th style={{padding:'12px', borderBottom:'1px solid #e5e7eb'}}>Field Name</th>
                    <th style={{padding:'12px', borderBottom:'1px solid #e5e7eb'}}>Field Type</th>
                    <th style={{padding:'12px', borderBottom:'1px solid #e5e7eb'}}>No. of Datas</th>
                    <th style={{padding:'12px', borderBottom:'1px solid #e5e7eb'}}>Null / Key</th>
                  </tr>
                </thead>
                <tbody>
                  {current.columnsDetail.map((col, i) => (
                    <tr key={col.Field} style={{borderBottom:'1px solid #f1f5f9'}}>
                      <td style={{padding:'12px'}}>{i+1}</td>
                      <td style={{padding:'12px', fontFamily:'monospace', fontWeight:'600'}}>{col.Field}</td>
                      <td style={{padding:'12px'}}><span style={{background:'#dbeafe', color:'#1e40af', padding:'3px 8px', borderRadius:'12px', fontSize:'12px'}}>{col.Type}</span></td>
                      <td style={{padding:'12px', fontWeight:'500'}}>{current.totalCount}</td>
                      <td style={{padding:'12px', color:'#6b7280'}}>{col.Null === 'YES' ? 'NULL' : 'NOT NULL'} {col.Key ? `| ${col.Key}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Data Preview - optional */}
            {current.rows.length > 0 && (
              <div style={{marginTop:'20px', background:'white', borderRadius:'10px', border:'1px solid #e5e7eb', overflow:'hidden'}}>
                <div style={{padding:'14px 16px', fontWeight:'bold', background:'#f1f5f9', borderBottom:'1px solid #e5e7eb'}}>
                  Data Preview (First {current.rows.length} rows)
                </div>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%', borderCollapse:'collapse', textAlign:'left', fontSize:'13px'}}>
                    <thead>
                      <tr style={{background:'#f8fafc'}}>
                        {current.columns.map(c => <th key={c} style={{padding:'10px', borderBottom:'1px solid #e5e7eb', whiteSpace:'nowrap'}}>{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {current.rows.slice(0,10).map((row, ri) => (
                        <tr key={ri}>
                          {current.columns.map(c => <td key={c} style={{padding:'10px', borderBottom:'1px solid #f1f5f9', maxWidth:'150px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{String(row[c] ?? '')}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </>
        )}
      </div>
    </div>
  )
}