/* ===========================================================
   core.js — state, storage, rendering helpers, tools
   =========================================================== */

/* ---------------- subjects ---------------- */
export const SUBS = [
  {id:'algebra',   n:'Algebra',    ru:'Алгебра',           e:'∑', c:'#7c6cff'},
  {id:'biology',   n:'Biology',    ru:'Биология',          e:'🧬', c:'#22c55e'},
  {id:'qazaq',     n:'Қазақ тілі', ru:'Казахский язык',    e:'📖', c:'#f59e0b', kk:1},
  {id:'chemistry', n:'Chemistry',  ru:'Химия',             e:'⚗', c:'#a855f7'},
  {id:'physics',   n:'Physics',    ru:'Физика',            e:'⚛', c:'#06b6d4'},
  {id:'history',   n:'Қазақстан тарихы', ru:'История Казахстана', e:'🏛', c:'#ef4444', kk:1}
];
export const LEVELS = {
  A:{n:'A · Базовый', short:'A', c:'#34d399', d:'Прямые вопросы по определениям, фактам и формулам. 1–2 шага решения.'},
  B:{n:'B · Средний',  short:'B', c:'#fbbf24', d:'Применение, сравнение, классификация, типовые задачи в 2–3 шага.'},
  C:{n:'C · Сложный',  short:'C', c:'#f87171', d:'Многошаговые задачи, интеграция тем, кейсы, ловушки и границы применимости.'}
};
export const LV_ORDER = ['A','B','C'];

export const S = {
  user:null, sub:null, view:'home', tab:'test',
  run:null, deck:null, doc:null, lastDoc:null, busy:false
};

/* ---------------- tiny helpers ---------------- */
export const $  = s=>document.querySelector(s);
export const $$ = s=>[...document.querySelectorAll(s)];
export const esc = s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export const uidShort = ()=>Math.random().toString(36).slice(2,10);
export const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
export const sleep = ms=>new Promise(r=>setTimeout(r,ms));
export const dayKey = (d=new Date())=>(d||new Date()).toLocaleDateString('en-CA');
export const fmtDate = t=>new Date(t).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
export const fmtBytes = b=>b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(1)+' MB';
export const nowId = (p='id')=>p+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);

/* ---------------- storage (scoped per account) ---------------- */
const MEM = {};
const LS = (()=>{ try{ const k='__t'; localStorage.setItem(k,'1'); localStorage.removeItem(k); return localStorage; }catch(e){ return null; } })();
export const ACC = ()=> (S.user && S.user.em && S.user.em!=='guest') ? S.user.em : 'guest';
const K = k=>`bts2:${ACC()}:${k}`;
const G = k=>`bts2:__shared__:${k}`;

export function sv(k,v){ try{ const s=JSON.stringify(v); if(LS) LS.setItem(K(k),s); else MEM[K(k)]=s; }catch(e){ toast('Не удалось сохранить: '+e.message,'err'); } }
export function rd(k,d=null){ try{ const s=LS?LS.getItem(K(k)):MEM[K(k)]; return s==null?d:JSON.parse(s); }catch(e){ return d; } }
export function rm(k){ try{ if(LS) LS.removeItem(K(k)); else delete MEM[K(k)]; }catch(e){} }
export function gsv(k,v){ try{ const s=JSON.stringify(v); if(LS) LS.setItem(G(k),s); else MEM[G(k)]=s; }catch(e){} }
export function grd(k,d=null){ try{ const s=LS?LS.getItem(G(k)):MEM[G(k)]; return s==null?d:JSON.parse(s); }catch(e){ return d; } }

/* ---------------- IndexedDB (documents + materials) ---------------- */
const DBN='bts2', DBV=1; let _db=null;
function db(){
  if(_db) return _db;
  _db = new Promise((res,rej)=>{
    const r=indexedDB.open(DBN,DBV);
    r.onupgradeneeded=()=>{ const d=r.result;
      if(!d.objectStoreNames.contains('docs')) d.createObjectStore('docs',{keyPath:'id'});
      if(!d.objectStoreNames.contains('mat'))  d.createObjectStore('mat',{keyPath:'id'});
    };
    r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
  });
  return _db;
}
export async function dbAll(store){
  const d=await db();
  return new Promise((res,rej)=>{ const tx=d.transaction(store,'readonly'), rq=tx.objectStore(store).getAll();
    rq.onsuccess=()=>res(rq.result||[]); rq.onerror=()=>rej(rq.error); });
}
export async function dbGet(store,id){
  const d=await db();
  return new Promise((res,rej)=>{ const tx=d.transaction(store,'readonly'), rq=tx.objectStore(store).get(id);
    rq.onsuccess=()=>res(rq.result||null); rq.onerror=()=>rej(rq.error); });
}
export async function dbPut(store,val){
  const d=await db();
  return new Promise((res,rej)=>{ const tx=d.transaction(store,'readwrite'), rq=tx.objectStore(store).put(val);
    rq.onsuccess=()=>res(val); rq.onerror=()=>rej(rq.error); });
}
export async function dbDel(store,id){
  const d=await db();
  return new Promise((res,rej)=>{ const tx=d.transaction(store,'readwrite'), rq=tx.objectStore(store).delete(id);
    rq.onsuccess=()=>res(true); rq.onerror=()=>rej(rq.error); });
}
export async function dbClearAccount(store){
  const all=await dbAll(store);
  const me=ACC();
  await Promise.all(all.filter(x=>x.uid===me).map(x=>dbDel(store,x.id)));
}

/* ---------------- toast / modal ---------------- */
export function toast(msg, kind=''){
  const box=$('#toasts'); if(!box) return;
  const e=document.createElement('div'); e.className='toast '+kind; e.textContent=msg;
  box.appendChild(e);
  setTimeout(()=>{ e.style.opacity='0'; e.style.transform='translateY(10px)'; setTimeout(()=>e.remove(),300); }, 3200);
}
export function openModal(title, html, wide=false){
  $('#modalTitle').textContent=title;
  $('#modalBody').innerHTML=html;
  $('#modalBox').classList.toggle('wide', !!wide);
  $('#modal').hidden=false;
  return $('#modalBody');
}
export function closeModal(){ $('#modal').hidden=true; $('#modalBody').innerHTML=''; }
export function ask(text, ok='Да', cancel='Отмена'){
  return new Promise(res=>{
    const b=openModal('Подтверждение',`<p style="margin:0 0 16px">${esc(text)}</p>
      <div class="row end"><button class="btn ghost" data-no>${esc(cancel)}</button><button class="btn" data-yes>${esc(ok)}</button></div>`);
    b.querySelector('[data-yes]').onclick=()=>{closeModal();res(true)};
    b.querySelector('[data-no]').onclick=()=>{closeModal();res(false)};
  });
}
document.addEventListener('click',e=>{
  if(e.target.closest('[data-close]') && e.target.closest('#modal')) closeModal();
  if(e.target.matches('.modal-bg')) closeModal();
});
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && !$('#modal').hidden) closeModal(); });

/* ---------------- fingerprints (no-repeat engine) ---------------- */
export function normText(s){
  return String(s||'').toLowerCase()
    .replace(/ё/g,'е')
    .replace(/[^\p{L}\p{N}\s]/gu,' ')
    .replace(/\s+/g,' ').trim();
}
export function fingerprint(s){ // stable hash of normalised text
  const n=normText(s); let h=2166136261;
  for(let i=0;i<n.length;i++){ h^=n.charCodeAt(i); h=Math.imul(h,16777619); }
  return (h>>>0).toString(36);
}
export function shingles(s,k=4){
  const w=normText(s).split(' ').filter(Boolean); const out=new Set();
  for(let i=0;i<=w.length-k;i++) out.add(w.slice(i,i+k).join(' '));
  if(!out.size && w.length) out.add(w.join(' '));
  return out;
}
export function similar(a,b,thr=0.62){
  const A=shingles(a), B=shingles(b); if(!A.size||!B.size) return false;
  let inter=0; A.forEach(x=>{ if(B.has(x)) inter++; });
  return inter/Math.min(A.size,B.size) >= thr;
}

/* ---------------- seen-questions index (across subjects) ---------------- */
const SEEN_MAX=4000;
export function seenList(){ return grd('seen',[]) || []; }
export function seenAdd(items){
  if(!items||!items.length) return;
  const cur=seenList(); const set=new Set(cur.map(x=>x.f));
  items.forEach(x=>{ if(x&&x.f&&!set.has(x.f)){ cur.push({f:x.f,t:(x.t||'').slice(0,120),l:x.l||'',s:x.s||'',d:Date.now()}); set.add(x.f); } });
  while(cur.length>SEEN_MAX) cur.shift();
  gsv('seen',cur);
}
export function seenTexts(limit=40){
  return seenList().slice(-limit).map(x=>x.t).filter(Boolean);
}

/* ---------------- math (KaTeX) ---------------- */
let katexReady=false;
export function kx(root){
  const el=root||$('#main');
  if(!el||!window.renderMathInElement) return;
  try{
    renderMathInElement(el,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],
      throwOnError:false,ignoredTags:['script','noscript','style','textarea','pre','code']});
    katexReady=true;
  }catch(e){}
}
export function waitKatex(cb){
  let n=0;
  const t=setInterval(()=>{ if(window.renderMathInElement||n>40){ clearInterval(t); cb(); } n++; },120);
}

/* ---------------- figures (graphs) ---------------- */
const st=r=>{ const d=r/8,m=Math.pow(10,Math.floor(Math.log10(d))); return [1,2,5,10].map(k=>k*m).find(k=>k>=d); };
const cf=s=>{ s=String(s).replace(/\^/g,'**');
  if(/[^\dxy\s.+\-*/()]/.test(s.replace(/sqrt|abs|sin|cos|ln|exp|pi/g,''))) return ()=>NaN;
  try{ const f=Function('x','y','sqrt','abs','sin','cos','ln','exp','pi','return('+s+')');
    return (x,y)=>f(x,y,Math.sqrt,Math.abs,Math.sin,Math.cos,Math.log,Math.exp,Math.PI); }catch(e){ return ()=>NaN; } };
export function fig(g){
  if(g&&g.img){ const u=String((window.IMG||{})[g.img]||g.img).replace(/"/g,''); return `<img class="fig pic" src="${u}" alt="">`; }
  if(!g||!Array.isArray(g.x)||!Array.isArray(g.y)) return '';
  const W=280,H=210,[a,b]=g.x,[c,d]=g.y, X=x=>(x-a)/(b-a)*W, Y=y=>H-(y-c)/(d-c)*H, gx=st(b-a), gy=st(d-c);
  let s='';
  for(let v=Math.ceil(a/gx)*gx;v<=b+1e-9;v+=gx) s+=`<path d="M${X(v)} 0V${H}" stroke="#8884"/><text x="${X(v)+2}" y="${Math.min(Math.max(Y(0)+10,10),H-2)}" font-size="9" fill="#9aa">${+v.toFixed(2)}</text>`;
  for(let v=Math.ceil(c/gy)*gy;v<=d+1e-9;v+=gy) s+=`<path d="M0 ${Y(v)}H${W}" stroke="#8884"/><text x="${Math.min(Math.max(X(0)+3,0),W-18)}" y="${Y(v)-2}" font-size="9" fill="#9aa">${+v.toFixed(2)}</text>`;
  const sh=[].concat(g.shade||[]).map(t=>{ const p=String(t).split(/(<=|>=|<|>)/); return [cf(p[0]),p[1],cf(p[2])]; });
  if(sh.length){
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H; const k=cv.getContext('2d');
    k.fillStyle='rgba(129,140,248,.45)';
    for(let i=0;i<W;i+=2) for(let j=0;j<H;j+=2){
      const x=a+(i+1)/W*(b-a), y=d-(j+1)/H*(d-c);
      if(sh.every(([f,o,h])=>{ const u=f(x,y),v=h(x,y); return o==='>'?u>v:o==='<'?u<v:o==='>='?u>=v:u<=v; })) k.fillRect(i,j,2,2);
    }
    s+=`<image href="${cv.toDataURL()}" width="${W}" height="${H}"/>`;
  }
  s+=`<path d="M0 ${Y(0)}H${W}M${X(0)} 0V${H}" stroke="#bbb" stroke-width="1.3"/>`;
  [].concat(g.fn||[]).forEach(o=>{ const f=cf(o.f); let p='',u=0;
    for(let i=0;i<=200;i++){ const x=a+i/200*(b-a),y=f(x,0);
      if(isFinite(y)&&Math.abs(y-(c+d)/2)<4*(d-c)){ p+=(u?'L':'M')+X(x).toFixed(1)+' '+Y(y).toFixed(1); u=1; } else u=0; }
    s+=`<path d="${p}" fill="none" stroke="#a5b4fc" stroke-width="2"${o.d?' stroke-dasharray="6 4"':''}/>`; });
  [].concat(g.ci||[]).forEach(o=>s+=`<ellipse cx="${X(o[0])}" cy="${Y(o[1])}" rx="${o[2]*W/(b-a)}" ry="${o[2]*H/(d-c)}" fill="none" stroke="#a5b4fc" stroke-width="2"${o[3]?' stroke-dasharray="6 4"':''}/>`);
  if(g.lx) s+=`<text x="${W-4}" y="${H-4}" text-anchor="end" font-size="11" fill="#cbd5e1">${esc(g.lx)}</text>`;
  if(g.ly) s+=`<text x="4" y="12" font-size="11" fill="#cbd5e1">${esc(g.ly)}</text>`;
  [].concat(g.vl||[]).forEach(o=>s+=`<path d="M${X(o.v)} 0V${H}" stroke="#a5b4fc" stroke-width="2"${o.d?' stroke-dasharray="6 4"':''}/>`);
  [].concat(g.pl||[]).forEach(l=>s+=`<polyline points="${l.map(p=>X(p[0])+','+Y(p[1])).join(' ')}" fill="none" stroke="#f472b6" stroke-width="2.4"/>`);
  [].concat(g.pt||[]).forEach(p=>s+=`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="3.5" fill="#fbbf24"/>`);
  [].concat(g.ar||[]).forEach(r=>s+=`<path d="M${X(r[0])} ${Y(r[1])}L${X(r[2])} ${Y(r[3])}" stroke="#34d399" stroke-width="2" marker-end="url(#ah)"/><text x="${X(r[2])+4}" y="${Y(r[3])-4}" font-size="11" fill="#34d399">${esc(r[4]||'')}</text>`);
  return `<svg class="fig" viewBox="0 0 ${W} ${H}"><defs><marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6z" fill="#34d399"/></marker></defs>${s}</svg>`;
}
export function flow(t){
  const R=t.trim().split('\n').map(l=>l.split('->').map(x=>x.trim()).filter(Boolean)).filter(r=>r.length);
  if(!R.length) return '';
  const W=560,gp=26,n=Math.max(...R.map(r=>r.length)),bw=(W-gp*(n-1))/n,cpl=Math.max(6,Math.floor(bw/5.6));
  const wr=x=>{ const o=[]; let c=''; x.split(' ').forEach(w=>{ if(c&&(c+' '+w).length>cpl){o.push(c);c=w;} else c=c?c+' '+w:w; }); o.push(c); return o; };
  const Ls=R.map(r=>r.map(wr)), mx=Math.max(...Ls.flat().map(a=>a.length)), bh=14+13*mx, rh=bh+20; let s='';
  R.forEach((r,j)=>{ const y=j*rh+4;
    r.forEach((x,i)=>{ const X=i*(bw+gp), L=Ls[j][i], y0=y+(bh-13*L.length)/2+10;
      s+=`<rect x="${X}" y="${y}" width="${bw}" height="${bh}" rx="10" fill="#6366f133" stroke="#818cf8"/>`+
        L.map((a,k)=>`<text text-anchor="middle" font-size="10.5" fill="#e6e9f2" x="${X+bw/2}" y="${y0+13*k}">${esc(a)}</text>`).join('');
      if(i) s+=`<path d="M${X-gp+3} ${y+bh/2}H${X-3}" stroke="#34d399" stroke-width="2" marker-end="url(#fa)"/>`; }); });
  return `<svg class="fig" viewBox="0 0 ${W} ${R.length*rh}"><defs><marker id="fa" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6z" fill="#34d399"/></marker></defs>${s}</svg>`;
}

/* ---------------- markdown renderer (with quiz / fig / flow blocks) ---------------- */
let QUIZ_HOOK=null;
export const setQuizHook = fn => { QUIZ_HOOK=fn; };

export function md(t){
  const Z=[],F=[];
  t=String(t||'');
  t=t.replace(/```quiz\n([\s\S]*?)```/g,(m,b)=>{
    let h=''; try{ h=QUIZ_HOOK? QUIZ_HOOK(JSON.parse(b)) : '<p class="muted">[мини-тест]</p>'; }catch(e){ h='<p class="muted">[ошибка мини-теста]</p>'; }
    return '\n\u0002'+(F.push(h)-1)+'\u0002\n';
  });
  t=t.replace(/```(fig|flow)\n([\s\S]*?)```/g,(m,k,b)=>{
    let h=''; try{ h=k==='fig'?fig(JSON.parse(b)):flow(b); }catch(e){ h='<p class="muted">[ошибка рисунка]</p>'; }
    return '\n\u0002'+(F.push('<div class="figbox">'+h+'</div>')-1)+'\u0002\n';
  });
  t=t.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g,m=>'\u0001'+(Z.push(m)-1)+'\u0001');
  const I=s=>esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/\*(.+?)\*/g,'<i>$1</i>').replace(/`(.+?)`/g,'<code>$1</code>');
  let o='',L=null,T=0;
  const cl=()=>{ if(L){o+='</'+L+'>';L=null;} if(T){o+='</table>';T=0;} };
  for(const l of t.split('\n')){
    let m;
    if(/^\u0002\d+\u0002$/.test(l.trim())){ cl(); o+=l.trim(); continue; }
    if(m=l.match(/^(#{1,4})\s+(.*)/)){ cl(); const h=m[1].length+1; o+=`<h${h}>${I(m[2])}</h${h}>`; }
    else if(m=l.match(/^\s*([-*+]|\d+\.)\s+(.*)/)){ const k=/\d/.test(m[1])?'ol':'ul'; if(L!==k){cl();o+='<'+k+'>';L=k;} o+='<li>'+I(m[2])+'</li>'; }
    else if(/^\s*\|/.test(l)){
      if(/^[\s|:-]+$/.test(l)) continue;
      if(L) cl();
      const h=!T; if(h){o+='<table>';T=1;}
      o+='<tr>'+l.trim().replace(/^\||\|$/g,'').split('|').map(x=>`<${h?'th':'td'}>${I(x.trim())}</${h?'th':'td'}>`).join('')+'</tr>';
    }
    else { cl(); if(l.trim()) o+=`<p>${I(l)}</p>`; }
  }
  cl();
  return o.replace(/\u0001(\d+)\u0001/g,(_,i)=>esc(Z[i])).replace(/\u0002(\d+)\u0002/g,(_,i)=>F[i]);
}

/* ---------------- calculator ---------------- */
export const CALC_SUBJ=['physics','algebra','chemistry','biology'];
const CK={deg:true,ans:0,fresh:false,open:false,pos:[0,0]};
const CROWS=[['DEG','sin(','cos(','tan(','C'],['π','asin(','acos(','atan(','⌫'],['e','ln(','log(','√(','abs('],
  ['(',')','%','!','÷'],['7','8','9','×','^'],['4','5','6','−','x²'],['1','2','3','+','1/x'],['0','.','×10ˣ','ANS','=']];
export function calcEnsure(){
  if($('#calc') && $('#calc').dataset.ready) return;
  const d=$('#calc')||$('.calc');
  if(!d) return;
  d.dataset.ready='1'; d.hidden=true;
  d.innerHTML=`<div class="calc-h"><b>🧮 Калькулятор</b><button data-calc="close" aria-label="Закрыть">✕</button></div>
    <input id="cin" inputmode="none" autocomplete="off" spellcheck="false" placeholder="0">
    <div class="calc-out" id="cout">&nbsp;</div>
    <div class="ck">${CROWS.flat().map(k=>`<button data-k="${k}" class="${/^[\d.]$/.test(k)?'n':k==='='?'eq':/^[+−×÷^]$/.test(k)?'op':''}" data-calc="key">${k.length>1?k.replace('(',''):k}</button>`).join('')}</div>`;
  d.addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b) return;
    if(b.dataset.calc==='close'){ calcToggle(); return; }
    if(b.dataset.calc==='key') calcKey(b.dataset.k);
  });
  const i=$('#cin');
  i.addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();calcEq();} });
  i.addEventListener('input',()=>{CK.fresh=false});
  ['input','keyup','click','select','focus','mouseup'].forEach(ev=>i.addEventListener(ev,()=>{
    if(i.selectionStart!=null) CK.pos=[i.selectionStart,i.selectionEnd];
  }));
  calcDeg();
}
export function calcToggle(){ CK.open=!CK.open; calcEnsure(); calcSync(); if(CK.open) setTimeout(()=>{const i=$('#cin'); if(i) i.focus();},60); }
export function calcSync(){
  const d=$('#calc'); if(!d) return;
  const ok=CK.open && S.sub && CALC_SUBJ.includes(S.sub.id);
  d.hidden=!ok;
  document.querySelectorAll('[data-calc-toggle]').forEach(b=>b.classList.toggle('on',CK.open&&ok));
}
function calcDeg(){ const b=document.querySelector('#calc [data-k="DEG"]'); if(b) b.textContent=CK.deg?'DEG':'RAD'; }
function calcEval(src,deg,ans){
  const s=String(src).replace(/×/g,'*').replace(/÷/g,'/').replace(/[−–—]/g,'-').replace(/,/g,'.').replace(/π/g,' pi ').replace(/√/g,' sqrt ').toLowerCase();
  const T=[],re=/\s*(\d+\.?\d*|\.\d+|[a-z]+|[-+*\/^()!%])/y; let i=0,m;
  while(i<s.length){ re.lastIndex=i; m=re.exec(s); if(!m){ if(/^\s*$/.test(s.slice(i))) break; throw new Error('tok'); } T.push(m[1]); i=re.lastIndex; }
  if(!T.length) throw new Error('empty');
  let p=0; const pk=()=>T[p], nx=()=>T[p++];
  const R=x=>deg?x*Math.PI/180:x, D=x=>deg?x*180/Math.PI:x, Z=r=>Math.abs(r)<1e-12?0:r;
  const F={sin:x=>Z(Math.sin(R(x))),cos:x=>Z(Math.cos(R(x))),tan:x=>{const c=Math.cos(R(x)); if(Math.abs(c)<1e-12) throw new Error('tan'); return Z(Math.sin(R(x))/c);},
    asin:x=>D(Math.asin(x)),acos:x=>D(Math.acos(x)),atan:x=>D(Math.atan(x)),ln:Math.log,log:Math.log10,sqrt:Math.sqrt,abs:Math.abs};
  const fact=n=>{ if(n<0||n!==Math.floor(n)||n>170) throw new Error('fact'); let r=1; for(let k=2;k<=n;k++) r*=k; return r; };
  const close=()=>{ if(pk()===')') nx(); };
  function expr(){ let v=term(); while(pk()==='+'||pk()==='-') v=nx()==='+'?v+term():v-term(); return v; }
  function term(){ let v=unary(); for(;;){ const t=pk(); if(t==='*'){nx();v*=unary();} else if(t==='/'){nx();v/=unary();} else if(t!==undefined&&(t==='('||/^[\d.a-z]/.test(t))) v*=unary(); else return v; } }
  function unary(){ if(pk()==='-'){nx();return -unary();} if(pk()==='+'){nx();return unary();} return pow(); }
  function pow(){ const b=post(); if(pk()==='^'){nx();return Math.pow(b,unary());} return b; }
  function post(){ let v=atom(); for(;;){ if(pk()==='!'){nx();v=fact(v);} else if(pk()==='%'){nx();v/=100;} else return v; } }
  function atom(){ const t=nx(); if(t===undefined) throw new Error('end');
    if(/^[\d.]/.test(t)) return parseFloat(t);
    if(t==='('){ const v=expr(); close(); return v; }
    if(t==='pi') return Math.PI; if(t==='e') return Math.E; if(t==='ans') return ans||0;
    if(F[t]){ let a; if(pk()==='('){nx();a=expr();close();} else a=unary(); return F[t](a); }
    throw new Error('bad '+t); }
  const v=expr(); if(p<T.length) throw new Error('extra');
  if(!isFinite(v)||isNaN(v)) throw new Error('nan');
  return parseFloat(v.toPrecision(12));
}
function calcFmt(r){
  if(r!==0&&(Math.abs(r)>=1e15||Math.abs(r)<1e-6)){ const [m,e]=r.toExponential(6).split('e'); return m.replace(/\.?0+$/,'')+'×10^('+parseInt(e,10)+')'; }
  return String(r);
}
const cv=v=>{ const i=$('#cin'); if(!i) return; i.value=v; CK.pos=[v.length,v.length]; };
function calcPos(){ const i=$('#cin'); if(!i) return [0,0]; const n=i.value.length; let a=CK.pos?CK.pos[0]:n,b=CK.pos?CK.pos[1]:n; a=Math.min(Math.max(a,0),n); b=Math.min(Math.max(b,a),n); return [a,b]; }
function calcIns(t){ const i=$('#cin'); if(!i) return; if(CK.fresh&&/^[\dπ.(a-z√]/i.test(t)) cv(''); CK.fresh=false;
  const [a,b]=calcPos(); i.value=i.value.slice(0,a)+t+i.value.slice(b); CK.pos=[a+t.length,a+t.length]; }
function calcEq(){ const i=$('#cin'),o=$('#cout'); if(!i||!i.value.trim()) return;
  try{ const r=calcEval(i.value,CK.deg,CK.ans), f=calcFmt(r); CK.ans=r; o.classList.remove('err'); o.textContent=i.value+' = '+f; cv(f); CK.fresh=true; }
  catch(e){ o.classList.add('err'); o.textContent='Ошибка в выражении'; } }
function calcKey(k){
  const i=$('#cin'),o=$('#cout'); if(!i) return;
  if(k==='C'){ cv(''); o.classList.remove('err'); o.innerHTML='&nbsp;'; CK.fresh=false; return; }
  if(k==='DEG'){ CK.deg=!CK.deg; calcDeg(); return; }
  if(k==='='){ calcEq(); return; }
  if(k==='⌫'){ CK.fresh=false; const [a,b]=calcPos(); if(a!==b){i.value=i.value.slice(0,a)+i.value.slice(b);CK.pos=[a,a];} else if(a>0){i.value=i.value.slice(0,a-1)+i.value.slice(a);CK.pos=[a-1,a-1];} return; }
  if(k==='1/x'){ cv(i.value?'1/('+i.value+')':'1/('); CK.fresh=false; return; }
  calcIns(k==='x²'?'^2':k==='×10ˣ'?'×10^(':k==='ANS'?'ans':k);
}

/* ---------------- annotation layer ---------------- */
export const ANN={on:false,pan:false,tool:'p',color:'#ef4444',size:4,data:{},cv:null,cx:null,cur:null,raf:0,key:''};
const ACOL=['#ef4444','#f59e0b','#facc15','#22c55e','#3b82f6','#a855f7','#ffffff','#111111'];
function annKey(){
  if(S.sub) return S.sub.id+'|'+(S.tab||'')+'|'+(S.tab==='test'&&S.run?(S.run.done?'r':S.run.cur):'')+(S.tab==='cards'&&S.deck&&S.deck.q.length?'c'+S.deck.q[0]:'');
  return 'home';
}
export function annEnsure(){
  if(ANN.cv) return;
  const c=document.createElement('canvas'); c.id='ann'; c.className='ann'; document.body.appendChild(c);
  ANN.cv=c; ANN.cx=c.getContext('2d');
  c.addEventListener('pointerdown',annDown); c.addEventListener('pointermove',annMove);
  c.addEventListener('pointerup',annUp); c.addEventListener('pointercancel',annUp);
  if(window.ResizeObserver) new ResizeObserver(annSize).observe($('#main'));
  addEventListener('resize',annSize); annBar();
}
function annSize(){
  const c=ANN.cv; if(!c) return;
  const dpr=Math.min(window.devicePixelRatio||1,2), w=document.documentElement.clientWidth,
        h=Math.ceil(Math.max(innerHeight,$('#main').getBoundingClientRect().bottom+scrollY));
  if(c.style.width===w+'px'&&c.style.height===h+'px'&&c.width===Math.round(w*dpr)) return;
  c.style.width=w+'px'; c.style.height=h+'px'; c.width=Math.round(w*dpr); c.height=Math.round(h*dpr);
  ANN.cx.setTransform(dpr,0,0,dpr,0,0); annDraw();
}
function annStroke(k){
  const cx=ANN.cx; cx.save(); cx.lineCap=cx.lineJoin='round'; cx.lineWidth=k.s;
  if(k.t==='e'){ cx.globalCompositeOperation='destination-out'; cx.strokeStyle='#000'; }
  else { cx.strokeStyle=k.c; if(k.t==='m') cx.globalAlpha=.35; }
  cx.beginPath(); k.p.forEach((q,i)=> i?cx.lineTo(q[0],q[1]):cx.moveTo(q[0],q[1]));
  if(k.p.length===1) cx.lineTo(k.p[0][0]+.01,k.p[0][1]); cx.stroke(); cx.restore();
}
function annDraw(){
  const c=ANN.cv; if(!c) return;
  ANN.cx.save(); ANN.cx.setTransform(1,0,0,1,0,0); ANN.cx.clearRect(0,0,c.width,c.height); ANN.cx.restore();
  (ANN.data[ANN.key]||[]).forEach(annStroke);
}
const annPt=e=>[Math.round(e.pageX*10)/10,Math.round(e.pageY*10)/10];
function annDown(e){
  if(!ANN.on||ANN.pan) return; e.preventDefault();
  try{ ANN.cv.setPointerCapture(e.pointerId); }catch(x){}
  const k={t:ANN.tool,c:ANN.color,s:ANN.tool==='m'?ANN.size*3:ANN.tool==='e'?ANN.size*2:ANN.size,p:[annPt(e)]};
  (ANN.data[ANN.key]=ANN.data[ANN.key]||[]).push(k); ANN.cur=k; annDraw();
}
function annMove(e){ if(!ANN.cur) return; e.preventDefault(); ANN.cur.p.push(annPt(e));
  if(!ANN.raf) ANN.raf=requestAnimationFrame(()=>{ANN.raf=0;annDraw();}); }
function annUp(){ if(ANN.cur){ANN.cur=null;annDraw();} }
function annBar(){
  let b=$('#annbar'); if(!b) return;
  b.innerHTML=`<button data-t="p" title="Карандаш">✏️</button><button data-t="m" title="Маркер">🖍</button><button data-t="e" title="Ластик">🧽</button>
    <span class="sep"></span>${ACOL.map(c=>`<button class="sw" data-c="${c}" style="background:${c}" title="Цвет"></button>`).join('')}
    <input type="color" id="anncol" value="${ANN.color}" title="Свой цвет">
    <span class="sep"></span><input type="range" id="annsz" min="1" max="40" value="${ANN.size}" title="Размер кисти"><i class="pv" id="annpv"></i>
    <span class="sep"></span><button id="annpan" title="Прокрутка страницы">✋</button><button id="annundo" title="Отменить">↶</button>
    <button id="annclear" title="Очистить">🗑</button><button id="anntoggle" title="Выйти из режима">✕ Готово</button>`;
  b.hidden=true;
  b.onclick=e=>{
    const t=e.target.closest('button'); if(!t) return;
    if(t.dataset.t){ ANN.tool=t.dataset.t; annSync(); }
    else if(t.dataset.c){ annColor(t.dataset.c); }
    else if(t.id==='annpan'){ ANN.pan=!ANN.pan; annSync(); }
    else if(t.id==='annundo'){ annUndo(); }
    else if(t.id==='annclear'){ annClear(); }
    else if(t.id==='anntoggle'){ annToggle(); }
  };
  b.querySelector('#anncol').oninput=e=>annColor(e.target.value);
  b.querySelector('#annsz').oninput=e=>{ ANN.size=+e.target.value; annSync(); };
}
export function annColor(c){ ANN.color=c; if(ANN.tool==='e') ANN.tool='p'; const i=$('#anncol'); if(i&&/^#[0-9a-f]{6}$/i.test(c)) i.value=c; annSync(); }
export function annUndo(){ const a=ANN.data[ANN.key]; if(a&&a.length){a.pop();annDraw();} }
export async function annClear(){
  const a=ANN.data[ANN.key]; if(!a||!a.length){ toast('Здесь пока нет рисунка'); return; }
  if(await ask('Стереть весь рисунок на этой странице?','Стереть')){ ANN.data[ANN.key]=[]; annDraw(); }
}
export function annToggle(){ annEnsure(); ANN.on=!ANN.on; ANN.pan=false; ANN.key=annKey(); annSize(); annSync(); }
export function annSync(){
  const c=ANN.cv, b=$('#annbar'); if(!c||!b) return;
  c.style.pointerEvents=ANN.on&&!ANN.pan?'auto':'none';
  c.style.cursor=ANN.tool==='e'?'cell':'crosshair';
  b.hidden=!ANN.on;
  b.querySelectorAll('[data-t]').forEach(x=>x.classList.toggle('on',x.dataset.t===ANN.tool));
  b.querySelectorAll('[data-c]').forEach(x=>x.classList.toggle('on',x.dataset.c===ANN.color));
  const pb=b.querySelector('#annpan'); if(pb) pb.classList.toggle('on',ANN.pan);
  const pv=b.querySelector('#annpv'); if(pv){ pv.style.width=pv.style.height=Math.max(4,Math.min(ANN.size*(ANN.tool==='m'?3:1),34))+'px'; pv.style.background=ANN.tool==='e'?'#888':ANN.color; }
  document.querySelectorAll('[data-ann-toggle]').forEach(x=>x.classList.toggle('on',ANN.on));
}
export function annRefresh(){ annEnsure(); ANN.key=annKey(); annSize(); annDraw(); annSync(); }
export function annDrop(id){ Object.keys(ANN.data).forEach(k=>{ if(k.startsWith(id+'|')) delete ANN.data[k]; }); annDraw(); }
