import { useState, useEffect, useMemo, useRef } from 'react'
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, query, orderBy
} from 'firebase/firestore'
import { db } from './firebase.js'

// ─── Constants ────────────────────────────────────────────────────────────
const ETAPAS   = ['Investigado','Conectado','Conversación','Propuesta','Negociación','Cerrado-Ganado','Cerrado-Perdido']
const FUENTES  = ['LinkedIn','Flete.com','Referido','Cold Email','Evento','Otro']
const META_MES = 50000

const PERIODOS = [
  { key:'hoy',       label:'Hoy' },
  { key:'semana',    label:'Esta semana' },
  { key:'mes',       label:'Este mes' },
  { key:'trimestre', label:'Trimestre' },
  { key:'anual',     label:'Este año' },
  { key:'todo',      label:'Todo' },
]

const ETAPA_COLOR = {
  'Investigado':     { bg:'rgba(55,138,221,0.15)',  text:'#85B7EB',  dot:'#378ADD' },
  'Conectado':       { bg:'rgba(255,255,255,0.07)', text:'rgba(232,240,235,0.55)', dot:'#888' },
  'Conversación':    { bg:'rgba(239,159,39,0.18)',  text:'#FAC775',  dot:'#EF9F27' },
  'Propuesta':       { bg:'rgba(83,74,183,0.18)',   text:'#AFA9EC',  dot:'#7F77DD' },
  'Negociación':     { bg:'rgba(239,159,39,0.28)',  text:'#EF9F27',  dot:'#BA7517' },
  'Cerrado-Ganado':  { bg:'rgba(29,158,117,0.18)',  text:'#5DCAA5',  dot:'#1D9E75' },
  'Cerrado-Perdido': { bg:'rgba(226,75,74,0.15)',   text:'#F09595',  dot:'#E24B4A' },
}

const AV_PALETTES = [
  { bg:'rgba(55,138,221,0.22)',  text:'#85B7EB' },
  { bg:'rgba(29,158,117,0.22)',  text:'#5DCAA5' },
  { bg:'rgba(239,159,39,0.22)',  text:'#FAC775' },
  { bg:'rgba(83,74,183,0.22)',   text:'#AFA9EC' },
  { bg:'rgba(226,75,74,0.22)',   text:'#F09595' },
  { bg:'rgba(93,202,165,0.22)',  text:'#1D9E75' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────
const fmt     = n => n >= 1000 ? '$' + (n/1000).toFixed(0) + 'K' : '$' + n
const ini     = n => n.split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase()
const avc     = n => AV_PALETTES[n.charCodeAt(0) % AV_PALETTES.length]
const nowStr  = () => new Date().toISOString().slice(0,10)
const fmtDate = d => d ? new Date(d+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) : ''

function getPeriodRange(key) {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate()
  const pad = s => String(s).padStart(2,'0')
  const ymd = dt => `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`
  if (key === 'todo')      return { from:'1900-01-01', to:'2999-12-31' }
  if (key === 'hoy')       return { from:ymd(now), to:ymd(now) }
  if (key === 'semana') {
    const day = now.getDay() || 7
    const mon = new Date(now); mon.setDate(d - day + 1)
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return { from:ymd(mon), to:ymd(sun) }
  }
  if (key === 'mes')       return { from:`${y}-${pad(m+1)}-01`, to:`${y}-${pad(m+1)}-${pad(new Date(y,m+1,0).getDate())}` }
  if (key === 'trimestre') {
    const q = Math.floor(m/3)
    return { from:ymd(new Date(y,q*3,1)), to:ymd(new Date(y,q*3+3,0)) }
  }
  if (key === 'anual')     return { from:`${y}-01-01`, to:`${y}-12-31` }
  return { from:'1900-01-01', to:'2999-12-31' }
}

function filterByPeriod(prospects, periodo) {
  if (periodo === 'todo') return prospects
  const { from, to } = getPeriodRange(periodo)
  return prospects.filter(p => p.fecha >= from && p.fecha <= to)
}

function periodLabel(key) {
  const now = new Date()
  const p = getPeriodRange(key)
  if (key === 'hoy')       return now.toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long'})
  if (key === 'semana')    return `${fmtDate(p.from)} — ${fmtDate(p.to)}`
  if (key === 'mes')       return now.toLocaleDateString('es-MX',{month:'long',year:'numeric'})
  if (key === 'trimestre') return `Q${Math.floor(now.getMonth()/3)+1} ${now.getFullYear()}`
  if (key === 'anual')     return String(now.getFullYear())
  return 'Histórico completo'
}

// ─── Design tokens ────────────────────────────────────────────────────────
const G = {
  bg:'#0C1A14', bg2:'rgba(255,255,255,0.03)', bg3:'rgba(255,255,255,0.07)',
  border:'1px solid rgba(255,255,255,0.08)', borderG:'1px solid rgba(29,158,117,0.35)',
  borderA:'1px solid rgba(234,179,8,0.35)',
  green:'#1D9E75', gl:'#5DCAA5', gbg:'rgba(29,158,117,0.12)',
  amber:'#EAB308', amberL:'#FCD34D', amberBg:'rgba(234,179,8,0.10)',
  text:'#E8F0EB', muted:'rgba(232,240,235,0.45)', faint:'rgba(232,240,235,0.22)',
  red:'#E24B4A', r:'12px', rs:'8px',
}

// ─── Shared components ────────────────────────────────────────────────────
function Badge({ etapa }) {
  const c = ETAPA_COLOR[etapa] || { bg:G.bg3, text:G.muted }
  return (
    <span style={{ display:'inline-block', background:c.bg, color:c.text,
      borderRadius:20, padding:'3px 10px', fontSize:11, fontWeight:500, whiteSpace:'nowrap' }}>
      {etapa}
    </span>
  )
}

function Avatar({ name, size=36 }) {
  const c = avc(name)
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:c.bg, color:c.text,
      display:'flex', alignItems:'center', justifyContent:'center',
      fontSize:size*0.32, fontWeight:600, flexShrink:0 }}>
      {ini(name)}
    </div>
  )
}

function NavTab({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? G.gbg : 'transparent',
      color: active ? G.gl : G.muted,
      border: active ? G.borderG : '1px solid transparent',
      borderRadius:G.rs, padding:'6px 16px', fontSize:13,
      cursor:'pointer', fontWeight:active?600:400, transition:'all .15s',
    }}>{label}</button>
  )
}

function Btn({ children, onClick, variant='primary', style:s={} }) {
  const base = {
    primary: { background:G.green,    color:'#0C1A14', border:'none',    fontWeight:600 },
    ghost:   { background:'transparent', color:G.gl,   border:G.borderG },
    amber:   { background:G.amberBg,  color:G.amberL,  border:G.borderA, fontWeight:600 },
    danger:  { background:'transparent', color:G.red,  border:'1px solid rgba(226,75,74,0.35)' },
  }[variant]||{}
  return (
    <button onClick={onClick} style={{ ...base, borderRadius:G.rs, padding:'8px 18px', fontSize:13, cursor:'pointer', ...s }}>
      {children}
    </button>
  )
}

const inputStyle = { background:G.bg3, border:G.border, borderRadius:G.rs, padding:'9px 12px', fontSize:13, color:G.text, width:'100%', outline:'none' }

function Field({ label, children, full }) {
  return (
    <div style={{ marginBottom:14, gridColumn:full?'1/-1':undefined }}>
      <label style={{ fontSize:11, color:G.muted, display:'block', marginBottom:5, fontWeight:500, letterSpacing:'0.05em', textTransform:'uppercase' }}>{label}</label>
      {children}
    </div>
  )
}

// ─── Filter bar (shared) ──────────────────────────────────────────────────
function FilterBar({ periodo, setPeriodo, vendedor, setVendedor, vendedores }) {
  return (
    <div style={{ display:'flex', gap:8, marginBottom:24, flexWrap:'wrap', alignItems:'center' }}>

      {/* Period pills */}
      <div style={{ display:'flex', gap:3, background:G.bg3, borderRadius:G.r, padding:3, flexShrink:0 }}>
        {PERIODOS.map(p=>(
          <button key={p.key} onClick={()=>setPeriodo(p.key)} style={{
            background: periodo===p.key ? G.amberBg : 'transparent',
            color:      periodo===p.key ? G.amberL  : G.muted,
            border:     periodo===p.key ? G.borderA  : '1px solid transparent',
            borderRadius:G.rs, padding:'5px 12px', fontSize:12,
            cursor:'pointer', fontWeight:periodo===p.key?600:400,
            transition:'all .15s', whiteSpace:'nowrap',
          }}>{p.label}</button>
        ))}
      </div>

      <div style={{ width:1, height:24, background:'rgba(255,255,255,0.08)', flexShrink:0 }} />

      {/* Vendor pills */}
      <div style={{ display:'flex', gap:4, flexWrap:'wrap', alignItems:'center' }}>
        <span style={{ fontSize:11, color:G.faint, marginRight:2 }}>Vendedor:</span>
        {['Todos',...vendedores].map(v=>(
          <button key={v} onClick={()=>setVendedor(v)} style={{
            background: vendedor===v ? G.gbg       : 'transparent',
            color:      vendedor===v ? G.gl        : G.muted,
            border:     vendedor===v ? G.borderG   : G.border,
            borderRadius:20, padding:'4px 13px', fontSize:12,
            cursor:'pointer', fontWeight:vendedor===v?600:400,
            transition:'all .15s', whiteSpace:'nowrap',
          }}>{v==='Todos'?'👥 Todos':v}</button>
        ))}
      </div>

      <span style={{ flex:1 }} />
      <span style={{ fontSize:11, color:G.faint, flexShrink:0 }}>{periodLabel(periodo)}</span>
    </div>
  )
}

// ─── Loading ──────────────────────────────────────────────────────────────
function Loading() {
  return (
    <div style={{ background:G.bg, height:'100vh', display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center', fontFamily:"'DM Sans',sans-serif", gap:20 }}>
      <img src="/logo_sama.png" alt="SAMA Transportes" style={{ height:56, objectFit:'contain' }} />
      <div style={{ fontSize:13, color:G.muted }}>Conectando…</div>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────
function ProspectModal({ prospect, onSave, onClose, onDelete, saving }) {
  const blank = { vendedor:'', nombre:'', empresa:'', cargo:'', etapa:'Investigado',
    valor:'', prob:'10', fuente:'LinkedIn', notas:'', fecha:nowStr(), linkedin:'', email:'', telefono:'' }
  const [f, setF] = useState(prospect ? { ...prospect, valor:String(prospect.valor||0) } : blank)
  const set = k => e => setF(p=>({ ...p, [k]:e.target.value }))
  const valid = f.vendedor.trim() && f.nombre.trim() && f.empresa.trim()

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:20 }}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:'#0f2119', border:G.border, borderRadius:16, padding:28,
        width:'100%', maxWidth:540, maxHeight:'90vh', overflowY:'auto' }}>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:22 }}>
          <span style={{ fontFamily:"'DM Serif Display',serif", fontSize:20, color:G.gl }}>
            {prospect ? 'Editar prospecto' : 'Nuevo prospecto'}
          </span>
          <button onClick={onClose} style={{ background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer', lineHeight:1 }}>×</button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
          <Field label="Vendedor *"><input style={inputStyle} value={f.vendedor} onChange={set('vendedor')} placeholder="Tu nombre" /></Field>
          <Field label="Fecha primer contacto"><input type="date" style={inputStyle} value={f.fecha} onChange={set('fecha')} /></Field>
          <Field label="Nombre prospecto *" full><input style={inputStyle} value={f.nombre} onChange={set('nombre')} placeholder="Nombre completo" /></Field>
          <Field label="Empresa *"><input style={inputStyle} value={f.empresa} onChange={set('empresa')} placeholder="Empresa" /></Field>
          <Field label="Cargo"><input style={inputStyle} value={f.cargo} onChange={set('cargo')} placeholder="Cargo / Posición" /></Field>
          <Field label="Etapa">
            <select style={inputStyle} value={f.etapa} onChange={set('etapa')}>{ETAPAS.map(e=><option key={e} value={e}>{e}</option>)}</select>
          </Field>
          <Field label="Fuente">
            <select style={inputStyle} value={f.fuente} onChange={set('fuente')}>{FUENTES.map(s=><option key={s} value={s}>{s}</option>)}</select>
          </Field>
          <Field label="Valor estimado ($)"><input type="number" style={inputStyle} value={f.valor} onChange={set('valor')} placeholder="0" min="0" /></Field>
          <Field label="Probabilidad (%)"><input type="number" style={inputStyle} value={f.prob} onChange={set('prob')} min="0" max="100" /></Field>
          <Field label="LinkedIn"><input style={inputStyle} value={f.linkedin||''} onChange={set('linkedin')} placeholder="https://linkedin.com/in/..." /></Field>
          <Field label="Email"><input style={inputStyle} value={f.email||''} onChange={set('email')} placeholder="correo@empresa.com" /></Field>
          <Field label="Teléfono"><input style={inputStyle} value={f.telefono||''} onChange={set('telefono')} placeholder="+52 81..." /></Field>
          <Field label="Notas / Próximo paso" full>
            <textarea style={{ ...inputStyle, height:72, resize:'vertical' }} value={f.notas} onChange={set('notas')} placeholder="Notas de seguimiento..." />
          </Field>
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:8 }}>
          <div>{prospect && <Btn variant="danger" onClick={()=>onDelete(prospect.id)}>Eliminar</Btn>}</div>
          <div style={{ display:'flex', gap:10 }}>
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn onClick={()=>valid&&onSave(f)} style={{ opacity:valid?1:0.4 }}>{saving?'Guardando…':'Guardar'}</Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────
function Dashboard({ prospects, periodo, setPeriodo, vendedor, setVendedor, vendedores }) {
  const byPeriod  = useMemo(()=>filterByPeriod(prospects,periodo),[prospects,periodo])
  const byVendor  = useMemo(()=>vendedor==='Todos'?byPeriod:byPeriod.filter(p=>p.vendedor===vendedor),[byPeriod,vendedor])
  const ganados   = byVendor.filter(p=>p.etapa==='Cerrado-Ganado')
  const activos   = byVendor.filter(p=>!['Cerrado-Ganado','Cerrado-Perdido'].includes(p.etapa))
  const cerrado   = ganados.reduce((s,p)=>s+p.valor,0)
  const pipeline  = activos.reduce((s,p)=>s+p.valor,0)
  const ponderado = activos.reduce((s,p)=>s+(p.valor*(p.prob/100)),0)
  const byEtapa   = ETAPAS.map(e=>({ etapa:e, count:byVendor.filter(p=>p.etapa===e).length }))
  const maxCount  = Math.max(...byEtapa.map(b=>b.count),1)
  const rankVend  = Object.entries(
    byPeriod.filter(p=>p.etapa!=='Cerrado-Perdido').reduce((acc,p)=>{
      if(!acc[p.vendedor]) acc[p.vendedor]={ ganado:0, pipeline:0, count:0 }
      if(p.etapa==='Cerrado-Ganado') acc[p.vendedor].ganado+=p.valor
      else acc[p.vendedor].pipeline+=p.valor
      acc[p.vendedor].count++; return acc
    },{})
  ).sort((a,b)=>(b[1].ganado+b[1].pipeline)-(a[1].ganado+a[1].pipeline))
  const recientes = [...byVendor].sort((a,b)=>(b.updatedAt?.seconds||0)-(a.updatedAt?.seconds||0)).slice(0,6)

  return (
    <div>
      <FilterBar periodo={periodo} setPeriodo={setPeriodo} vendedor={vendedor} setVendedor={setVendedor} vendedores={vendedores} />

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:24 }}>
        {[
          { label:'Cerrado ganado',     val:fmt(cerrado),              sub:`${ganados.length} cliente${ganados.length!==1?'s':''}`, accent:true },
          { label:'Pipeline abierto',   val:fmt(pipeline),             sub:`${activos.length} prospectos activos` },
          { label:'Pipeline ponderado', val:fmt(Math.round(ponderado)),sub:'por probabilidad' },
          { label:'Total registros',    val:byVendor.length,           sub:`${byVendor.filter(p=>p.etapa==='Cerrado-Perdido').length} perdidos` },
        ].map((k,i)=>(
          <div key={i} style={{ background:k.accent?G.gbg:G.bg2, border:k.accent?G.borderG:G.border, borderRadius:G.r, padding:'18px 20px' }}>
            <div style={{ fontSize:11, color:G.faint, fontWeight:500, letterSpacing:'0.03em' }}>{k.label}</div>
            <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:26, color:k.accent?G.gl:G.text, margin:'6px 0 4px' }}>{k.val}</div>
            <div style={{ fontSize:11, color:k.accent?'rgba(93,202,165,0.6)':G.muted }}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
        <div style={{ background:G.bg2, border:G.border, borderRadius:G.r, padding:'20px 24px' }}>
          <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:G.faint, marginBottom:16 }}>Embudo de ventas</div>
          {byEtapa.filter(b=>b.count>0).map(b=>(
            <div key={b.etapa} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:9 }}>
              <span style={{ fontSize:12, color:G.muted, width:128, flexShrink:0 }}>{b.etapa}</span>
              <div style={{ flex:1, background:'rgba(255,255,255,0.06)', borderRadius:4, height:18, overflow:'hidden' }}>
                <div style={{ width:`${(b.count/maxCount)*100}%`, height:'100%', background:ETAPA_COLOR[b.etapa]?.dot||G.green, borderRadius:4, opacity:.75, minWidth:14, transition:'width .4s' }} />
              </div>
              <span style={{ fontSize:12, color:ETAPA_COLOR[b.etapa]?.text||G.text, fontWeight:600, width:18, textAlign:'right' }}>{b.count}</span>
            </div>
          ))}
          {byEtapa.every(b=>b.count===0)&&<p style={{ fontSize:13, color:G.faint }}>Sin datos para este período</p>}
        </div>

        <div style={{ background:G.bg2, border:G.border, borderRadius:G.r, padding:'20px 24px' }}>
          <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:G.faint, marginBottom:16 }}>Ranking del equipo</div>
          {rankVend.length===0&&<p style={{ fontSize:13, color:G.faint }}>Sin datos aún</p>}
          {rankVend.map(([v,d],i)=>(
            <div key={v} style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
              <div style={{ width:20, fontSize:12, color:i===0?G.amberL:G.faint, fontWeight:700, flexShrink:0 }}>#{i+1}</div>
              <Avatar name={v} size={32} />
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:500 }}>{v}</div>
                <div style={{ fontSize:11, color:G.muted }}>{d.count} prosp. · Ganado {fmt(d.ganado)}</div>
              </div>
              <span style={{ fontFamily:"'DM Serif Display',serif", fontSize:16 }}>{fmt(d.pipeline+d.ganado)}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background:G.bg2, border:G.border, borderRadius:G.r, padding:'20px 24px' }}>
        <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:G.faint, marginBottom:16 }}>Últimas actualizaciones</div>
        {recientes.length===0&&<p style={{ fontSize:13, color:G.faint, padding:'8px 0' }}>Sin actividad en este período</p>}
        {recientes.map((p,i)=>(
          <div key={p.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0',
            borderBottom:i<recientes.length-1?'1px solid rgba(255,255,255,0.05)':'none' }}>
            <Avatar name={p.nombre} size={34} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:500 }}>{p.nombre} <span style={{ color:G.faint, fontWeight:400 }}>— {p.empresa}</span></div>
              <div style={{ fontSize:11, color:G.muted, marginTop:2 }}>{p.vendedor} · {fmtDate(p.fecha)}</div>
            </div>
            <Badge etapa={p.etapa} />
            <span style={{ fontFamily:"'DM Serif Display',serif", fontSize:16, minWidth:50, textAlign:'right' }}>{fmt(p.valor)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Prospects list ───────────────────────────────────────────────────────
function ProspectList({ prospects, onEdit, onAdd, periodo, setPeriodo, vendedor, setVendedor, vendedores }) {
  const [search,setSearch]=useState('')
  const [etapa,setEtapa]=useState('Todas')
  const [sort,setSort]=useState('fecha')
  const byPeriod = useMemo(()=>filterByPeriod(prospects,periodo),[prospects,periodo])
  const list = useMemo(()=>{
    let r=[...byPeriod]
    if(vendedor!=='Todos') r=r.filter(p=>p.vendedor===vendedor)
    if(search) r=r.filter(p=>[p.nombre,p.empresa,p.cargo,p.notas].join(' ').toLowerCase().includes(search.toLowerCase()))
    if(etapa!=='Todas') r=r.filter(p=>p.etapa===etapa)
    r.sort((a,b)=>sort==='valor'?b.valor-a.valor:sort==='prob'?b.prob-a.prob:b.fecha?.localeCompare(a.fecha||'')||0)
    return r
  },[byPeriod,vendedor,search,etapa,sort])

  return (
    <div>
      <FilterBar periodo={periodo} setPeriodo={setPeriodo} vendedor={vendedor} setVendedor={setVendedor} vendedores={vendedores} />
      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        <input style={{ ...inputStyle, width:200 }} placeholder="Buscar…" value={search} onChange={e=>setSearch(e.target.value)} />
        <select style={{ ...inputStyle, width:165 }} value={etapa} onChange={e=>setEtapa(e.target.value)}>
          <option value="Todas">Todas las etapas</option>
          {ETAPAS.map(e=><option key={e} value={e}>{e}</option>)}
        </select>
        <select style={{ ...inputStyle, width:140 }} value={sort} onChange={e=>setSort(e.target.value)}>
          <option value="fecha">Más reciente</option>
          <option value="valor">Mayor valor</option>
          <option value="prob">Mayor probabilidad</option>
        </select>
        <span style={{ flex:1 }} />
        <Btn onClick={onAdd}>+ Nuevo prospecto</Btn>
      </div>
      <div style={{ fontSize:12, color:G.faint, marginBottom:12 }}>{list.length} prospecto{list.length!==1?'s':''}</div>
      {list.map(p=>(
        <div key={p.id} onClick={()=>onEdit(p)}
          style={{ background:G.bg2, border:G.border, borderRadius:G.r, padding:'14px 20px',
            marginBottom:8, cursor:'pointer', display:'flex', alignItems:'center', gap:14, transition:'border .12s' }}
          onMouseEnter={e=>e.currentTarget.style.borderColor='rgba(29,158,117,0.3)'}
          onMouseLeave={e=>e.currentTarget.style.borderColor='rgba(255,255,255,0.08)'}>
          <Avatar name={p.nombre} size={40} />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <span style={{ fontSize:14, fontWeight:500 }}>{p.nombre}</span>
              <span style={{ fontSize:12, color:G.muted }}>— {p.empresa}</span>
            </div>
            <div style={{ fontSize:12, color:G.faint, marginTop:3 }}>{[p.cargo,p.fuente,p.vendedor].filter(Boolean).join(' · ')}</div>
            {p.notas&&<div style={{ fontSize:12, color:G.muted, marginTop:4 }}>{p.notas.slice(0,80)}{p.notas.length>80?'…':''}</div>}
          </div>
          <div style={{ textAlign:'right', flexShrink:0 }}>
            <Badge etapa={p.etapa} />
            <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:20, marginTop:5 }}>{fmt(p.valor)}</div>
            <div style={{ fontSize:11, color:G.muted }}>{p.prob}% prob.</div>
          </div>
        </div>
      ))}
      {list.length===0&&<div style={{ textAlign:'center', color:G.faint, padding:48, fontSize:14 }}>Sin resultados en este período</div>}
    </div>
  )
}

// ─── Report ───────────────────────────────────────────────────────────────
function ReportView({ prospects, periodo, setPeriodo, vendedor, setVendedor, vendedores }) {
  const [exporting,setExporting]=useState(false)
  const reportRef=useRef(null)
  const byPeriod  = useMemo(()=>filterByPeriod(prospects,periodo),[prospects,periodo])
  const filtered  = useMemo(()=>vendedor==='Todos'?byPeriod:byPeriod.filter(p=>p.vendedor===vendedor),[byPeriod,vendedor])
  const ganados   = filtered.filter(p=>p.etapa==='Cerrado-Ganado')
  const activos   = filtered.filter(p=>!['Cerrado-Ganado','Cerrado-Perdido'].includes(p.etapa))
  const cerrado   = ganados.reduce((s,p)=>s+p.valor,0)
  const pipeline  = activos.reduce((s,p)=>s+p.valor,0)
  const ponderado = activos.reduce((s,p)=>s+(p.valor*(p.prob/100)),0)
  const pct       = Math.min(Math.round((cerrado/META_MES)*100),999)
  const hot       = activos.filter(p=>p.prob>=70).sort((a,b)=>b.valor-a.valor)

  const handleExport = async () => {
    if(!reportRef.current) return
    setExporting(true)
    try {
      const html2canvas=(await import('html2canvas')).default
      const canvas=await html2canvas(reportRef.current,{ backgroundColor:'#0C1A14', scale:2, useCORS:true, logging:false })
      const link=document.createElement('a')
      const ds=new Date().toLocaleDateString('es-MX',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-')
      link.download=`reporte-${vendedor==='Todos'?'equipo':vendedor.replace(/\s+/g,'_')}-${periodo}-${ds}.png`
      link.href=canvas.toDataURL('image/png'); link.click()
    } catch(e){console.error(e)}
    finally{setExporting(false)}
  }

  return (
    <div>
      <FilterBar periodo={periodo} setPeriodo={setPeriodo} vendedor={vendedor} setVendedor={setVendedor} vendedores={vendedores} />
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:16 }}>
        <Btn variant="amber" onClick={handleExport} style={{ display:'flex', alignItems:'center', gap:6 }}>
          {exporting?'⏳ Exportando…':'↓ Exportar imagen'}
        </Btn>
      </div>

      {/* Exportable */}
      <div ref={reportRef} style={{ background:G.bg, padding:32, borderRadius:16 }}>

        {/* Header con logo */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
          paddingBottom:22, borderBottom:'1px solid rgba(234,179,8,0.2)', marginBottom:24 }}>
          <img src="/logo_sama.png" alt="SAMA Transportes" style={{ height:46, objectFit:'contain' }} />
          <div style={{ textAlign:'right' }}>
            <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:22, color:G.text }}>
              Reporte de <em style={{ fontStyle:'italic', color:G.amberL }}>ventas</em>
            </div>
            <div style={{ fontSize:12, color:G.muted, marginTop:5 }}>
              {periodLabel(periodo)}{vendedor!=='Todos'&&<span style={{ color:G.amberL, marginLeft:8 }}>· {vendedor}</span>}
            </div>
          </div>
        </div>

        {/* Progress */}
        <div style={{ background:G.bg3, borderRadius:G.r, padding:'18px 22px', marginBottom:20, display:'flex', alignItems:'center', gap:20 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:G.faint, marginBottom:9 }}>
              Progreso meta — ${META_MES.toLocaleString('es-MX')}
            </div>
            <div style={{ background:'rgba(255,255,255,0.07)', borderRadius:6, height:10, overflow:'hidden' }}>
              <div style={{ width:`${Math.min(pct,100)}%`, height:'100%', background:'linear-gradient(90deg,#92400e,#FCD34D)', borderRadius:6 }} />
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', marginTop:6 }}>
              <span style={{ fontSize:11, color:G.amberL, fontWeight:600 }}>{fmt(cerrado)} alcanzados</span>
              <span style={{ fontSize:11, color:G.faint }}>Meta: {fmt(META_MES)}</span>
            </div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:40, color:G.amberL, lineHeight:1 }}>{pct}%</div>
            <div style={{ fontSize:11, color:'rgba(252,211,77,0.5)', marginTop:4 }}>completado</div>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
          {[
            { l:'Cerrado ganado',     v:fmt(cerrado),              s:`${ganados.length} negocio${ganados.length!==1?'s':''}`, a:true },
            { l:'Pipeline abierto',  v:fmt(pipeline),             s:`${activos.length} prospectos` },
            { l:'Pipeline ponderado',v:fmt(Math.round(ponderado)),s:'por probabilidad' },
            { l:'Prospectos activos',v:activos.length,            s:`${filtered.filter(p=>p.etapa==='Cerrado-Perdido').length} perdidos` },
          ].map((k,i)=>(
            <div key={i} style={{ background:k.a?G.amberBg:G.bg3, border:k.a?G.borderA:G.border, borderRadius:G.r, padding:'16px 18px' }}>
              <div style={{ fontSize:10, color:G.faint, fontWeight:500, letterSpacing:'0.03em' }}>{k.l}</div>
              <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:24, color:k.a?G.amberL:G.text, margin:'6px 0 4px' }}>{k.v}</div>
              <div style={{ fontSize:11, color:k.a?'rgba(252,211,77,0.55)':G.muted }}>{k.s}</div>
            </div>
          ))}
        </div>

        {/* Hot */}
        {hot.length>0&&(
          <div style={{ background:G.bg3, border:G.border, borderRadius:G.r, padding:'18px 22px', marginBottom:20 }}>
            <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:G.faint, marginBottom:14 }}>Prospectos calientes (≥70%)</div>
            {hot.map((p,i)=>(
              <div key={p.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'9px 0',
                borderBottom:i<hot.length-1?'1px solid rgba(255,255,255,0.05)':'none' }}>
                <Avatar name={p.nombre} size={34} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:500 }}>{p.nombre} <span style={{ color:G.faint, fontWeight:400 }}>— {p.empresa}</span></div>
                  <div style={{ fontSize:11, color:G.muted, marginTop:2 }}>{p.notas?.slice(0,70)}{p.notas?.length>70?'…':''}</div>
                </div>
                <Badge etapa={p.etapa} />
                <span style={{ fontFamily:"'DM Serif Display',serif", fontSize:16, minWidth:50, textAlign:'right' }}>{fmt(p.valor)}</span>
                <span style={{ fontSize:12, color:G.amber, minWidth:36, textAlign:'right', fontWeight:600 }}>{p.prob}%</span>
              </div>
            ))}
          </div>
        )}

        {/* Por etapa */}
        <div style={{ background:G.bg3, border:G.border, borderRadius:G.r, padding:'18px 22px', marginBottom:20 }}>
          <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:G.faint, marginBottom:14 }}>Distribución por etapa</div>
          {ETAPAS.map(e=>{
            const ps=filtered.filter(p=>p.etapa===e)
            if(!ps.length) return null
            return (
              <div key={e} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                <Badge etapa={e} />
                <span style={{ fontSize:13, color:G.muted }}>{ps.length} prospecto{ps.length!==1?'s':''}</span>
                <span style={{ flex:1 }} />
                <span style={{ fontFamily:"'DM Serif Display',serif", fontSize:16 }}>{fmt(ps.reduce((s,p)=>s+p.valor,0))}</span>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
          paddingTop:16, borderTop:'1px solid rgba(255,255,255,0.06)' }}>
          <img src="/logo_sama.png" alt="SAMA" style={{ height:22, objectFit:'contain', opacity:.45 }} />
          <span style={{ fontSize:11, color:G.faint }}>
            Generado el {new Date().toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'})}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,setTab]             = useState('dashboard')
  const [prospects,setProspects] = useState([])
  const [loaded,setLoaded]       = useState(false)
  const [modal,setModal]         = useState(null)
  const [saving,setSaving]       = useState(false)
  const [toast,setToast]         = useState(null)
  const [periodo,setPeriodo]     = useState('mes')
  const [vendedor,setVendedor]   = useState('Todos')

  const vendedores = useMemo(()=>[...new Set(prospects.map(p=>p.vendedor).filter(Boolean))].sort(),[prospects])
  const showToast  = (msg,color=G.gl) => { setToast({msg,color}); setTimeout(()=>setToast(null),2800) }

  useEffect(()=>{
    const q=query(collection(db,'prospects'),orderBy('updatedAt','desc'))
    return onSnapshot(q,
      snap=>{ setProspects(snap.docs.map(d=>({id:d.id,...d.data()}))); setLoaded(true) },
      err =>{ console.error(err); setLoaded(true) }
    )
  },[])

  async function handleSave(f) {
    setSaving(true)
    try {
      const data={
        vendedor:f.vendedor.trim(), nombre:f.nombre.trim(), empresa:f.empresa.trim(),
        cargo:f.cargo||'', etapa:f.etapa, valor:Number(f.valor)||0, prob:Number(f.prob)||0,
        fuente:f.fuente||'', notas:f.notas||'', fecha:f.fecha||nowStr(),
        linkedin:f.linkedin||'', email:f.email||'', telefono:f.telefono||'',
        updatedAt:serverTimestamp(),
      }
      if(f.id&&f.id!=='new'){
        await updateDoc(doc(db,'prospects',f.id),data); showToast('Actualizado ✓')
      } else {
        data.createdAt=serverTimestamp()
        await addDoc(collection(db,'prospects'),data); showToast('Prospecto agregado ✓')
      }
      setModal(null)
    } catch(e){ console.error(e); showToast('Error al guardar',G.red) }
    finally{ setSaving(false) }
  }

  async function handleDelete(id) {
    if(!confirm('¿Eliminar este prospecto?')) return
    try{ await deleteDoc(doc(db,'prospects',id)); showToast('Eliminado'); setModal(null) }
    catch(e){ showToast('Error',G.red) }
  }

  if(!loaded) return <Loading />

  const fp = { periodo, setPeriodo, vendedor, setVendedor, vendedores }

  return (
    <div style={{ background:G.bg, minHeight:'100vh', fontFamily:"'DM Sans',sans-serif", color:G.text }}>

      <nav style={{ background:'rgba(12,26,20,0.97)', backdropFilter:'blur(12px)',
        borderBottom:G.border, padding:'0 24px', display:'flex', alignItems:'center',
        justifyContent:'space-between', height:58, position:'sticky', top:0, zIndex:100 }}>
        <img src="/logo_sama.png" alt="SAMA Transportes" style={{ height:36, objectFit:'contain' }} />
        <div style={{ display:'flex', gap:4 }}>
          <NavTab label="Dashboard"  active={tab==='dashboard'} onClick={()=>setTab('dashboard')} />
          <NavTab label="Prospectos" active={tab==='prospects'} onClick={()=>setTab('prospects')} />
          <NavTab label="Reporte"    active={tab==='report'}    onClick={()=>setTab('report')} />
        </div>
        <Btn onClick={()=>setModal({id:'new'})}>+ Agregar</Btn>
      </nav>

      <div style={{ padding:'28px 28px 56px', maxWidth:1140, margin:'0 auto' }}>
        {tab==='dashboard' && <Dashboard    prospects={prospects} {...fp} />}
        {tab==='prospects' && <ProspectList prospects={prospects} onEdit={setModal} onAdd={()=>setModal({id:'new'})} {...fp} />}
        {tab==='report'    && <ReportView   prospects={prospects} {...fp} />}
      </div>

      {modal&&<ProspectModal prospect={modal.id==='new'?null:modal} onSave={handleSave} onClose={()=>setModal(null)} onDelete={handleDelete} saving={saving} />}

      {toast&&(
        <div style={{ position:'fixed', bottom:24, right:24, background:'#0f2119',
          border:`1px solid ${toast.color}44`, borderRadius:G.rs, padding:'12px 20px',
          fontSize:13, color:toast.color, fontWeight:500, zIndex:400, animation:'fadeIn .2s ease' }}>
          {toast.msg}
        </div>
      )}

      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px}
        input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.5)}
        option{background:#0f2119}
      `}</style>
    </div>
  )
}
