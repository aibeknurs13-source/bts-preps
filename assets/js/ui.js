/* ===========================================================
   ui.js — views, router, interactions
   =========================================================== */
import * as C from './core.js';
import { $, $$, esc, sv, rd, rm, gsv, grd, dbAll, dbGet, dbPut, dbDel, dbClearAccount,
         toast, openModal, closeModal, ask, nowId, sleep, dayKey, fmtDate, fmtBytes,
         kx, md, setQuizHook, calcToggle, calcSync, annRefresh, annToggle, annDrop,
         SUBS, LEVELS, LV_ORDER, S, fingerprint, similar, seenList, seenAdd, seenTexts,
         normText, uidShort, clamp } from './core.js';
import { getSettings, saveSettings, PROVIDERS, aiAsk, generateTest, generateCards, generateNotes,
         extractJSON, chunkText, localTopics, localTest, normQuestion, providerLabel, buildTopicPrompt } from './ai.js';
import { parseFile, ACCEPT } from './ingest.js';

/* ================= helpers ================= */
const QK=['A','B','C','D'];
const lvlName = l=> (LEVELS[l]||LEVELS.B).n;
const lvlShort = l=> (LEVELS[l]||LEVELS.B).short;

function meta(){
  const d=rd('meta',{})||{};
  return {pts:d.pts||0, streak:d.streak||0, best:d.best||0, last:d.last||''};
}
function effStreak(){
  const m=meta(), y=new Date(); y.setDate(y.getDate()-1);
  return (m.last===dayKey()||m.last===dayKey(y))?m.streak:0;
}
function bump(p){
  const m=meta(), t=dayKey();
  if(m.last!==t){ m.streak=effStreak()+1; m.last=t; m.best=Math.max(m.best,m.streak); }
  m.pts+=p||0; sv('meta',m);
  const el=$('#statPill'); if(el) el.textContent=`🔥 ${effStreak()} · ⭐ ${m.pts}`;
}
function topicStats(){ return rd('topics',{})||{}; }
function saveTopicStat(topic,rec){
  const t=topicStats(); const old=t[topic]||{attempts:0,best:0,wrong:0};
  t[topic]={attempts:old.attempts+(rec.attempts||0), best:Math.max(old.best||0,rec.best||0),
            wrong:(old.wrong||0)+(rec.wrong||0), last:Date.now(), lastLevel:rec.level||old.lastLevel||''};
  sv('topics',t);
}
const hintSteps=q=>[].concat(q.h||[],'#5050');
function hintInfo(q,hn,fn){
  const steps=hintSteps(q); const gone=[]; let li='';
  steps.slice(0,hn).forEach(s=>{
    if(s==='#5050'){ const w=QK.filter(k=>k!==q.c); const keep=w[hash32(q.q)%3]; gone.push(...w.filter(k=>k!==keep)); li+='<li>Два неверных варианта убраны</li>'; }
    else li+='<li>'+esc(s)+'</li>';
  });
  const btn=(fn&&hn<steps.length)?`<div class="row" style="justify-content:flex-start;margin:8px 0">
      <button class="btn ghost sm" data-act="hint" ${fn.startsWith('run')?'':''}>💡 Подсказка (${hn}/${steps.length})</button>
      <span class="muted small">за подсказки очков меньше</span></div>`:'';
  return {gone, box:(li?`<div class="hintbox"><ul>${li}</ul></div>`:'')+btn};
}
function hash32(s){ let h=2166136261; const n=normText(s); for(let i=0;i<n.length;i++){ h^=n.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0); }

/* ================= router ================= */
const ROUTES={};
function route(){ return (location.hash||'#home').replace(/^#/,''); }
function navigate(path){ location.hash=path; }
window.addEventListener('hashchange',()=>{ closeModal(); render(); window.scrollTo(0,0); });

/* ================= shell ================= */
function renderRail(){
  const subs=SUBS.concat(rd('subs',[])||[]);
  const r=route();
  const nav=[['home','🏠','Главная'],['gen','✨','AI-генератор'],['docs','📄','Документы'],['dash','📊','Прогресс'],['settings','⚙️','Настройки']];
  $('#railNav').innerHTML=nav.map(([id,ic,n])=>{
    const on=r===id||(id==='home'&&r.startsWith('sub/'))||(id==='docs'&&r.startsWith('doc/'));
    return `<button class="rail-item ${on?'on':''}" data-act="nav" data-v="${id}"><span class="ico">${ic}</span><span>${n}</span></button>`;
  }).join('');
  $('#railSubs').innerHTML=subs.map(s=>`<button class="rail-item ${r==='sub/'+s.id?'on':''}" data-act="nav" data-v="sub/${s.id}">
      <span class="rail-sub-dot" style="background:${s.c}"></span><span>${esc(s.n)}</span></button>`).join('');
  $('#tabs').innerHTML=nav.slice(0,4).map(([id,ic,n])=>{
    const on=r===id||(id==='home'&&r.startsWith('sub/'))||(id==='docs'&&r.startsWith('doc/'));
    return `<button class="${on?'on':''}" data-act="nav" data-v="${id}"><span>${ic}</span>${n}</button>`;
  }).join('');
  const st=meta();
  $('#statPill').textContent=`🔥 ${effStreak()} · ⭐ ${st.pts}`;
  $('#authName').textContent=S.user&&S.user.em!=='guest'?(S.user.name||'Аккаунт'):'Войти';
}

function shell(html){ $('#main').innerHTML=html; }
function afterRender(){ C.kx(); C.annRefresh(); C.calcSync(); renderRail(); }

/* ================= HOME ================= */
ROUTES.home=async ()=>{
  const subs=SUBS.concat(rd('subs',[])||[]);
  const mats=(await dbAll('mat')).filter(m=>m.uid===C.ACC()).sort((a,b)=>b.created-a.created);
  const docs=(await dbAll('docs')).filter(d=>d.uid===C.ACC()).sort((a,b)=>b.created-a.created);
  const m=meta();
  const tiles=[
    ['✨','AI-генератор','Тесты, карточки, конспекты — 3 уровня','gen'],
    ['📄','Загрузить файл','PDF, DOCX, PPTX, TXT → ИИ прочитает','upload'],
    ['🗂','Моя библиотека',docs.length?`${docs.length} док. · ${mats.length} материалов`:'Пока пусто','docs'],
    ['📊','Прогресс и ошибки',`🔥 ${effStreak()} · ⭐ ${m.pts}`,'dash']
  ];
  const recent=mats.slice(0,6);
  shell(`<div class="page-head">
      <div><h1>Привет${S.user&&S.user.em!=='guest'&&S.user.name?', '+esc(S.user.name.split(' ')[0]):''} 👋</h1>
      <p class="sub">Загрузите конспект или PDF — ИИ сам составит тесты, карточки и разберёт тему по уровням A / B / C.</p></div>
      <div class="spacer"></div>
      <button class="btn" data-act="nav" data-v="gen">✨ Сгенерировать</button>
    </div>
    <div class="tiles">${tiles.map(([i,b,s,a])=>`<button class="tile" data-act="${a==='upload'?'upload':'nav'}" data-v="${a}">
        <span class="ti">${i}</span><span><b>${b}</b><span>${s}</span></span></button>`).join('')}</div>
    <div class="row between" style="margin:26px 0 12px"><h2>Предметы</h2>
      <button class="btn ghost sm" data-act="nav" data-v="gen">+ Новая тема</button></div>
    <div class="subs">${subs.map(s=>{
      const sm=mats.filter(x=>x.subject===s.id).length;
      return `<div class="sub-card" style="--sc:${s.c}" data-act="nav" data-v="sub/${s.id}">
        <div class="sub-ico">${s.e}</div><b>${esc(s.n)}</b><div class="ru">${esc(s.ru||'')}</div>
        <div class="sub-meta">${sm?`<span class="badge">${sm} материалов</span>`:'<span class="badge">пусто</span>'}</div>
      </div>`;}).join('')}</div>
    ${recent.length?`<div class="row between" style="margin:26px 0 12px"><h2>Последнее</h2></div>
      <div class="grid g2">${recent.map(matCard).join('')}</div>`:''}`);
  afterRender();
};

/* ================= material card ================= */
function matCard(m){
  const ico={test:'📝',cards:'🗂',note:'📘'}[m.kind]||'📄';
  const lv=m.kind==='test'?`<span class="badge lv${m.level}">${lvlShort(m.level)}</span>`:'';
  const qn=m.kind==='test'?`${(m.questions||[]).length} вопросов`:m.kind==='cards'?`${(m.cards||[]).length} карточек`:'конспект';
  return `<div class="card" data-act="openMat" data-id="${m.id}" style="cursor:pointer">
    <div class="row between" style="align-items:flex-start">
      <div style="min-width:0">
        <b style="font-family:var(--f-head)">${ico} ${esc(m.title||'Материал')}</b>
        <div class="muted small" style="margin-top:3px">${esc(m.topic||'')} · ${qn} · ${fmtDate(m.created)}</div>
      </div>
      ${lv}
    </div>
    ${m.stats&&m.stats.best?`<div class="row small muted" style="margin-top:10px">Лучший результат: <b>${m.stats.best}%</b> · попыток: ${m.stats.attempts||1}</div>`:''}
  </div>`;
}

/* ================= SUBJECT ================= */
ROUTES['sub']=async (id)=>{
  const subs=SUBS.concat(rd('subs',[])||[]);
  const sub=subs.find(s=>s.id===id); if(!sub){ navigate('home'); return; }
  S.sub=sub;
  const all=(await dbAll('mat')).filter(m=>m.uid===C.ACC()&&m.subject===id).sort((a,b)=>b.created-a.created);
  const docs=(await dbAll('docs')).filter(d=>d.uid===C.ACC()&&d.subject===id);
  const tab=S.tab||'test';
  const tests=all.filter(m=>m.kind==='test'), cards=all.filter(m=>m.kind==='cards'), notes=all.filter(m=>m.kind==='note');
  const ts=topicStats();
  const levels={A:0,B:0,C:0}; tests.forEach(t=>(t.questions||[]).forEach(q=>{ if(levels[q.level]!=null) levels[q.level]++; }));
  const wrong=(rd('wrong',[])||[]).filter(w=>!w.sub||w.sub===id).length;

  shell(`<div class="page-head">
      <div class="row" style="align-items:center;gap:14px">
        <div class="sub-ico" style="--sc:${sub.c};background:color-mix(in srgb,${sub.c} 22%,transparent);border:1px solid color-mix(in srgb,${sub.c} 45%,transparent);margin:0">${sub.e}</div>
        <div><h1>${esc(sub.n)}</h1><p class="sub">${esc(sub.ru||'')}</p></div>
      </div>
      <div class="spacer"></div>
      <button class="btn" data-act="nav" data-v="gen" data-sub="${id}">✨ Сгенерировать</button>
    </div>
    <div class="tabs-row">
      ${[['test','📝 Тесты'],['cards','🗂 Карточки'],['note','📘 Конспекты'],['rev','🔁 Ошибки'+(wrong?' ('+wrong+')':'')]]
        .map(([k,n])=>`<button class="${tab===k?'on':''}" data-act="subtab" data-tab="${k}" data-sub="${id}">${n}</button>`).join('')}
    </div>
    ${tab==='test'?`
      <div class="row" style="margin-bottom:14px">
        <span class="count-pill">A · ${levels.A}</span><span class="count-pill">B · ${levels.B}</span><span class="count-pill">C · ${levels.C}</span>
        <span class="muted small">всего тестов: ${tests.length}</span>
      </div>
      ${tests.length?`<div class="grid g2">${tests.map(matCard).join('')}</div>`:
        `<div class="empty"><div class="big-emo">📝</div><b>Тестов пока нет</b>
         <p class="muted">Сгенерируйте первый вариант по этому предмету — 20–40 вопросов, уровни A/B/C.</p>
         <button class="btn" data-act="nav" data-v="gen" data-sub="${id}">Создать тест</button></div>`}
    `:tab==='cards'?`
      ${cards.length?`<div class="grid g2">${cards.map(matCard).join('')}</div>`:
        `<div class="empty"><div class="big-emo">🗂</div><b>Карточек пока нет</b>
         <p class="muted">ИИ составит карточки для запоминания по вашему материалу.</p>
         <button class="btn" data-act="nav" data-v="gen" data-sub="${id}" data-kind="cards">Создать карточки</button></div>`}
    `:tab==='note'?`
      ${notes.length?`<div class="grid g2">${notes.map(matCard).join('')}</div>`:
        `<div class="empty"><div class="big-emo">📘</div><b>Конспектов пока нет</b>
         <p class="muted">ИИ соберёт структурированный конспект с мини-тестом внутри.</p>
         <button class="btn" data-act="nav" data-v="gen" data-sub="${id}" data-kind="note">Создать конспект</button></div>`}
    `:`
      ${wrong?`<div class="panel" style="padding:16px">
          <b>🔁 Повтор ошибок</b><p class="muted small">Ошибки возвращаются через 10 минут, затем через 1 день и через 3 дня.</p>
          <button class="btn sm" style="margin-top:10px" data-act="revStart" data-sub="${id}">Начать повторение</button></div>`:
        `<div class="empty"><div class="big-emo">✅</div><b>Ошибок пока нет</b><p class="muted">Здесь появятся вопросы, на которых вы ошиблись.</p></div>`}
    `}
    ${docs.length?`<div class="row between" style="margin:26px 0 10px"><h2>Материалы предмета</h2></div>
      ${docs.map(d=>docRow(d)).join('')}`:''}
    <div class="row" style="margin-top:26px">
      <button class="btn ghost sm" data-act="upload" data-sub="${id}">📎 Добавить файл к предмету</button>
    </div>`);
  afterRender();
};

/* ================= DOCUMENTS ================= */
function docRow(d){
  const ic={pdf:'📕',docx:'📘',pptx:'📙',image:'🖼',txt:'📄',md:'📝',csv:'📊'}[d.kind]||'📄';
  const topics=(d.topics||[]).length;
  return `<div class="doc">
    <div class="doc-ico">${ic}</div>
    <div style="flex:1;min-width:0">
      <b>${esc(d.name)}</b>
      <div class="meta">${fmtBytes(d.size||0)} · ${esc((d.text||'').length.toLocaleString('ru-RU'))} симв. · ${fmtDate(d.created)}${topics?` · тем: ${topics}`:''}</div>
    </div>
    <button class="btn ghost sm" data-act="openDoc" data-id="${d.id}">Открыть</button>
    <button class="btn ghost sm" data-act="delDoc" data-id="${d.id}" title="Удалить">🗑</button>
  </div>`;
}
ROUTES.docs=async ()=>{
  const docs=(await dbAll('docs')).filter(d=>d.uid===C.ACC()).sort((a,b)=>b.created-a.created);
  shell(`<div class="page-head"><div><h1>📄 Мои документы</h1>
      <p class="sub">Загруженные файлы и их темы. ИИ читает их локально в вашем браузере.</p></div>
      <div class="spacer"></div><button class="btn" data-act="upload">+ Загрузить файл</button></div>
    ${docs.length?docs.map(docRow).join(''):`<div class="empty"><div class="big-emo">📂</div><b>Файлов пока нет</b>
      <p class="muted">Нажмите «+» или «Загрузить файл» — PDF, DOCX, PPTX, TXT, MD, CSV и картинки (OCR).</p>
      <button class="btn" data-act="upload">Загрузить файл</button></div>`}`);
  afterRender();
};

ROUTES['doc']=async (id)=>{
  const d=await dbGet('docs',id);
  if(!d){ navigate('docs'); return; }
  S.doc=d;
  const subs=SUBS.concat(rd('subs',[])||[]);
  const subsOpts=subs.map(s=>`<option value="${s.id}" ${d.subject===s.id?'selected':''}>${esc(s.n)}</option>`).join('');
  shell(`<div class="page-head">
      <div><h1>${esc(d.name)}</h1><p class="sub">${fmtBytes(d.size||0)} · загружен ${fmtDate(d.created)}</p></div>
      <div class="spacer"></div>
      <button class="btn" data-act="nav" data-v="gen" data-doc="${d.id}">✨ Сгенерировать по документу</button>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="row">
        <b>Тема материала</b>
        <select class="field" style="width:auto" data-act="docSub" data-id="${d.id}">${subsOpts}<option value="">— без предмета —</option></select>
      </div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="row between">
        <b>Темы, найденные ИИ</b>
        <button class="btn ghost sm" data-act="docTopics" data-id="${d.id}">🔍 Выделить темы</button>
      </div>
      <div class="row" style="margin-top:12px" id="docTopicsBox">
        ${(d.topics&&d.topics.length)?d.topics.map(t=>`<span class="chip" data-act="genFromTopic" data-doc="${d.id}" data-topic="${esc(t.title)}">${esc(t.title)}</span>`).join(''):
          '<span class="muted small">Темы ещё не выделены. Нажмите «Выделить темы» — ИИ прочитает документ и разобьёт его на темы.</span>'}
      </div>
    </div>
    <details class="card"><summary><b>📖 Текст документа</b></summary>
      <div class="note" style="margin-top:12px;max-height:60vh;overflow:auto;white-space:pre-wrap">${esc(d.text||'—')}</div>
    </details>`);
  afterRender();
};

/* ================= AI GENERATOR ================= */
const GEN={src:'topic', docId:'', topic:'', kind:'test', level:'MIX', count:20, topics:[], subject:'', busy:false, steps:[], abort:false};

ROUTES.gen=async ()=>{
  const docs=(await dbAll('docs')).filter(d=>d.uid===C.ACC()).sort((a,b)=>b.created-a.created);
  const subs=SUBS.concat(rd('subs',[])||[]);
  if(!GEN.topic && S.sub) GEN.subject=S.sub.id;
  const counts=[10,20,25,30,40];
  const docOpts=docs.map(d=>`<option value="${d.id}" ${GEN.docId===d.id?'selected':''}>${esc(d.name)}</option>`).join('');
  const levelPills=LV_ORDER.concat(['MIX']).map(l=>{
    const c=l==='MIX'?'lvM':('lv'+l);
    const lab=l==='MIX'?'Смешанный A/B/C':lvlName(l);
    return `<button class="opt-pill ${c} ${GEN.level===l?'on':''}" data-act="genLevel" data-l="${l}">${lab}</button>`;
  }).join('');
  const kindPills=[['test','📝 Тест'],['cards','🗂 Карточки'],['note','📘 Конспект']].map(([k,n])=>
    `<button class="opt-pill ${GEN.kind===k?'on':''}" data-act="genKind" data-k="${k}">${n}</button>`).join('');

  shell(`<div class="page-head"><div><h1>✨ AI-генератор</h1>
      <p class="sub">Работает по любой теме и по вашим файлам. Уровни A / B / C, без повторов, 20–40 вопросов.</p></div>
      <div class="spacer"></div>
      <span class="badge">Модель: ${esc(providerLabel())}</span></div>

    <div class="wizard">
      <div class="wstep"><div class="wstep-n">1</div><div class="wstep-body">
        <b>Источник</b>
        <div class="opts-grid" style="margin-bottom:10px">
          <button class="opt-pill ${GEN.src==='topic'?'on':''}" data-act="genSrc" data-s="topic">✍️ Своя тема</button>
          <button class="opt-pill ${GEN.src==='doc'?'on':''}" data-act="genSrc" data-s="doc">📄 Мой документ</button>
        </div>
        ${GEN.src==='topic'?`
          <input class="field" id="genTopic" placeholder="Например: Квадратные уравнения / Тригометрия / Правовая система РК" value="${esc(GEN.topic)}" data-act="genTopicInput">
          <p class="muted small" style="margin:8px 0 0">Тема любая — ИИ подстроится под предмет и уровень.</p>`
        :`
          <select class="field" data-act="genDocSel">${docOpts||'<option value="">Нет загружённых документов</option>'}</select>
          ${GEN.docId&&GEN.topics&&GEN.topics.length?`<div class="row" style="margin-top:10px"><span class="muted small">Темы из документа:</span></div>
            <div class="row" style="margin-top:6px">${GEN.topics.map(t=>`<span class="chip ${GEN.topic===t.title?'on':''}" data-act="genPickTopic" data-t="${esc(t.title)}">${esc(t.title)}</span>`).join('')}</div>`:''}
          ${!docs.length?'<p class="muted small" style="margin-top:8px">Сначала загрузите файл кнопкой «+».</p>':''}`}
      </div></div>

      <div class="wstep"><div class="wstep-n">2</div><div class="wstep-body">
        <b>Что создать</b>
        <div class="opts-grid">${kindPills}</div>
        <div class="row" style="margin-top:12px">
          <span class="muted small">Предмет:</span>
          <select class="field" style="width:auto" data-act="genSubject">
            <option value="">— без предмета —</option>
            ${subs.map(s=>`<option value="${s.id}" ${GEN.subject===s.id?'selected':''}>${esc(s.n)}</option>`).join('')}
          </select>
          <input class="field" style="flex:1;min-width:170px" id="genNewSub" placeholder="+ свой предмет (необязательно)" value="${esc(GEN.newSub||'')}" data-act="genNewSub">
        </div>
      </div></div>

      <div class="wstep"><div class="wstep-n">3</div><div class="wstep-body">
        <b>Уровень сложности</b>
        <div class="opts-grid">${levelPills}</div>
        <p class="muted small" style="margin:8px 0 0">${GEN.level==='MIX'?'A — базовый, B — средний, C — сложный (многошаговые задачи и ловушки).':LEVELS[GEN.level].d}</p>
        ${GEN.kind==='test'?`<div style="margin-top:14px"><b style="display:block;margin-bottom:8px">Количество вопросов</b>
          <div class="opts-grid">${counts.map(c=>`<button class="opt-pill ${GEN.count===c?'on':''}" data-act="genCount" data-c="${c}">${c}</button>`).join('')}</div>
          <p class="muted small" style="margin:8px 0 0">Рекомендуется 20–40 вопросов на тему. Больше вопросов = дольше генерация.</p></div>`:''}
      </div></div>

      <div class="wstep"><div class="wstep-n">4</div><div class="wstep-body">
        <b>Генерация</b>
        <div class="row">
          <button class="btn" data-act="genStart" ${GEN.busy?'disabled':''}>${GEN.busy?'<span class="spin"></span> Генерация…':'⚡ Сгенерировать'}</button>
          ${GEN.busy?'<button class="btn ghost" data-act="genStop">Остановить</button>':''}
          <span class="muted small">Прогресс появится здесь</span>
        </div>
        <div id="genProg" class="progress-wrap">${renderGenSteps()}</div>
        <p class="muted small" style="margin:10px 0 0">⏱ У Pollinations бесплатный лимит — 1 запрос в 45 секунд, поэтому генерация может идти с паузами.
          <button class="chip" data-act="nav" data-v="settings" style="margin-left:6px">Добавить бесплатный ключ Gemini/Groq →</button></p>
      </div></div>
    </div>

    <div id="genResult" style="margin-top:18px"></div>`);
  afterRender();
};
function renderGenSteps(){
  if(!GEN.steps.length) return '';
  return `<div class="progress-steps">${GEN.steps.map(s=>`<div class="pstep ${s.state}"><span class="d">${s.state==='done'?'✓':s.state==='act'?'<span class="spin"></span>':''}</span><span>${esc(s.text)}</span></div>`).join('')}</div>`;
}
function setGenSteps(steps){ GEN.steps=steps; const b=$('#genProg'); if(b) b.innerHTML=renderGenSteps(); }
function genStep(text,state='act'){ GEN.steps.push({text,state}); setGenSteps(GEN.steps); }

/* ================= generation flow ================= */
async function runGeneration(){
  const topic=(GEN.src==='doc'&&GEN.topic)?GEN.topic:(GEN.topic||'').trim();
  if(!topic){ toast('Укажите тему','err'); return; }
  GEN.busy=true; GEN.abort=false; GEN.steps=[];
  const body=$('#main');
  setGenSteps([]);
  let subs=SUBS.concat(rd('subs',[])||[]);
  let subject=GEN.subject||'';
  if((GEN.newSub||'').trim()){
    const nm=GEN.newSub.trim();
    let found=subs.find(s=>s.n.toLowerCase()===nm.toLowerCase());
    if(!found){
      const pal=['#7c6cff','#22c55e','#f59e0b','#a855f7','#06b6d4','#ef4444','#f472b6','#14b8a6'];
      const id='c_'+nm.toLowerCase().replace(/[^a-zа-я0-9]+/gi,'_').slice(0,28)+'_'+Math.random().toString(36).slice(2,5);
      found={id, n:nm, ru:nm, e:'📘', c:pal[Math.floor(Math.random()*pal.length)], custom:1};
      const list=rd('subs',[])||[]; list.push(found); sv('subs',list);
      subs=subs.concat([found]);
    }
    subject=found.id;
    GEN.subject=subject;
  }
  let material='';
  let docId='';
  if(GEN.src==='doc'&&GEN.docId){
    const d=await dbGet('docs',GEN.docId);
    if(d){ docId=d.id; material=chunkText(d.text,6000)[0]; }
  }
  if(!topic && docId){ const d=await dbGet('docs',docId); if(d) GEN.topic=d.name; }
  GEN.material=material;
  let finished=null, offline=false;
  try{
    let res;
    if(GEN.kind==='test'){
      genStep('Готовим запрос к модели…','act');
      res=await generateTest({
        topic, level:GEN.level, count:GEN.count, material, subject,
        seed:Date.now()%100000
      },st=>{ GEN.steps=GEN.steps.slice(0,-1); genStep(st.text,st.done>=st.total?'done':'act');
              if(st.type==='wait') toast(st.text); });
      genStep(`Получено вопросов: ${res.questions.length}`,'done');
      const mat={id:nowId('test'), uid:C.ACC(), kind:'test', subject, topic, title:`${topic} · ${lvlShort(GEN.level)}`,
        level:GEN.level, questions:res.questions, created:Date.now(), stats:{attempts:0,best:0}, source:docId};
      await dbPut('mat',mat);
      seenAdd(res.questions.map(q=>({f:fingerprint(q.q),t:q.q.slice(0,150),l:q.level,s:subject,tp:topic})));
      finished=mat;
      toast('Тест готов ✅');
    }else if(GEN.kind==='cards'){
      genStep('Готовим запрос к модели…','act');
      res=await generateCards({topic,count:Math.min(40,GEN.count||20),material,subject},
        st=>{ GEN.steps=GEN.steps.slice(0,-1); genStep(st.text,st.done>=st.total?'done':'act');
              if(st.type==='wait') toast(st.text); });
      genStep(`Получено карточек: ${res.cards.length}`,'done');
      const mat={id:nowId('cards'), uid:C.ACC(), kind:'cards', subject, topic, title:`${topic} · карточки`,
        cards:res.cards, created:Date.now(), stats:{attempts:0,best:0}, source:docId};
      await dbPut('mat',mat);
      seenAdd(res.cards.map(c=>({f:fingerprint(c.f),t:c.f.slice(0,150),l:c.level,s:subject,tp:topic})));
      finished=mat;
      toast('Карточки готовы ✅');
    }else{
      genStep('Собираем конспект…','act');
      res=await generateNotes({topic,level:GEN.level,material,subject});
      genStep('Конспект готов','done');
      const mat={id:nowId('note'), uid:C.ACC(), kind:'note', subject, topic, title:res.title||topic,
        markdown:res.markdown, quiz:res.quiz, created:Date.now(), stats:{attempts:0,best:0}, source:docId};
      await dbPut('mat',mat);
      finished=mat;
      toast('Конспект готов ✅');
    }
  }catch(e){
    genStep('Ошибка: '+(e.message||e),'done');
    offline=true;
    toast('AI недоступен — есть офлайн-вариант','err');
  }
  GEN.busy=false;
  await render();
  if(finished) renderGenResult(finished);
  else if(offline) offerOffline(topic,material);
}
function offerOffline(topic,material){
  const b=$('#genResult');
  if(!b) return false;
  const txt=material||GEN.topic||'';
  b.innerHTML=`<div class="card" style="margin-top:14px">
    <b>AI недоступен</b>
    <p class="muted small">Проверьте настройки модели (бесплатные провайдеры — в Настройках). Можно составить простой офлайн-тест из текста.</p>
    <button class="btn sm" data-act="genOffline" data-topic="${esc(topic)}">Сделать офлайн-тест</button></div>`;
  return true;
}
function renderGenResult(mat){
  const b=$('#genResult'); if(!b) return;
  const extra=mat.kind==='test'?`${mat.questions.length} вопросов · уровни ${[...new Set(mat.questions.map(q=>q.level))].join(', ')}`
    :mat.kind==='cards'?`${mat.cards.length} карточек`:`${mat.quiz?(mat.quiz.qs||[]).length:0} вопросов в мини-тесте`;
  b.innerHTML=`<div class="card" style="margin-top:14px;border-color:var(--ac)">
    <div class="row between"><b>✅ Готово: ${esc(mat.title)}</b><span class="badge new">${esc(extra)}</span></div>
    <div class="row" style="margin-top:12px">
      <button class="btn sm" data-act="openMat" data-id="${mat.id}">Открыть</button>
      ${mat.kind==='test'?`<button class="btn ghost sm" data-act="startMat" data-id="${mat.id}">▶ Начать тест</button>`:''}
      ${mat.kind==='cards'?`<button class="btn ghost sm" data-act="startMat" data-id="${mat.id}">▶ Учить карточки</button>`:''}
    </div></div>`;
}

/* ================= TEST RUNNER ================= */
function saveRun(){ if(S.run) sv('run:'+(S.run.mat.subject||'_')+':'+S.run.mat.id, S.run); }
function startMat(id,filterLevel){
  const mat=dbGet('mat',id).then(m=>m);
  mat.then(m=>{
    if(!m) return;
    if(m.kind==='test') startTest(m,filterLevel);
    else if(m.kind==='cards') startCards(m);
    else openNote(m);
  });
}
function startTest(mat,filterLevel){
  const qs=(mat.questions||[]).filter(q=>!filterLevel||q.level===filterLevel);
  if(!qs.length){ toast('Нет вопросов этого уровня','err'); return; }
  S.run={mat, qs, cur:-1, ans:{}, hn:{}, done:0, t0:Date.now(), pts:0, paid:0, streak:0, miss:0,
         pool:'ALL', next:null};
  S.tab='test';
  pickNext();
  navigate('run/'+mat.id);
}
function pickNext(){
  const r=S.run; if(!r) return;
  const ans=r.ans;
  const rem=r.qs.map((q,i)=>i).filter(i=>ans[i]===undefined && i!==r.cur);
  if(!rem.length){ r.next=null; return; }
  const pool=r.pool==='ALL'?rem:rem.filter(i=>r.qs[i].level===r.pool);
  const cand=pool.length?pool:rem;
  const want=r.streak>=2?'C':(r.miss>=2?'A':(r.pool==='ALL'?'B':r.pool));
  const order=want==='C'?['C','B','A']:want==='A'?['A','B','C']:['B','C','A'];
  for(const L of order){ const hit=cand.find(i=>r.qs[i].level===L); if(hit!==undefined){ r.next=hit; return; } }
  r.next=cand[0];
}
ROUTES['run']=async (id)=>{
  const mat=await dbGet('mat',id);
  if(!mat){ navigate('home'); return; }
  if(!S.run||S.run.mat.id!==id){
    const saved=rd('run:'+(mat.subject||'_')+':'+id,null);
    if(saved&&saved.mat&&saved.mat.id===id&&!saved.done){ S.run=saved; S.run.mat=mat; }
    else startTest(mat);
  }
  const r=S.run;
  if(r.done) return renderResults(mat);
  if(r.cur<0||r.next==null) pickNext();
  const idx=r.cur<0?r.next:r.cur;
  if(idx==null||idx<0){ renderResults(mat); return; }
  r.cur=idx;
  const q=r.qs[idx];
  const hi=hintInfo(q,(r.hn||{})[idx]||0,'');
  const sel=r.ans[idx];
  const done=Object.keys(r.ans).length;
  const lvl=(LEVELS[q.level]||LEVELS.B);
  shell(`<div class="run-top">
      <div class="ring"><svg width="62" height="62"><circle cx="31" cy="31" r="26" stroke="var(--bd2)" stroke-width="6" fill="none"/>
        <circle cx="31" cy="31" r="26" stroke="${lvl.c}" stroke-width="6" fill="none" stroke-linecap="round"
          stroke-dasharray="${2*Math.PI*26}" stroke-dashoffset="${2*Math.PI*26*(1-done/Math.max(1,r.qs.length))}" transform="rotate(-90 31 31)"/></svg>
        <div class="pct">${done}/${r.qs.length}</div></div>
      <div style="flex:1;min-width:0">
        <b style="font-family:var(--f-head)">${esc(mat.title||'Тест')}</b>
        <div class="row" style="gap:6px;margin-top:6px">
          <span class="badge lv${q.level}">${lvl.n}</span>
          ${q.topic?`<span class="badge">${esc(q.topic)}</span>`:''}
          <span class="muted small">адаптивный режим: ${r.streak>=2?'повышаю сложность':(r.miss>=2?'упрощаю, чтобы закрепить':'сбалансированно')}</span>
        </div>
      </div>
      <div class="opts-grid" style="display:flex;gap:6px">
        ${['ALL','A','B','C'].map(L=>`<button class="opt-pill ${r.pool===L?'on':''}" data-act="pool" data-l="${L}" title="Фильтр по уровню">${L==='ALL'?'Все':L}</button>`).join('')}
      </div>
    </div>
    <div class="qnav">${r.qs.map((qq,i)=>`<i class="${i===idx?'cur':(r.ans[i]?(r.ans[i]===qq.c?'done':'miss'):'')}" data-act="gotoQ" data-i="${i}">${i+1}</i>`).join('')}</div>
    <div class="card qcard">
      <div class="qmeta"><span class="badge">Вопрос ${idx+1}</span>${q.type==='multi'?`<span class="badge">Несколько ответов</span>`:''}</div>
      <div class="q-text">${esc(q.q)}</div>
      ${q.fig?C.fig(q.fig):''}
      ${hi.box}
      <div class="opts">
        ${QK.map(k=>{
          let c='';
          if(sel){ if(k===q.c) c=' ok'; else if(k===sel) c=' no'; }
          else if(hi.gone.includes(k)) c=' gone';
          return `<button class="opt${c}" data-act="answer" data-k="${k}"><b>${k}</b><span>${esc(q.o[k]||'')}</span></button>`;
        }).join('')}
      </div>
      <div class="row between" style="margin-top:16px">
        <button class="btn ghost" data-act="hint">💡 Подсказка</button>
        <div class="row">
          <button class="btn ghost" data-act="prevQ" ${idx<=0?'disabled':''}>← Назад</button>
          <button class="btn" data-act="nextQ">${done+1>=r.qs.length?'Завершить ✓':'Далее →'}</button>
        </div>
      </div>
    </div>`);
  afterRender();
};
function answer(k){
  const r=S.run; if(!r||r.done) return;
  const i=r.cur<0?r.next:r.cur; if(i==null) return;
  if(r.ans[i]) return;
  r.ans[i]=k;
  const q=r.qs[i];
  const ok=k===q.c;
  if(ok){ r.streak++; r.miss=0; bump(Math.max(1,5-2*((r.hn||{})[i]||0))); }
  else { r.streak=0; r.miss++; addWrong(q, r.mat.subject, r.mat.topic); }
  const done=Object.keys(r.ans).length;
  saveRun();
  render();
  if(done>=r.qs.length) setTimeout(()=>finishTest(),450);
}
function prevQ(){
  const r=S.run; if(!r) return;
  const done=Object.keys(r.ans);
  const prev=done.filter(i=>i<r.cur).pop();
  if(prev==null) return;
  r.cur=prev; render();
}
function nextQ(){
  const r=S.run; if(!r) return;
  const done=Object.keys(r.ans).length;
  if(done>=r.qs.length){ finishTest(); return; }
  pickNext();
  r.cur=r.next;
  saveRun();
  render();
}
async function finishTest(){
  const r=S.run; if(!r) return;
  const n=r.qs.length, un=n-Object.keys(r.ans).length;
  if(un){ if(!await ask('Без ответа: '+un+'. Завершить тест?')) return; }
  r.done=1; r.t1=Date.now();
  if(!r.paid){
    r.paid=1; let p=0, ok=0;
    r.qs.forEach((q,i)=>{ if(r.ans[i]===q.c){ ok++; p+=Math.max(1,5-2*((r.hn||{})[i]||0)); } else if(r.ans[i]) addWrong(q,r.mat.subject,r.mat.topic); });
    r.pts=p;
    const mat=await dbGet('mat',r.mat.id);
    if(mat){ mat.stats=mat.stats||{}; mat.stats.attempts=(mat.stats.attempts||0)+1;
      mat.stats.best=Math.max(mat.stats.best||0,Math.round(ok/n*100)); mat.stats.last=Date.now(); await dbPut('mat',mat); }
    const h=(rd('hist',[])||[]); h.push({t:Date.now(),p:Math.round(ok/n*100),n,sub:r.mat.subject}); sv('hist',h.slice(-100));
    bump(p);
    saveTopicStat(r.mat.topic||r.mat.title,{attempts:1,best:Math.round(ok/n*100),wrong:n-ok,level:r.mat.level});
  }
  render();
}
function renderResults(mat){
  const r=S.run; if(!r) return;
  const n=r.qs.length, ok=r.qs.filter((q,i)=>r.ans[i]===q.c).length;
  const pct=Math.round(ok/n*100);
  const mins=Math.max(1,Math.round(((r.t1||Date.now())-r.t0)/60000));
  shell(`<div class="center" style="margin-bottom:18px">
      <div class="big-score">${pct}%</div>
      <p class="muted">${ok} из ${n} верно · ${mins} мин · +${r.pts||0} ⭐</p>
      <div class="row" style="justify-content:center;margin-top:10px">
        <button class="btn ghost sm" data-act="onlyWrong">Показать только ошибки</button>
        <button class="btn sm" data-act="startMat" data-id="${mat.id}">↻ Пройти заново</button>
        <button class="btn ghost sm" data-act="adapt" data-id="${mat.id}">🧠 Адаптивный разбор</button>
      </div>
    </div>
    <div id="resList">${r.qs.map((q,i)=>{
      const g=r.ans[i]===q.c;
      return `<div class="card" style="margin-bottom:10px;border-color:${g?'rgba(52,211,153,.4)':'rgba(248,113,113,.4)'}">
        <div class="row between"><span class="badge lv${q.level}">${lvlShort(q.level)}</span><b>${i+1}. ${g?'✅':'❌'}</b></div>
        <div class="q-text" style="font-size:16px;margin-top:8px">${esc(q.q)}</div>
          <p class="muted small">Ваш ответ: ${r.ans[i]||'—'} · Верный: <b>${q.c}</b> — ${esc(q.o[q.c]||'')}</p>
          ${q.e?`<div class="explain ${g?'ok':'no'}">💡 ${esc(q.e)}</div>`:''}
      </div>`;}).join('')}</div>`);
  afterRender();
}

/* ================= MISTAKES (spaced repetition) ================= */
const WI=[600000,86400000,259200000];
function addWrong(q,sub,topic){
  const w=rd('wrong',[])||[];
  const k=fingerprint(q.q);
  const it={k,q:{q:q.q,o:q.o,c:q.c,e:q.e,h:q.h,level:q.level,topic:q.topic||topic||''},box:0,due:Date.now()+WI[0],sub:sub||''};
  const i=w.findIndex(x=>x.k===k);
  if(i<0) w.push(it); else w[i]=it;
  sv('wrong',w.slice(-300));
}
ROUTES.rev=async (subId)=>{
  const w=rd('wrong',[])||[];
  const now=Date.now();
  const list=subId?w.filter(x=>!x.sub||x.sub===subId):w;
  const due=list.filter(x=>x.due<=now);
  if(!list.length){ shell(`<div class="empty"><div class="big-emo">✅</div><b>Ошибок пока нет</b>
    <p class="muted">Они появятся здесь автоматически.</p></div>`); afterRender(); return; }
  if(!due.length){ shell(`<div class="empty"><div class="big-emo">👍</div><b>Всё повторено</b>
    <p class="muted">В очереди: ${list.length}. Ближайший повтор: ${fmtDate(Math.min(...list.map(x=>x.due)))}</p>
    <button class="btn" data-act="revAll">Повторить всё сейчас</button></div>`); afterRender(); return; }
  S.rev={w:due[0], sel:null, hn:0};
  revView();
};
function revView(){
  const rv=S.rev; if(!rv){ navigate('rev'); return; }
  const q=rv.w.q;
  const hi=hintInfo(q,rv.hn,'');
  shell(`<div class="run-top"><div><b>🔁 Повтор ошибок</b>
      <div class="muted small">В очереди: ${(rd('wrong',[])||[]).length}</div></div></div>
    <div class="card qcard">
      <div class="qmeta"><span class="badge lv${q.level||'B'}">${lvlShort(q.level||'B')}</span>${q.topic?`<span class="badge">${esc(q.topic)}</span>`:''}</div>
      <div class="q-text">${esc(q.q)}</div>
      ${hi.box}
      <div class="opts">${QK.map(k=>{
        let c=''; if(rv.sel){ if(k===q.c) c=' ok'; else if(k===rv.sel) c=' no'; }
        else if(hi.gone.includes(k)) c=' gone';
        return `<button class="opt${c}" data-act="revPick" data-k="${k}"><b>${k}</b><span>${esc(q.o[k]||'')}</span></button>`;}).join('')}</div>
      ${rv.sel?`<div class="explain ${rv.sel===q.c?'ok':'no'}">${rv.sel===q.c?'✅ Верно':'❌ Неверно'}. Верный ответ: <b>${q.c}</b> — ${esc(q.o[q.c]||'')}${q.e?'<br>💡 '+esc(q.e):''}</div>
        <div class="row end" style="margin-top:12px"><button class="btn" data-act="revNext">Дальше →</button></div>`:
        `<div class="row end" style="margin-top:12px"><button class="btn ghost" data-act="revHint">💡 Подсказка</button></div>`}
    </div>`);
  afterRender();
}
function revPick(k){
  const rv=S.rev; if(!rv||rv.sel) return;
  const w=rd('wrong',[])||[]; const i=w.findIndex(x=>x.k===rv.w.k); const ok=k===rv.w.q.c;
  if(i>=0){ if(ok){ if(w[i].box+1>=WI.length) w.splice(i,1); else { w[i].box++; w[i].due=Date.now()+WI[w[i].box]; } }
               else { w[i].box=0; w[i].due=Date.now()+WI[0]; } }
  sv('wrong',w);
  bump(ok?3:0); rv.sel=k; revView();
}

/* ================= CARDS ================= */
function startCards(mat){
  S.deck={mat, c:mat.cards||[], q:(mat.cards||[]).map((_,i)=>i), kn:0, s:new Set(), pw:null};
  navigate('cards/'+mat.id);
}
ROUTES['cards']=async (id)=>{
  const mat=await dbGet('mat',id);
  if(!mat){ navigate('home'); return; }
  if(!S.deck||S.deck.mat.id!==id) startCards(mat);
  const d=S.deck;
  if(!d.q.length){
    shell(`<div class="center"><div class="big-score">🎉</div><h2>Все ${d.c.length} карточек выучены!</h2>
      <div class="row" style="justify-content:center;margin-top:14px">
        <button class="btn" data-act="deckReset" data-id="${mat.id}">Повторить заново</button>
        <button class="btn ghost" data-act="nav" data-v="sub/${mat.subject||''}">К предмету</button></div></div>`);
    afterRender(); return;
  }
  const c=d.c[d.q[0]]; d.s.add(d.q[0]);
  const kw=d.c.length?Math.round(d.kn/d.c.length*100):0;
  shell(`<div class="run-top"><div style="flex:1"><b style="font-family:var(--f-head)">🗂 ${esc(mat.title||'Карточки')}</b>
      <div class="muted small">Карточка ${d.s.size} из ${d.c.length}</div></div>
      <button class="btn ghost sm" data-act="deckReset" data-id="${mat.id}">🔄 Обновить</button></div>
    <div class="kbar"><div class="kt"><span>Выучено <b>${d.kn}</b> из ${d.c.length}</span><span>${kw}%</span></div>
      <div class="bar"><i id="kfill" style="width:${d.pw==null?kw:d.pw}%"></i></div></div>
    <div class="flip" data-act="flipCard"><div class="fi">
      <div class="ff card"><small>Вопрос</small><div>${esc(c.f)}</div>${c.example?'<div class="muted small" style="margin-top:10px">'+esc(c.example)+'</div>':''}</div>
      <div class="ff fb card"><small>Ответ</small><div style="font-size:16px">${esc(c.b)}</div>${c.example?'<div class="muted small" style="margin-top:10px">'+esc(c.example)+'</div>':''}</div>
    </div></div>
    <p class="muted center small" style="margin-top:12px">Нажмите на карточку (или пробел), чтобы перевернуть</p>
    <div class="row" style="justify-content:center;margin-top:10px">
      <button class="btn ghost" data-act="rate" data-k="0">↻ Повторить</button>
      <button class="btn" data-act="rate" data-k="1">✓ Знаю</button>
    </div>`);
  afterRender();
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ const f=$('#kfill'); if(f) f.style.width=kw+'%'; }));
};
function rateCard(k){
  const d=S.deck; if(!d) return;
  const i=d.q.shift(); if(k) d.kn++; else d.q.push(i);
  bump(k?1:0);
  const mat=d.mat; if(mat){ mat.stats=mat.stats||{}; mat.stats.attempts=(mat.stats.attempts||0)+1; dbPut('mat',mat); }
  render();
}

/* ================= NOTES + MINI TESTS ================= */
const MQ={};
function qid(s){ return String(s==null?'':s).replace(/[^\p{L}\p{N}_-]/gu,'_')||'q'; }
function mqMake(s){
  if(!s||!Array.isArray(s.qs)) throw 0;
  const qs=s.qs.map(q=>normQuestion(q,'B')).filter(Boolean); if(!qs.length) throw 0;
  const id=qid(s.id||s.title); MQ[id]={id,title:s.title,qs};
  return `<div class="mini" id="mq-${id}">${mqBody(id)}</div>`;
}
setQuizHook(mqMake);
function mst(m,best){
  if(best>=80) return {k:3,t:'освоил'};
  if(best>=50) return {k:2,t:'знаю'};
  return (m.tries||Object.keys(m.a||{}).length)?{k:1,t:'начато'}:{k:0,t:'не начато'};
}
function mqBody(id){
  const s=MQ[id], m=(rd('mini',{})||{})[id]||{}, A=m.a||{}, H=m.h||{}, n=s.qs.length;
  const done=Object.keys(A).length===n;
  const sc=s.qs.filter((q,i)=>A[i]===q.c).length;
  const pct=done?Math.round(sc/n*100):0, best=Math.max(m.best||0,pct), st=mst(m,best);
  return `<div class="mini-h"><b>📝 ${esc(s.title||'Мини-тест')}</b><span class="badge b${st.k}">${st.t}${best?' · '+best+'%':''}</span></div>
    ${s.qs.map((q,i)=>{
      const hi=hintInfo(q,H[i]||0,'');
      return `<div class="mini-q"><div class="mini-n">${i+1} / ${n}</div>
        <div class="q-text" style="font-size:15px">${esc(q.q)}</div>${hi.box}
        <div class="opts" style="margin-top:8px">${QK.map(k=>{
          let c=''; if(A[i]){ if(k===q.c) c=' ok'; else if(k===A[i]) c=' no'; }
          else if(hi.gone.includes(k)) c=' gone';
          return `<button class="opt" style="padding:10px;font-size:13.5px" data-act="mqPick" data-id="${id}" data-i="${i}" data-k="${k}"><b>${k}</b><span>${esc(q.o[k]||'')}</span></button>`;}).join('')}</div>
        ${A[i]?`<div class="mini-r ${A[i]===q.c?'ok':'no'}">${A[i]===q.c?'✅ Верно':'❌ Неверно'} · ответ <b>${q.c}</b>${q.e?' — '+esc(q.e):''}</div>`:''}
      </div>`;}).join('')}
    ${done?`<div class="mini-r">Результат: <b>${sc}/${n}</b> (${pct}%) · статус: <b>${st.t}</b>
      <button class="btn ghost sm" style="margin-left:8px" data-act="mqRetry" data-id="${id}">↻ Пройти заново</button></div>`:''}`;
}
function mqSet(id,f){
  const d=rd('mini',{})||{}; const m=d[id]||{a:{},h:{},best:0,tries:0};
  m.a=m.a||{}; m.h=m.h||{}; f(m); d[id]=m; sv('mini',d);
  const e=document.getElementById('mq-'+id); if(e){ e.innerHTML=mqBody(id); C.kx(e); }
}
ROUTES['note']=async (id)=>{
  const mat=await dbGet('mat',id);
  if(!mat){ navigate('home'); return; }
  if(mat.quiz&&mat.quiz.qs){
    try{ MQ[qid(mat.quiz.id||mat.quiz.title||id)]={id:qid(mat.quiz.id||mat.quiz.title||id),title:mat.quiz.title,qs:mat.quiz.qs.map(q=>normQuestion(q,'B')).filter(Boolean)}; }catch(e){}
  }
  shell(`<div class="page-head"><div><h1>📘 ${esc(mat.title||'Конспект')}</h1>
      <p class="sub">${esc(mat.topic||'')} · ${fmtDate(mat.created)}</p></div>
      <div class="spacer"></div>
      <button class="btn ghost sm" data-act="annToggle" title="Рисовать по конспекту">✏️ Рисовать</button></div>
    <div class="card note">${md(mat.markdown||'')}</div>`);
  afterRender();
};

/* ================= DASHBOARD ================= */
ROUTES.dash=async ()=>{
  const m=meta();
  const mats=(await dbAll('mat')).filter(x=>x.uid===C.ACC());
  const subs=SUBS.concat(rd('subs',[])||[]);
  const ts=topicStats();
  const wrong=(rd('wrong',[])||[]);
  const due=wrong.filter(x=>x.due<=Date.now()).length;
  const hist=rd('hist',[])||[];
  const cards=subs.map(s=>{
    const sm=mats.filter(x=>x.subject===s.id);
    const tests=sm.filter(x=>x.kind==='test');
    const bestT=tests.length?Math.max(...tests.map(t=>(t.stats&&t.stats.best)||0)):0;
    const avg=tests.length?Math.round(tests.reduce((a,t)=>a+((t.stats&&t.stats.best)||0),0)/tests.length):0;
    const topics=[...new Set(tests.flatMap(t=>(t.questions||[]).map(q=>q.topic).filter(Boolean)))];
    const weak=topics.filter(tp=>{ const st=ts[tp]; return st&&st.best<70; });
    const cardsN=sm.filter(x=>x.kind==='cards').reduce((a,x)=>a+((x.stats&&x.stats.attempts)||0),0);
    return {s,tests:tests.length,bestT,avg,topics:topics.length,weak,cardsN};
  });
  const mastered=Object.entries(ts).filter(([k,v])=>v.best>=80).length;
  const weakTopics=Object.entries(ts).filter(([k,v])=>v.best<70&&v.attempts>0).sort((a,b)=>a[1].best-b[1].best);
  const acc=hist.length?Math.round(hist.reduce((a,h)=>a+h.p,0)/hist.length):0;
  shell(`<div class="page-head"><div><h1>📊 Прогресс</h1>
      <p class="sub">Очки и серия общие. Темы и статусы — по вашим ответам.</p></div>
      <div class="spacer"></div>
      <button class="btn" data-act="nav" data-v="gen">✨ Сгенерировать</button></div>
    <div class="kpis">
      <div class="kpi"><b>${effStreak()}</b><span>дней подряд</span></div>
      <div class="kpi"><b>${m.best}</b><span>лучшая серия</span></div>
      <div class="kpi"><b>${m.pts}</b><span>очков</span></div>
      <div class="kpi"><b>${acc}%</b><span>средний результат</span></div>
      <div class="kpi"><b>${mastered}</b><span>тем освоено</span></div>
    </div>
    ${due?`<div class="card" style="border-color:rgba(251,191,36,.4)"><b>🔁 Повторите ошибки</b>
      <p class="muted small">${due} вопросов ждут повторения — это самый быстрый способ поднять результат.</p>
      <button class="btn sm" style="margin-top:10px" data-act="nav" data-v="rev">Начать повторение</button></div>`:''}
    ${weakTopics.length?`<div class="card" style="margin-top:14px"><b>🧠 Слабые места</b>
      <div class="row" style="margin-top:10px">${weakTopics.slice(0,10).map(([t,v])=>`<span class="chip" data-act="genFromTopic" data-topic="${esc(t)}" title="Сгенерировать новый вариант">${esc(t)} · ${v.best}% ✚</span>`).join('')}</div>
      <p class="muted small" style="margin-top:10px">Нажмите на тему — ИИ составит новый вариант (уровень C), не повторяя прошлые вопросы.</p></div>`:''}
    <div class="row between" style="margin:22px 0 10px"><h2>По предметам</h2></div>
    ${cards.map(c=>`<div class="card dash-card" style="--sc:${c.s.c}">
      <div class="row between"><b>${c.s.e} ${esc(c.s.n)}</b><span class="muted small">${esc(c.s.ru||'')}</span></div>
      <div class="dash-row">
        <span class="badge">тестов: ${c.tests}</span>
        <span class="badge">лучший: ${c.bestT||'—'}%</span>
        <span class="badge">средний: ${c.avg||'—'}%</span>
        <span class="badge">тем: ${c.topics}</span>
      </div>
      ${c.weak.length?`<div class="reco">Слабые темы: ${c.weak.map(esc).join(', ')}</div>`:''}
      <div class="row" style="margin-top:10px">
        <button class="btn ghost sm" data-act="nav" data-v="sub/${c.s.id}">Открыть</button>
        <button class="btn ghost sm" data-act="nav" data-v="gen" data-sub="${c.s.id}">✨ AI-вариант</button>
      </div></div>`).join('')}
    ${mats.length?`<div class="row between" style="margin:22px 0 10px"><h2>Все материалы</h2></div>
      <div class="grid g2">${mats.sort((a,b)=>b.created-a.created).map(matCard).join('')}</div>`:''}`);
  afterRender();
};

/* ================= SETTINGS ================= */
ROUTES.settings=async ()=>{
  const s=getSettings();
  const prov=PROVIDERS.map(p=>`<div class="card" style="margin-bottom:10px">
      <label class="row" style="cursor:pointer;gap:10px">
        <input type="radio" name="prov" value="${p.id}" ${s.provider===p.id?'checked':''} data-act="setProv">
        <span style="flex:1"><b>${esc(p.name)}</b><br><span class="muted small">${esc(p.desc)}</span></span>
        <span class="badge">${esc(p.free)}</span>
      </label>
      <div class="row" style="margin-top:10px">
        <select class="field" style="width:auto" data-act="setModel" data-p="${p.id}">
          ${p.models.map(m=>`<option value="${m}" ${s.models[p.id]===m?'selected':''}>${m}</option>`).join('')}
        </select>
        ${p.needsKey?`<input class="field" style="flex:1;min-width:180px" type="password" placeholder="API-ключ (хранится только у вас)" value="${esc(s.keys[p.id]||'')}" data-act="setKey" data-p="${p.id}">`:''}
      </div>
      ${p.id==='ollama'?`<input class="field" style="margin-top:8px" placeholder="http://localhost:11434/v1" value="${esc(s.ollamaUrl)}" data-act="setOllama">`:''}
      ${p.id==='custom'?`<input class="field" style="margin-top:8px" placeholder="https://.../v1" value="${esc(s.customUrl)}" data-act="setCustomUrl">`:''}
    </div>`).join('');
  shell(`<div class="page-head"><div><h1>⚙️ Настройки</h1>
      <p class="sub">Все модели бесплатные. Ключи хранятся только в вашем браузере.</p></div></div>
    <div class="card" style="margin-bottom:14px"><b>AI-модель</b>
      <p class="muted small">По умолчанию используется Pollinations — работает без ключа. Если нужна скорость и лимиты — добавьте бесплатный ключ Gemini, Groq или OpenRouter.</p>
      ${prov}
    </div>
    <div class="card" style="margin-bottom:14px"><b>Интерфейс</b>
      <div class="row" style="margin-top:10px">
        <span class="muted small">Тема:</span>
        <button class="chip" data-act="theme">Переключить (сейчас: ${document.documentElement.dataset.theme==='dark'?'тёмная':'светлая'})</button>
        <span class="muted small">Язык ответов ИИ:</span>
        <select class="field" style="width:auto" data-act="setLang">
          ${[['ru','Русский'],['kk','Қазақша'],['en','English'],['tr','Türkçe']].map(([v,n])=>`<option value="${v}" ${s.lang===v?'selected':''}>${n}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="card" style="margin-bottom:14px"><b>Аккаунт</b>
      <div class="row" style="margin-top:10px">
        ${S.user&&S.user.em!=='guest'
          ? `<img src="${esc(S.user.pic||'')}" style="width:32px;height:32px;border-radius:50%" alt=""><b>${esc(S.user.name||'')}</b><span class="muted small">${esc(S.user.em||'')}</span>
             <button class="btn ghost sm" data-act="signout">Выйти</button>`
          : `<span class="muted">Вы вошли как гость</span><button class="btn ghost sm" data-act="signin">Войти через Google</button>`}
      </div>
      <p class="muted small" style="margin-top:10px">Данные привязаны к аккаунту и хранятся на устройстве.</p>
      <div class="row" style="margin-top:12px">
        <span class="muted small">Google Client ID:</span>
        <input class="field" style="flex:1;min-width:200px" placeholder="xxxx.apps.googleusercontent.com" value="${esc(rd('gclient',''))}" data-act="setGclient">
        <button class="btn ghost sm" data-act="saveGclient">Сохранить</button>
      </div>
      <p class="muted small" style="margin-top:6px">Если вход не работает на этом домене — укажите свой OAuth Client ID (Google Cloud Console → «Веб-приложение»).</p>
    </div>
    <div class="card"><b>Данные</b>
      <div class="row" style="margin-top:10px">
        <button class="btn ghost sm" data-act="exportData">⬇ Экспорт</button>
        <button class="btn ghost sm" data-act="clearData">🗑 Очистить мои данные</button>
      </div>
      <p class="muted small" style="margin-top:8px">Уже сгенерировано уникальных вопросов: ${seenList().length}. Повторы блокируются автоматически.</p>
    </div>`);
  afterRender();
};

/* ================= AUTH ================= */
const GID_DEFAULT='549332087816-cjqvi6bjkoumsuqdj852vn7c14bma3io.apps.googleusercontent.com';
function gclient(){ return (rd('gclient','')||GID_DEFAULT); }
function gisInit(){
  const w=$('#gbtn'); if(!w) return;
  const cid=gclient();
  if(!window.google||!google.accounts||!google.accounts.id){ setTimeout(gisInit,400); return; }
  try{
    google.accounts.id.initialize({client_id:cid,callback:gOnCred,auto_select:false});
    w.innerHTML='';
    google.accounts.id.renderButton(w,{theme:'filled_black',size:'large',shape:'pill',width:320,text:'continue_with',logo_alignment:'center'});
  }catch(e){
    w.innerHTML=`<button class="btn" style="width:100%" data-act="signin">🔐 Войти через Google</button>`;
  }
}
function jwtDecode(t){
  const p=t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
  const s=p.padEnd(p.length+(4-p.length%4)%4,'=');
  return JSON.parse(decodeURIComponent(atob(s).split('').map(c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join('')));
}
function gOnCred(r){
  try{
    const p=jwtDecode(r.credential);
    const u={em:p.email,name:p.name||(p.email||'').split('@')[0],pic:p.picture||''};
    S.user=u; sv('auth',u); enterApp();
    toast('С возвращением, '+u.name+'!');
  }catch(e){ toast('Ошибка входа','err'); }
}
function anonIn(){ S.user={em:'guest',name:'Гость',pic:''}; sv('auth',S.user); enterApp(); }
function showAuth(){
  $('#app').hidden=true; $('#auth').hidden=false;
  const cid=gclient();
  if(!cid){ $('#gbtn').innerHTML=''; }
  else setTimeout(gisInit,250);
}
function enterApp(){
  $('#auth').hidden=true; $('#app').hidden=false;
  if(!location.hash||location.hash==='#') location.hash='home';
  else render();
  renderRail();
}

/* ================= UPLOAD ================= */
let uploadCtx={subject:''};
function openUpload(subject){
  uploadCtx={subject:subject||''};
  const b=openModal('Добавить материал',`
    <div class="drop" id="dropZone">
      <div class="big-emo">📥</div>
      <b>Перетащите файлы сюда</b>
      <p class="muted small">PDF · DOCX · PPTX · TXT · MD · CSV · JSON · HTML · картинки (OCR)</p>
      <button class="btn sm" style="margin-top:10px" data-act="pickFiles">Выбрать файлы</button>
    </div>
    <div id="upList" style="margin-top:14px"></div>
    <p class="muted small" style="margin-top:12px">Файлы читаются прямо в браузере и никуда не отправляются. ИИ использует их текст для генерации.</p>`,true);
  const dz=b.querySelector('#dropZone');
  dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('over');});
  dz.addEventListener('dragleave',()=>dz.classList.remove('over'));
  dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('over'); handleFiles(e.dataTransfer.files);});
  $('#filepick').onchange=e=>{ handleFiles(e.target.files); e.target.value=''; };
}
async function handleFiles(files){
  if(!files||!files.length) return;
  const list=$('#upList'); if(!list) return;
  for(const f of files){
    const row=document.createElement('div'); row.className='doc';
    row.innerHTML=`<div class="doc-ico">📄</div><div style="flex:1"><b>${esc(f.name)}</b><div class="meta">${fmtBytes(f.size)} · читаем…</div></div>`;
    list.appendChild(row);
    const meta=row.querySelector('.meta');
    try{
      const res=await parseFile(f,(a,b)=>{
        meta.textContent=typeof a==='string'?a:`${a}/${b} стр.`;
      });
      if(!res.text||res.text.length<30) throw new Error('В файле не найден текст (возможно, это скан?)');
      const doc={id:nowId('doc'), uid:C.ACC(), name:f.name, kind:res.kind, size:f.size,
                 text:res.text, pages:res.pages||[], created:Date.now(), topics:[], subject:uploadCtx.subject||''};
      await dbPut('docs',doc);
      meta.innerHTML=`${fmtBytes(f.size)} · ${res.text.length.toLocaleString('ru-RU')} симв. · <b style="color:var(--ok)">загружен</b>`;
      row.querySelector('.doc-ico').textContent={pdf:'📕',docx:'📘',pptx:'📙',image:'🖼'}[res.kind]||'📄';
      setTimeout(async()=>{
        try{
          const s=getSettings();
          const {sys,u}=buildTopicPrompt({text:res.text,lang:s.lang});
          const data=await aiAsk(sys,u,{temperature:0.4});
          const topics=(data&&data.topics||[]).map(t=>({title:String(t.title||'').slice(0,120),summary:String(t.summary||''),keywords:String(t.keywords||'')}));
          doc.topics=topics; await dbPut('docs',doc);
          const tl=row.querySelector('.meta'); if(tl) tl.innerHTML=`${fmtBytes(f.size)} · тем: ${topics.length}`;
        }catch(e){ const tl=row.querySelector('.meta'); if(tl) tl.innerHTML=`${fmtBytes(f.size)} · ИИ-анализ недоступен`; }
      },300);
    }catch(err){
      meta.innerHTML=`<span style="color:var(--no)">${esc(err.message||'ошибка')}</span>`;
      row.querySelector('.doc-ico').textContent='⚠️';
    }
  }
}

/* ================= ACTIONS ================= */
const ACT={};
ACT.nav=(el)=>{
  const v=el.dataset.v;
  if(v.startsWith('sub/')){ const id=v.slice(4); S.sub=SUBS.concat(rd('subs',[])||[]).find(s=>s.id===id)||null; S.tab='test'; }
  if(v==='gen'){
    if(el.dataset.sub){ GEN.subject=el.dataset.sub; }
    if(el.dataset.kind){ GEN.kind=el.dataset.kind; }
    if(el.dataset.doc){
      GEN.src='doc'; GEN.docId=el.dataset.doc; GEN.topics=[]; GEN.topic='';
      dbGet('docs',el.dataset.doc).then(d=>{
        if(d){ GEN.topics=(d.topics||[]).slice(); if(!GEN.topic&&GEN.topics[0]) GEN.topic=GEN.topics[0].title; render(); }
      });
    } else if(el.dataset.sub){ GEN.src='topic'; }
  }
  navigate(v);
};
ACT.subtab=(el)=>{ S.tab=el.dataset.tab; if(location.hash==='#sub/'+el.dataset.sub) render(); else navigate('sub/'+el.dataset.sub); };
ACT.openMat=(el)=>{ const id=el.dataset.id; startMat(id); };
ACT.startMat=(el)=>{ startMat(el.dataset.id); };
ACT.upload=(el)=>{ openUpload(el.dataset.sub||''); };
ACT.pickFiles=()=>{ $('#filepick').click(); };
ACT.delDoc=async (el)=>{ if(await ask('Удалить документ?','Удалить')){ await dbDel('docs',el.dataset.id); toast('Документ удалён'); render(); } };
ACT.openDoc=(el)=>navigate('doc/'+el.dataset.id);
ACT.docSub=async (el)=>{ const d=await dbGet('docs',el.dataset.id); if(d){ d.subject=el.value; await dbPut('docs',d); toast('Предмет сохранён'); } };
ACT.docTopics=async (el)=>{
  const d=await dbGet('docs',el.dataset.id); if(!d) return;
  toast('ИИ читает документ…');
  try{
    const s=getSettings(); const {sys,u}=buildTopicPrompt({text:d.text,lang:s.lang});
    const data=await aiAsk(sys,u,{temperature:0.4});
    d.topics=(data&&data.topics||[]).map(t=>({title:String(t.title||''),summary:String(t.summary||''),keywords:String(t.keywords||'')}));
    await dbPut('docs',d); toast('Темы найдены: '+d.topics.length); render();
  }catch(e){ toast('Не удалось: '+(e.message||e),'err'); }
};
ACT.genFromTopic=(el)=>{ GEN.src=el.dataset.doc?'doc':'topic'; GEN.docId=el.dataset.doc||''; GEN.topic=el.dataset.topic||''; GEN.subject=''; GEN.material=''; navigate('gen'); };
ACT.genSrc=(el)=>{ GEN.src=el.dataset.s; render(); };
ACT.genDocSel=(el)=>{
  GEN.docId=el.value||''; GEN.topics=[]; GEN.topic='';
  if(GEN.docId) dbGet('docs',GEN.docId).then(d=>{ if(d){ GEN.topics=(d.topics||[]).slice(); if(!GEN.topic&&GEN.topics[0]) GEN.topic=GEN.topics[0].title; render(); } });
  else render();
};
ACT.genPickTopic=(el)=>{ GEN.topic=el.dataset.t; render(); };
ACT.genLevel=(el)=>{ GEN.level=el.dataset.l; render(); };
ACT.genKind=(el)=>{ GEN.kind=el.dataset.k; render(); };
ACT.genCount=(el)=>{ GEN.count=+el.dataset.c; render(); };
ACT.genSubject=(el)=>{ GEN.subject=el.value; };
ACT.genStart=()=>runGeneration();
ACT.genStop=()=>{ GEN.abort=true; toast('Остановлено'); };
ACT.genOffline=(el)=>{
  const topic=el.dataset.topic||GEN.topic;
  const qs=localTest(GEN.material||'',topic,GEN.count||20,GEN.level==='MIX'?'B':GEN.level);
  if(!qs.length){ toast('Нет текста для офлайн-теста','err'); return; }
  if(!qs.length){ toast('Нет текста для офлайн-теста','err'); return; }
  const mat={id:nowId('test'),uid:C.ACC(),kind:'test',subject:GEN.subject||'',topic,title:topic+' · офлайн',
    level:GEN.level,questions:qs,created:Date.now(),stats:{attempts:0,best:0},offline:true};
  dbPut('mat',mat).then(()=>{ renderGenResult(mat); toast('Офлайн-тест готов'); });
};
ACT.answer=(el)=>answer(el.dataset.k);
ACT.nextQ=()=>nextQ();
ACT.prevQ=()=>prevQ();
ACT.gotoQ=(el)=>{ const r=S.run; if(r){ r.cur=+el.dataset.i; render(); } };
ACT.pool=(el)=>{ const r=S.run; if(r){ r.pool=el.dataset.l; r.cur=-1; pickNext(); render(); } };
ACT.hint=()=>{
  const r=S.run;
  if(r&&r.cur>=0){ const i=r.cur; r.hn=r.hn||{}; r.hn[i]=Math.min(hintSteps(r.qs[i]).length,(r.hn[i]||0)+1); render(); return; }
  if(S.rev){ S.rev.hn++; revView(); }
};
ACT.onlyWrong=()=>{
  const r=S.run; if(!r) return;
  $$('#resList > .card').forEach(c=>{ const ok=c.textContent.includes('✅'); c.style.display=ok?'none':''; });
};
ACT.revStart=(el)=>navigate('rev'+(el&&el.dataset.sub?'/'+el.dataset.sub:''));
ACT.revPick=(el)=>revPick(el.dataset.k);
ACT.revNext=()=>{ const w=rd('wrong',[])||[]; const due=w.filter(x=>x.due<=Date.now());
  S.rev={w:due[0]||null,sel:null,hn:0};
  if(!S.rev.w){ navigate('rev'); return; } revView(); };
ACT.revHint=()=>{ if(S.rev){ S.rev.hn++; revView(); } };
ACT.revAll=async ()=>{ const w=rd('wrong',[])||[]; w.forEach(x=>x.due=0); sv('wrong',w); navigate('rev'); render(); };
ACT.flipCard=()=>{ const f=$('.flip'); if(f) f.classList.toggle('on'); };
ACT.rate=(el)=>rateCard(+el.dataset.k);
ACT.deckReset=(el)=>{ const id=el.dataset.id; dbGet('mat',id).then(m=>{ if(m){ m.stats=m.stats||{}; m.stats.attempts=0; dbPut('mat',m);} });
  const d=S.deck; if(d){ d.q=d.c.map((_,i)=>i); d.kn=0; d.s=new Set(); d.pw=0; } render(); };
ACT.mqPick=(el)=>{ const id=el.dataset.id,i=+el.dataset.i,k=el.dataset.k; const s=MQ[id]; if(!s) return;
  const q=s.qs[i];
  mqSet(id,m=>{ if(m.a[i]) return; m.a[i]=k; const ok=k===q.c; bump(ok?Math.max(2,10-3*(m.h[i]||0)):0); if(!ok) addWrong(q,'',q.topic); }); };
ACT.mqRetry=(el)=>{ mqSet(el.dataset.id,m=>{ m.a={}; m.h={}; }); };
ACT.adapt=async (el)=>{
  const mat=await dbGet('mat',el.dataset.id); if(!mat) return;
  const wrongTopics=[...new Set((mat.questions||[]).filter((q,i)=>S.run&&S.run.ans[i]!==q.c).map(q=>q.topic).filter(Boolean))];
  const topic=wrongTopics[0]||mat.topic||'Эта тема';
  GEN.src='topic'; GEN.topic=topic; GEN.kind='test'; GEN.level='C'; GEN.count=20; GEN.subject=mat.subject||'';
  navigate('gen'); toast('Тема: '+topic+' — уровень C, без повторов');
};
ACT.theme=()=>{ const t=document.documentElement.dataset.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme=t; try{ localStorage.setItem('bts2:__shared__:theme',t); }catch(e){} render(); };
ACT.setProv=(el)=>{ saveSettings({provider:el.value}); toast('Провайдер: '+el.value); };
ACT.setModel=(el)=>{ const s=getSettings(); const m={...s.models}; m[el.dataset.p]=el.value; saveSettings({models:m}); };
ACT.setKey=(el)=>{ const s=getSettings(); const k={...s.keys}; k[el.dataset.p]=el.value; saveSettings({keys:k}); toast('Ключ сохранён локально'); };
ACT.setOllama=(el)=>saveSettings({ollamaUrl:el.value});
ACT.setCustomUrl=(el)=>saveSettings({customUrl:el.value});
ACT.setLang=(el)=>saveSettings({lang:el.value});
ACT.setGclient=(el)=>{ rd('gclient',''); el.dataset.tmp=el.value; };
ACT.saveGclient=(el)=>{
  const inp=document.querySelector('[data-act="setGclient"]');
  if(inp){ sv('gclient',inp.value.trim()); toast('Client ID сохранён'); }
};
ACT.signin=()=>showAuth();
ACT.signout=async ()=>{ if(await ask('Выйти из аккаунта? Данные сохранятся.','Выйти')){ rm('auth'); S.user=null; showAuth(); } };
ACT.exportData=async ()=>{
  const docs=await dbAll('docs'), mats=await dbAll('mat');
  const blob=new Blob([JSON.stringify({exported:Date.now(),docs,mats,meta:rd('meta'),hist:rd('hist'),topics:topicStats()},null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='bts-ai-export.json'; a.click();
  toast('Экспорт готов');
};
ACT.clearData=async ()=>{
  if(await ask('Удалить все ваши документы, материалы и прогресс? Это нельзя отменить.','Удалить всё')){
    await dbClearAccount('docs'); await dbClearAccount('mat');
    ['meta','hist','topics','wrong','mini','run'].forEach(k=>rm(k));
    gsv('seen',[]); toast('Данные очищены'); navigate('home'); render();
  }
};
ACT.annToggle=()=>annToggle();

document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]'); if(!el) return;
  const fn=ACT[el.dataset.act]; if(!fn) return;
  if(el.tagName==='BUTTON'||el.tagName==='INPUT') e.preventDefault();
  fn(el,e);
});
document.addEventListener('input',e=>{
  const el=e.target.closest('[data-act]'); if(!el) return;
  if(el.dataset.act==='genTopicInput') GEN.topic=el.value;
  if(el.dataset.act==='genNewSub') GEN.newSub=el.value;
});
document.addEventListener('change',e=>{
  const el=e.target.closest('[data-act]'); if(!el) return;
  const fn=ACT[el.dataset.act]; if(fn && el.tagName==='SELECT') fn(el,e);
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!$('#modal').hidden) closeModal();
  if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if(S.deck&&$('.flip')){
    if(e.code==='Space'){ e.preventDefault(); $('.flip').classList.toggle('on'); }
    if(e.key==='ArrowRight') rateCard(1);
    if(e.key==='ArrowLeft') rateCard(0);
  }
});

/* ================= render / boot ================= */
async function render(){
  const r=route();
  const parts=r.split('/');
  const fn=ROUTES[parts[0]];
  if(!fn){ navigate('home'); return; }
  try{ await fn(parts[1],parts[2]); }
  catch(e){ console.error(e); shell(`<div class="empty"><div class="big-emo">⚠️</div><b>Ошибка</b><p class="muted">${esc(e.message||e)}</p></div>`); afterRender(); }
}

function boot(){
  try{ const t=localStorage.getItem('bts2:__shared__:theme'); if(t) document.documentElement.dataset.theme=t; }catch(e){}
  S.user=rd('auth',null);
  if(S.user&&S.user.em&&S.user.em!=='guest') enterApp();
  else showAuth();
  $('#guestBtn').onclick=anonIn;
  $('#themeBtn').onclick=()=>ACT.theme();
  $('#settingsBtn').onclick=()=>navigate('settings');
  $('#settingsBtnM').onclick=()=>navigate('settings');
  $('#authBtn').onclick=()=>{ if(S.user&&S.user.em!=='guest') ACT.signout(); else showAuth(); };
  $('#fab').onclick=()=>openUpload('');
  document.querySelectorAll('[data-go="home"]').forEach(b=>b.onclick=()=>navigate('home'));
  setTimeout(()=>{ const s=$('#splash'); if(s){ s.classList.add('hide'); setTimeout(()=>s.remove(),450); } },350);
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
}
boot();
