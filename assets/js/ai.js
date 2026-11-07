/* ===========================================================
   ai.js — free AI layer: providers, prompts, JSON repair,
           generation orchestration, no-repeat engine, adaptive
   =========================================================== */
import { toast, esc, normText, fingerprint, similar, seenList, seenAdd, seenTexts, uidShort, sleep, nowId } from './core.js';

/* ---------------- settings ---------------- */
const DEF_SET = {
  provider:'pollinations',
  models:{pollinations:'openai-fast', gemini:'gemini-2.0-flash', groq:'llama-3.3-70b-versatile',
          openrouter:'meta-llama/llama-3.3-70b-instruct:free', ollama:'llama3.2', custom:'gpt-4o-mini'},
  keys:{pollinations:'', gemini:'', groq:'', openrouter:'', ollama:'', custom:''},
  ollamaUrl:'http://localhost:11434/v1',
  customUrl:'',
  lang:'ru',
  temp:0.75,
  chunk:8
};
export function getSettings(){
  let s={}; try{ s=JSON.parse(localStorage.getItem('bts2:__shared__:settings')||'{}'); }catch(e){}
  const out={...DEF_SET,...s, keys:{...DEF_SET.keys,...(s.keys||{})}, models:{...DEF_SET.models,...(s.models||{})}};
  return out;
}
export function saveSettings(patch){
  const s=getSettings(); const out={...s,...patch, keys:{...s.keys,...((patch&&patch.keys)||{})}, models:{...s.models,...((patch&&patch.models)||{})}};
  try{ localStorage.setItem('bts2:__shared__:settings', JSON.stringify(out)); }catch(e){}
  return out;
}

/* ---------------- providers (all free) ---------------- */
export const PROVIDERS = [
  {id:'pollinations', name:'Pollinations AI', needsKey:false, free:'бесплатно, без ключа',
   desc:'Работает сразу, без регистрации. Бесплатный лимит: ~1 запрос в 45 секунд с одного IP.',
   models:['openai-fast','openai','mistral','llama','qwen-coder','gemini']},
  {id:'gemini', name:'Google Gemini', needsKey:true, free:'бесплатный тариф Google AI Studio',
   desc:'Нужен бесплатный API-ключ от Google AI Studio. Лимиты щедрые.',
   models:['gemini-2.0-flash','gemini-2.5-flash','gemini-2.5-flash-lite']},
  {id:'groq', name:'Groq', needsKey:true, free:'бесплатный tier GroqCloud',
   desc:'Очень быстрые бесплатные модели. Нужен бесплатный ключ groq.com.',
   models:['llama-3.3-70b-versatile','llama-3.1-8b-instant','gemma2-9b-it']},
  {id:'openrouter', name:'OpenRouter (free-модели)', needsKey:true, free:'модели с суффиксом :free',
   desc:'Нужен бесплатный ключ openrouter.ai. Выбирайте модели с пометкой :free.',
   models:['meta-llama/llama-3.3-70b-instruct:free','google/gemini-2.0-flash-exp:free','qwen/qwen-2.5-72b-instruct:free']},
  {id:'ollama', name:'Локально (Ollama)', needsKey:false, free:'бесплатно и офлайн',
   desc:'Модель должна быть установлена у вас на компьютере (ollama pull llama3.2). Данные не уходят в сеть.',
   models:['llama3.2','qwen2.5:7b','gemma2:9b','mistral']},
  {id:'custom', name:'Свой OpenAI-совместимый адрес', needsKey:true, free:'зависит от сервиса',
   desc:'LM Studio, vLLM, Together, Groq-совместимые шлюзы и т.п. Укажите URL и ключ.',
   models:['gpt-4o-mini','llama3.1','local-model']}
];

/* ---------------- low-level HTTP ---------------- */
function parseRetryIn(txt){
  const m=String(txt||'').match(/wait\s+(\d+)\s+second/i);
  return m?Math.max(3,parseInt(m[1],10)):35;
}
function isRateLimit(status,txt){
  const t=String(txt||'').toLowerCase();
  return status===402||status===429||t.includes('free_limit')||t.includes('free limit reached')||t.includes('rate limit')||t.includes('too many requests');
}
async function httpJSON(url, opt, timeoutMs=95000){
  const ctrl=new AbortController();
  const t=setTimeout(()=>ctrl.abort(), timeoutMs);
  try{
    const r=await fetch(url,Object.assign({},opt,{signal:ctrl.signal}));
    const txt=await r.text();
    if(!r.ok){
      if(isRateLimit(r.status,txt)){
        const e=new Error('Бесплатный лимит исчерпан ('+r.status+'): '+String(txt).slice(0,160));
        e.rateLimit=true; e.retryIn=parseRetryIn(txt); e.status=r.status; throw e;
      }
      throw new Error('HTTP '+r.status+' '+txt.slice(0,220));
    }
    try{ return JSON.parse(txt); }catch(e){ throw new Error('Невалидный JSON от сервера: '+txt.slice(0,160)); }
  } finally{ clearTimeout(t); }
}

/* ---------------- JSON extraction & repair ---------------- */
export function extractJSON(text){
  if(text==null) return null;
  let t=String(text).trim();
  const fence=t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(fence) t=fence[1].trim();
  const direct=tryParse(t); if(direct!=null) return direct;
  const bal=balanced(t);
  if(bal){
    const p=tryParse(bal); if(p!=null) return p;
    const fixed=repair(bal); const p2=tryParse(fixed); if(p2!=null) return p2;
    const salv=salvage(fixed); if(salv!=null) return salv;
  }
  const fixed=repair(t);
  const p3=tryParse(fixed); if(p3!=null) return p3;
  return salvage(fixed);
}
/* агрессивное спасение: обрезаем до последней закрытой структуры и закрываем скобки */
function salvage(t){
  const src=String(t||'');
  const keys=['"questions"','"cards"','"topics"','"items"','"qs"'];
  for(const k of keys){
    const i=src.indexOf(k);
    if(i<0) continue;
    const colon=src.indexOf(':',i+k.length);
    if(colon<0) continue;
    const rest=src.slice(colon+1);
    const start=rest.search(/[[{]/);
    if(start<0) continue;
    const sub=rest.slice(start);
    const b=balanced(sub);
    if(b){ const p=tryParse(b)||tryParse(repair(b)); if(p!=null) return p; }
    // обрезаем по последней закрывающей скобке
    const lastObj=sub.lastIndexOf('}');
    if(lastObj>0){
      const cut=sub.slice(0,lastObj+1)+']';
      const p=tryParse(cut)||tryParse(repair(cut));
      if(p!=null) return p;
    }
  }
  // последний шанс: массив объектов
  const objs=[...src.matchAll(/\{[^{}]*\}/g)].map(m=>m[0]);
  if(objs.length>1){
    const arr='['+objs.join(',')+']';
    const p=tryParse(repair(arr)); if(p!=null) return p;
  }
  return null;
}
function tryParse(s){ try{ return JSON.parse(s); }catch(e){ return null; } }
function balanced(t){
  const start=t.search(/[{[]/); if(start<0) return '';
  const open=t[start], close=open==='{'?'}':']';
  let depth=0, inStr=false, esc_=false;
  for(let i=start;i<t.length;i++){
    const c=t[i];
    if(inStr){ if(esc_) esc_=false; else if(c==='\\') esc_=true; else if(c==='"') inStr=false; continue; }
    if(c==='"'){ inStr=true; continue; }
    if(c===open) depth++;
    else if(c===close){ depth--; if(depth===0) return t.slice(start,i+1); }
  }
  return t.slice(start);
}
function repair(t){
  let s=String(t);
  s=s.replace(/[\u201C\u201D]/g,'"').replace(/[\u2018\u2019]/g,"'");
  s=s.replace(/,\s*([}\]])/g,'$1');                 // trailing commas
  if(!s.includes('"')&&s.includes("'")) s=s.replace(/'/g,'"');  // single-quoted json
  s=s.replace(/([{,]\s*)([A-Za-z_][\w-]*)(\s*:)/g,'$1"$2"$3'); // unquoted keys
  s=s.replace(/\bNaN\b/g,'null').replace(/\bundefined\b/g,'null');
  s=s.replace(/:\s*'((?:[^'\\]|\\.)*)'/g,(m,a)=>':"'+a.replace(/"/g,'\\"')+'"');
  // escape raw newlines inside string literals
  let out='', inStr=false, esc_=false;
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(inStr){
      if(esc_){ out+=c; esc_=false; continue; }
      if(c==='\\'){ out+=c; esc_=true; continue; }
      if(c==='"'){ inStr=false; out+=c; continue; }
      if(c==='\n'){ out+='\\n'; continue; }
      if(c==='\r'){ continue; }
      if(c==='\t'){ out+='\\t'; continue; }
      out+=c; continue;
    }
    if(c==='"'){ inStr=true; out+=c; continue; }
    out+=c;
  }
  return out;
}

/* ---------------- provider calls ---------------- */
function messagesFor(sys,user){ return [{role:'system',content:sys},{role:'user',content:user}]; }

async function callProvider(pid, sys, user, opt={}){
  const s=getSettings();
  const model=(opt.model||s.models[pid]||'');
  const key=(s.keys[pid]||'').trim();
  const temp=opt.temperature??s.temp??0.75;
  const wantJSON=opt.json!==false;

  if(pid==='pollinations'){
    const hdr={'Content-Type':'application/json'};
    if(key) hdr['Authorization']='Bearer '+key;
    const body={model:model||'openai-fast',messages:messagesFor(sys,user),temperature:temp};
    if(wantJSON) body.response_format={type:'json_object'};
    if(opt.seed!=null) body.seed=opt.seed;
    let c=null;
    try{
      const r=await httpJSON('https://text.pollinations.ai/openai',{method:'POST',headers:hdr,body:JSON.stringify(body)});
      c=r&&r.choices&&r.choices[0]&&r.choices[0].message&&r.choices[0].message.content;
    }catch(e){
      if(e.rateLimit) throw e;
      try{
        const prompt=sys+'\n\n'+user+'\n\nОтветь ТОЛЬКО валидным JSON, без markdown и пояснений.';
        const u='https://text.pollinations.ai/'+encodeURIComponent(prompt)+'?model='+encodeURIComponent(model||'openai-fast');
        const res=await fetch(u);
        const txt=await res.text();
        if(!res.ok||/free limit reached/i.test(txt)){
          const e2=new Error('LIMIT: '+txt.slice(0,120)); e2.rateLimit=true; e2.retryIn=parseRetryIn(txt); throw e2;
        }
        c=txt;
      }catch(e2){ throw (e2&&e2.rateLimit)?e2:e; }
    }
    if(!c) throw new Error('Пустой ответ Pollinations');
    if(/free limit reached|rate limit|too many requests/i.test(c)) { const e=new Error('LIMIT: '+c.slice(0,90)); e.rateLimit=true; e.retryIn=35; throw e; }
    return c;
  }

  if(pid==='gemini'){
    if(!key) throw new Error('Нет API-ключа Gemini');
    const url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model||'gemini-2.0-flash')+':generateContent?key='+encodeURIComponent(key);
    const body={contents:[{role:'user',parts:[{text:user}]}],systemInstruction:{parts:[{text:sys}]},
      generationConfig:{temperature:temp,maxOutputTokens:opt.maxTokens||8192}};
    if(wantJSON) body.generationConfig.responseMimeType='application/json';
    const r=await httpJSON(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const c=r&&r.candidates&&r.candidates[0]&&r.candidates[0].content&&r.candidates[0].content.parts.map(p=>p.text||'').join('');
    if(!c) throw new Error('Пустой ответ Gemini');
    return c;
  }

  if(pid==='ollama'){
    const base=(s.ollamaUrl||'http://localhost:11434/v1').replace(/\/$/,'');
    const hdr={'Content-Type':'application/json'};
    const body={model:model||'llama3.2',messages:messagesFor(sys,user),temperature:temp,stream:false};
    if(wantJSON) body.response_format={type:'json_object'};
    let r;
    try{
      r=await httpJSON(base+'/chat/completions',{method:'POST',headers:hdr,body:JSON.stringify(body)},60000);
    }catch(e){
      throw new Error('Локальная модель недоступна — запустите Ollama и скачайте модель (ollama pull llama3.2). '+(e.message||''));
    }
    const c=r&&r.choices&&r.choices[0]&&r.choices[0].message&&r.choices[0].message.content;
    if(!c) throw new Error('Пустой ответ модели');
    return c;
  }

  if(pid==='custom'){
    const base=(s.customUrl||'').replace(/\/$/,'');
    if(!base) throw new Error('Не указан URL');
    const hdr={'Content-Type':'application/json'};
    if(key) hdr['Authorization']='Bearer '+key;
    const body={model:model||'gpt-4o-mini',messages:messagesFor(sys,user),temperature:temp};
    if(wantJSON) body.response_format={type:'json_object'};
    const r=await httpJSON(base+'/chat/completions',{method:'POST',headers:hdr,body:JSON.stringify(body)});
    const c=r&&r.choices&&r.choices[0]&&r.choices[0].message&&r.choices[0].message.content;
    if(!c) throw new Error('Пустой ответ сервера');
    return c;
  }

  // groq / openrouter — OpenAI-совместимые
  const base= pid==='groq' ? 'https://api.groq.com/openai/v1' : 'https://openrouter.ai/api/v1';
  const hdr={'Content-Type':'application/json'};
  if(key) hdr['Authorization']='Bearer '+key;
  if(pid==='openrouter') hdr['HTTP-Referer']=location.origin; hdr['X-Title']='BTS AI';
  const body={model:model,messages:messagesFor(sys,user),temperature:temp};
  if(wantJSON) body.response_format={type:'json_object'};
  const r=await httpJSON(base+'/chat/completions',{method:'POST',headers:hdr,body:JSON.stringify(body)});
  const c=r&&r.choices&&r.choices[0]&&r.choices[0].message&&r.choices[0].message.content;
  if(!c) throw new Error('Пустой ответ');
  return c;
}

/* chain of providers to try: выбранный → провайдеры с ключами → pollinations */
export function providerChain(){
  const s=getSettings(); const out=[];
  const add=(id,keyed)=>{ if(!out.some(x=>x.id===id)) out.push({id,keyed:!!keyed}); };
  const sel=s.provider||'pollinations';
  add(sel, !!(s.keys[sel]||'').trim());
  PROVIDERS.forEach(p=>{
    if(p.id==='pollinations') return;
    if(p.id==='ollama'||p.id==='custom'){ if(sel===p.id) add(p.id,true); return; }
    if((s.keys[p.id]||'').trim()) add(p.id,true);
  });
  add('pollinations', !!(s.keys.pollinations||'').trim());
  return out;
}

export async function aiAsk(sys,user,opt={}){
  const raw0=opt.chain||providerChain();
  const chain=raw0.map(x=>typeof x==='string'?{id:x,keyed:false}:x);
  let lastErr=null, waits=0, i=0;
  const maxWaits=opt.maxWaits!=null?opt.maxWaits:4;
  while(i<chain.length){
    const pid=chain[i].id;
    try{
      const raw=await callProvider(pid,sys,user,opt);
      if(opt.json!==false){
        const j=extractJSON(raw);
        if(j!=null) return j;
        lastErr=new Error('Модель вернула не-JSON ('+pid+')');
        try{
          const raw2=await callProvider(pid,sys,user+'  (Ответь ТОЛЬКО валидным JSON объектом, без пояснений и markdown.)',Object.assign({},opt,{json:false}));
          const j2=extractJSON(raw2);
          if(j2!=null) return j2;
        }catch(e2){}
      } else return raw;
      i++;
    }catch(e){
      lastErr=e;
      if(e.rateLimit){
        const hasKeyed=chain.slice(i+1).some(x=>x.keyed);
        if(hasKeyed){ i++; continue; }                  // есть другой провайдер с ключом — переключаемся
        if(waits<maxWaits){
          waits++;
          const sec=Math.min(55,Math.max(4,e.retryIn||35));
          opt.onWait&&opt.onWait(sec,waits,maxWaits);
          await sleep(sec*1000);
          continue;                                    // ждём и повторяем
        }
        const e2=new Error('Бесплатный лимит модели исчерпан (1 запрос в 45 секунд). '+
          'Добавьте бесплатный ключ Gemini/Groq в Настройках — генерация станет мгновенной.');
        e2.rateLimit=true; throw e2;
      }
      i++;
    }
  }
  throw lastErr||new Error('AI недоступен');
}

/* ---------------- prompts ---------------- */
const LANG_NAME={ru:'русский',kk:'казахский',en:'English',tr:'Türkçe'};
const LEVEL_RULES={
 A:`Уровень A (базовый): вопрос должен проверять ПРЯМОЕ знание — определение, факт, формула, единица измерения, классификация.
Решение — 1–2 шага. Никаких вычислений в 4 действия. Формулировка простая и однозначная.`,
 B:`Уровень B (средний): вопрос требует ПРИМЕНЕНИЯ — расчёт в 2–3 шага, сравнение двух понятий, классификация явления, разбор примера,
причинно-следственная связь. Обязательно 4 разумных варианта ответа, все правдоподобные, один верный.`,
 C:`Уровень C (сложный): МНОГОШАГОВАЯ задача (3+ логических шага) либо интеграция двух и более тем, либо ловушка/пограничный случай,
либо задание на ошибку (найди неверное утверждение), либо качественный анализ с выводом. Варианты ответа максимально близки по форме
и отличаются по существу — простым угадыванием не обойтись. Никаких " очевидных" правильных ответов.`
};

function sysPrompt(lang){
  return `Ты — опытный преподаватель и методист, который готовит к экзамену (формат БТС/ЕНТ) и составляет качественные задания.
Ты отвечаешь ТОЛЬКО валидным JSON-объектом без markdown, без комментариев, без текста до и после JSON.
Язык вопросов и ответов: ${LANG_NAME[lang]||lang}. Все формулы пиши в LaTeX ($...$).`;
}

const Q_SCHEMA=`СХЕМА ОДНОГО ВОПРОСА (строго соблюдай):
{
  "level": "A|B|C",
  "topic": "название подтемы",
  "type": "single",
  "q": "текст вопроса",
  "options": {"A":"...","B":"...","C":"...","D":"..."},
  "answer": "A|B|C|D",
  "explanation": "краткое объяснение правильного ответа (1–3 предложения)",
  "hints": ["подсказка 1","подсказка 2"]
}`;
const BULLET=`ПРАВИЛА ОТВЕТА:
1. Ровно столько вопросов, сколько указано в задании. Ни больше, ни меньше.
2. У каждого вопроса ровно 4 варианта ответа A,B,C,D и ровно один верный.
3. Вопросы НЕ должны повторяться и НЕ должны быть вариациями друг друга (разные формулировки одной мысли = повтор).
4. Варианты должны быть разной длины/формулировки, одинаково правдоподобные.
5. Никаких "все варианты верны" и "ни один из вариантов".
6. explanation — на языке задания, конкретно, без воды.
7. Если в вопросе есть формула — оборачивай в $...$.
8. Не используй markdown-заголовки, только JSON.`;

export function buildTestPrompt({topic,level,count,material,avoid,lang}){
  const sys=sysPrompt(lang);
  const u=`СОЗДАЙ ТЕСТ ПО ТЕМЕ.

Тема: ${topic}
Уровень сложности: ${level==='MIX'?'смешанный (A/B/C)':level}
${level==='MIX'?`Распредели уровни примерно поровну: 1/3 — A, 1/3 — B, 1/3 — C.`:LEVEL_RULES[level]||''}
Количество вопросов: ${count}

${material?`ОПОРНЫЙ МАТЕРИАЛ (используй факты из него, не выдумывай):\n"""\n${material}\n"""\n`:'Опирайся на общеизвестные знания по этой теме.'}

${avoid&&avoid.length?`УЖЕ ИСПОЛЬЗОВАННЫЕ ВОПРОСЫ — НЕ ПОВТОРЯЙ ИХ И НЕ ПЕРЕФРАЗИРУЙ:\n${avoid.map((x,i)=>(i+1)+'. '+x).join('\n')}\n`:''}

${Q_SCHEMA}

ОБЩИЙ ФОРМАТ ОТВЕТА:
{"questions":[ {...}, {...} ]}

${BULLET}`;
  return {sys,u};
}

export function buildCardsPrompt({topic,count,material,avoid,lang}){
  const sys=sysPrompt(lang);
  const u=`СОЗДАЙ КАРТОЧКИ ДЛЯ ЗАПОМИНАНИЯ.

Тема: ${topic}
Количество карточек: ${count}

${material?`ОПОРНЫЙ МАТЕРИАЛ:\n"""\n${material}\n"""\n`:'Опирайся на общеизвестные знания по этой теме.'}

${avoid&&avoid.length?`УЖЕ ИСПОЛЬЗОВАННЫЕ КАРТОЧКИ — НЕ ПОВТОРЯЙ:\n${avoid.map((x,i)=>(i+1)+'. '+x).join('\n')}\n`:''}

ФОРМАТ КАРТОЧКИ:
{"level":"A|B|C","topic":"подтема","front":"вопрос/термин (лицевая сторона)","back":"ответ с пояснением (1–3 предложения)","example":"необязательно: пример или формула"}

ОБЩИЙ ФОРМАТ ОТВЕТА:
{"cards":[ {...}, {...} ]}

${BULLET}`;
  return {sys,u};
}

export function buildNotesPrompt({topic,level,material,lang}){
  const sys=sysPrompt(lang);
  const u=`СОЗДАЙ КОНСПЕКТ по теме.

Тема: ${topic}
Глубина: ${level==='C'?'углублённый, с выводами и нестандартными связями':level==='A'?'базовая, чёткая структура':'полная, с формулами и примерами'}

${material?`ОПОРНЫЙ МАТЕРИАЛ:\n"""\n${material}\n"""\n`:'Опирайся на общеизвестные знания по этой теме.'}

ФОРМАТ ОТВЕТА — только JSON:
{
  "title":"заголовок конспекта",
  "markdown":"текст конспекта в markdown: ## разделы, таблицы, списки, формулы в $...$",
  "quiz":{
    "id":"quiz-<англ.слаг>",
    "title":"Мини-тест по конспекту",
    "qs":[
      {"q":"вопрос","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A","explanation":"..."}
    ]
  }
}

Требования к markdown: 3–6 разделов, ключевые формулы, таблицы где уместно, ничего лишнего.
В мини-тесте 8–12 вопросов разной сложности. Формулы в $...$.
Ответ — ТОЛЬКО JSON, без markdown-обёртки.`;
  return {sys,u};
}

export function buildTopicPrompt({text,lang}){
  const sys=sysPrompt(lang);
  const u=`ПРОЧИТАЙ МАТЕРИАЛ И ВЫДЕЛИ ТЕМЫ ДЛЯ ПОДГОТОВКИ К ЭКЗАМЕНУ.

МАТЕРИАЛ:
"""\n${text.slice(0,18000)}\n"""

ФОРМАТ ОТВЕТА:
{"title":"общее название курса/предмета","language":"${lang}","topics":[
  {"title":"Тема 1","summary":"1 предложение о теме","keywords":"ключевые термины через запятую","weight":1}
]}

Требования: 5–20 тем, покрывающих весь материал без пересечений, по-русски (или на языке материала).
Ответ — ТОЛЬКО JSON.`;
  return {sys,u};
}

/* ---------------- chunking ---------------- */
export function chunkText(text,max=6000){
  const paras=String(text||'').split(/\n{2,}/);
  const out=[]; let cur='';
  for(const p of paras){
    if((cur+'\n\n'+p).length>max && cur){ out.push(cur); cur=p; }
    else cur=cur?cur+'\n\n'+p:p;
  }
  if(cur) out.push(cur);
  if(!out.length) out.push(String(text||''));
  return out;
}

/* ---------------- normalising model output ---------------- */
const LEVEL_RE=/^(a|b|c|а|б|в|easy|medium|hard|basic|1|2|3)$/i;
function normLevel(v){
  const s=String(v||'').trim().toLowerCase();
  if(!s) return 'B';
  const m=s.match(LEVEL_RE);
  if(!m) return 'B';
  const c=m[1];
  if(c==='a'||c==='а'||c==='easy'||c==='basic'||c==='1') return 'A';
  if(c==='b'||c==='б'||c==='medium'||c==='2') return 'B';
  return 'C';
}
export function normQuestion(q,defLevel='B'){
  if(!q||typeof q!=='object') return null;
  const text=String(q.q||q.question||q.text||q.stem||'').trim();
  if(text.length<3) return null;
  let o=q.options||q.o||q.variants||q.choices||q.answers;
  if(Array.isArray(o)){ const m={}; 'ABCD'.split('').forEach((k,i)=>m[k]=String(o[i]??'')); o=m; }
  if(typeof o==='string'){ const parts=o.split(/\s*[|;\/]\s*/).filter(Boolean); const m={}; 'ABCD'.split('').forEach((k,i)=>m[k]=String(parts[i]??'')); o=m; }
  o=o||{};
  const opts={};
  let keys=Object.keys(o).filter(k=>['A','B','C','D','a','b','c','d','1','2','3','4'].includes(String(k)));
  if(!keys.length) keys=['A','B','C','D'];
  keys=keys.slice(0,4);
  const order=['A','B','C','D'];
  keys.forEach((k,i)=>{ opts[order[i]]=String(o[k]==null?'':o[k]).trim(); });
  if(!opts.A) return null;
  let ans=String(q.answer!=null?q.answer:(q.c!=null?q.c:(q.correct!=null?q.correct:''))).trim();
  ans=ans.toUpperCase();
  if(/^[1-4]$/.test(ans)) ans='ABCD'[+ans-1];
  if(!'ABCD'.includes(ans)){
    const m=ans.match(/^([A-D])[).:\s]/); if(m) ans=m[1];
  }
  if(!'ABCD'.includes(ans)) return null;
  let type=String(q.type||q.kind||'single').toLowerCase();
  if(type==='multi'||type==='multiple'||type==='several') type='multi';
  else type='single';
  let hints=q.hints||q.h||q.hint||[];
  if(typeof hints==='string') hints=[hints];
  hints=Array.isArray(hints)?hints.map(h=>String(h).trim()).filter(Boolean).slice(0,3):[];
  const topic=String(q.topic||q.t||q.theme||'').trim();
  const lvl=normLevel(q.level!=null?q.level:(q.lvl!=null?q.lvl:q.difficulty),defLevel);
  return {
    id: nowId('q'),
    level:lvl, topic, type,
    q:text,
    o:opts, c:ans,
    e:String(q.explanation||q.e||q.why||q.rationale||'').trim(),
    h:hints,
    fig: q.fig||q.figure||null
  };
}
export function normCard(c,defLevel='B'){
  if(!c||typeof c!=='object') return null;
  const f=String(c.front||c.f||c.q||c.term||c.question||'').trim();
  const b=String(c.back||c.b||c.a||c.answer||c.def||'').trim();
  if(f.length<2||b.length<1) return null;
  return {id:nowId('c'), f, b, level:normLevel(c.level!=null?c.level:c.lvl,defLevel),
          topic:String(c.topic||c.t||'').trim(), example:String(c.example||c.ex||'').trim()};
}

/* ---------------- no-repeat engine ---------------- */
export function isDuplicate(q, seenTextsList){
  const fp=fingerprint(q.q);
  if(seenList().some(x=>x.f===fp)) return true;
  const pool=seenTextsList||seenTexts(140);
  return pool.some(t=>similar(q.q,t));
}
export function markSeen(qs,subject,topic){
  seenAdd(qs.map(q=>({f:fingerprint(q.q||q.f||''), t:String(q.q||q.f||'').slice(0,160), l:q.level||'', s:subject||'', tp:topic||''})));
}

/* ---------------- generation orchestration ---------------- */
const genLog=[];
export function lastGenLog(){ return genLog.slice(-40); }

export async function generateTest(opts,onStep){
  /* opts: {topic, level:'A'|'B'|'C'|'MIX', count, material, subject, seed} */
  const s=getSettings();
  const count=clampInt(opts.count||20,5,60);
  const level=opts.level||'MIX';
  const chunkSize=Math.min(10,Math.max(5,count));
  const avoid=seenTexts(45);
  const made=[];
  const rejected=[];
  let guard=0;

  while(made.length<count && guard<14){
    guard++;
    const need=Math.min(chunkSize,count-made.length);
    const levels=level==='MIX'
      ? Array.from({length:need},(_,i)=>['A','B','C'][ (made.length+i)%3 ])
      : level;
    const {sys,u}=buildTestPrompt({
      topic:opts.topic, level:levels, count:need,
      material:opts.material, avoid:avoid.concat(made.map(q=>q.q).slice(-18)),
      lang:s.lang
    });
    onStep&&onStep({type:'ask',text:`Запрашиваю ${need} вопросов (${levels})…`, done:made.length, total:count});
    let data;
    try{
      data=await aiAsk(sys,u,{seed:(opts.seed||Date.now())%100000+guard,
        onWait:(sec)=>onStep&&onStep({type:'wait',text:`Бесплатный лимит модели: ждём ${sec} c…`,done:made.length,total:count})});
    }
    catch(e){ if(!made.length) throw e; break; }
    const arr=Array.isArray(data)?data:(data&&(data.questions||data.qs||data.items||data.list))||[];
    if(!Array.isArray(arr)||!arr.length){ if(!made.length) throw new Error('Модель не вернула вопросы'); break; }
    let added=0;
    for(const raw of arr){
      const q=normQuestion(raw,level==='MIX'?'B':level);
      if(!q) continue;
      if(made.some(x=>similar(x.q,q.q))) { rejected.push(q.q); continue; }
      if(isDuplicate(q)){ rejected.push(q.q); continue; }
      q.level = level==='MIX' ? q.level : level;
      made.push(q); added++;
      if(made.length>=count) break;
    }
    if(!added) { await sleep(400); }
    onStep&&onStep({type:'progress',text:`Получено ${made.length} из ${count}`, done:made.length, total:count});
  }
  if(!made.length) throw new Error('Не удалось получить вопросы от модели');
  return {questions:made, rejected};
}

export async function generateCards(opts,onStep){
  const s=getSettings();
  const count=clampInt(opts.count||20,4,60);
  const avoid=seenTexts(30);
  const made=[]; let guard=0;
  while(made.length<count && guard<8){
    guard++;
    const need=Math.min(8,count-made.length);
    const {sys,u}=buildCardsPrompt({topic:opts.topic,count:need,material:opts.material,
      avoid:avoid.concat(made.map(c=>c.f).slice(-12)),lang:s.lang});
    onStep&&onStep({type:'ask',text:`Запрашиваю ${need} карточек…`,done:made.length,total:count});
    const data=await aiAsk(sys,u,{seed:guard*7919,
      onWait:(sec)=>onStep&&onStep({type:'wait',text:`Бесплатный лимит модели: ждём ${sec} c…`,done:made.length,total:count})});
    const arr=Array.isArray(data)?data:(data&&(data.cards||data.items||data.list))||[];
    if(!Array.isArray(arr)||!arr.length) break;
    for(const raw of arr){
      const c=normCard(raw);
      if(!c) continue;
      if(made.some(x=>similar(x.f,c.f))) continue;
      if(seenList().some(x=>x.f===fingerprint(c.f))) continue;
      made.push(c);
      if(made.length>=count) break;
    }
    onStep&&onStep({type:'progress',text:`Получено ${made.length} из ${count}`,done:made.length,total:count});
  }
  if(!made.length) throw new Error('Не удалось получить карточки от модели');
  return {cards:made};
}

export async function generateNotes(opts,onStep){
  const s=getSettings();
  const {sys,u}=buildNotesPrompt({topic:opts.topic,level:opts.level||'B',material:opts.material,lang:s.lang});
  onStep&&onStep({type:'ask',text:'Собираю конспект…'});
  const data=await aiAsk(sys,u,{temperature:0.6,
    onWait:(sec)=>onStep&&onStep({type:'wait',text:`Бесплатный лимит модели: ждём ${sec} c…`})});
  if(!data||typeof data!=='object') throw new Error('Модель не вернула конспект');
  const mdtext=String(data.markdown||data.note||data.text||data.content||'').trim();
  if(!mdtext) throw new Error('Пустой конспект');
  let quiz=null;
  if(data.quiz&&typeof data.quiz==='object'){
    const qs=(data.quiz.qs||data.quiz.questions||[]).map(x=>normQuestion(x,'B')).filter(Boolean);
    if(qs.length) quiz={id:String(data.quiz.id||('quiz-'+uidShort())), title:String(data.quiz.title||'Мини-тест'), qs};
  }
  return {title:String(data.title||opts.topic), markdown:mdtext, quiz};
}

/* ---------------- offline fallback (works without any network) ---------------- */
const STOP=new Set(['и','в','на','с','по','для','не','что','как','это','тот','так','же','из','за','до','или','если','быть','который','которые','когда','также','должен','может','более','менее','очень','также','своих','свой','его','её','их','они','эти','этот','эта','этих','один','уже','лишь','более','либо','даже','если','через','между','перед','после','над','под','при','без','против','всё','всех','всего','может','например','также']);
export function localTopics(text){
  const words=String(text||'').toLowerCase().match(/[\p{L}][\p{L}\p{N}-]{3,}/gu)||[];
  const freq={};
  words.forEach(w=>{ if(STOP.has(w)) return; freq[w]=(freq[w]||0)+1; });
  const arr=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,14);
  return arr.map(([w,c])=>({title:w,summary:'Термин встречается в материале '+c+' раз(а).',keywords:w,weight:Math.min(5,c)}));
}
export function localTest(text,topic,count,level='B'){
  const t=String(text||'');
  const sentences=(t.match(/[^.!?\n]{25,240}\./g)||[]).map(s=>s.trim()).filter(s=>s.split(/\s+/).length>=7);
  const qs=[];
  const seen=new Set();
  for(const s of sentences){
    if(qs.length>=count) break;
    const key=normText(s).slice(0,60); if(seen.has(key)) continue; seen.add(key);
    const words=s.replace(/[^A-Za-zА-Яа-яӘәҒғҚқҢңӨөҰұҮүҺһІіЎў0-9 -]/g,'').split(/\s+/).filter(w=>w.length>4);
    if(words.length<6) continue;
    const cut=Math.floor(words.length/2);
    const ans=words[cut];
    const opts=[ans];
    while(opts.length<4){
      const alt=words[Math.floor(Math.random()*words.length)];
      if(alt&&!opts.includes(alt)) opts.push(alt);
      if(opts.length<4&&seen.size<40) break;
    }
    if(opts.length<4) continue;
    const shuffled=opts.slice().sort(()=>Math.random()-0.5);
    const correct=shuffled.indexOf(ans);
    if(correct<0) continue;
    const qText='Согласно материалу по теме «'+(topic||'—')+'», какое утверждение верно?';
    qs.push({id:nowId('q'),level,topic:topic||'',type:'single',q:qText,
      o:{A:shuffled[0],B:shuffled[1],C:shuffled[2],D:shuffled[3]},c:'ABCD'[correct],
      e:'Из фрагмента материала: «'+s.slice(0,180)+'»',h:[]});
  }
  return qs;
}

/* ---------------- misc ---------------- */
function clampInt(v,a,b){ v=parseInt(v,10); if(isNaN(v)) v=a; return Math.max(a,Math.min(b,v)); }
export function providerLabel(){
  const s=getSettings();
  const p=PROVIDERS.find(x=>x.id===s.provider);
  return p?p.name:'—';
}
