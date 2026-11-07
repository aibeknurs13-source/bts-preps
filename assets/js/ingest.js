/* ===========================================================
   ingest.js — client-side document parsing
   PDF / DOCX / PPTX / TXT / MD / CSV / JSON / HTML / images (OCR)
   =========================================================== */
import { toast, fmtBytes } from './core.js';

const CDN={
  pdf:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfw:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  mammoth:'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
  jszip:'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  tesseract:'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
};
const loaded={};
function loadScript(url,globalName){
  if(loaded[url]) return loaded[url];
  loaded[url]=new Promise((res,rej)=>{
    if(globalName&&window[globalName]) return res(window[globalName]);
    const s=document.createElement('script');
    s.src=url; s.async=true;
    s.onload=()=>res(globalName?window[globalName]:true);
    s.onerror=()=>rej(new Error('Не удалось загрузить '+url.split('/').pop()));
    document.head.appendChild(s);
  });
  return loaded[url];
}
export async function ensurePDF(){ const lib=await loadScript(CDN.pdf,'pdfjsLib'); if(lib&&lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc=CDN.pdfw; return lib; }
export async function ensureMammoth(){ return loadScript(CDN.mammoth,'mammoth'); }
export async function ensureJSZip(){ return loadScript(CDN.jszip,'JSZip'); }
export async function ensureTesseract(){ return loadScript(CDN.tesseract,'Tesseract'); }

/* ---------- helpers ---------- */
const readBuf = f=>new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(r.error); r.readAsArrayBuffer(f); });
const readTxt = f=>new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(r.error); r.readAsText(f); });
const ext = f=>(f.name.split('.').pop()||'').toLowerCase();

function cleanText(t){
  return String(t||'')
    .replace(/\r\n?/g,'\n')
    .replace(/[ \t]+/g,' ')
    .replace(/\n{3,}/g,'\n\n')
    .replace(/([^\n])\1{4,}/g,'$1$1$1$1')
    .trim();
}

/* ---------- PDF ---------- */
export async function parsePDF(file,onProg){
  const lib=await ensurePDF();
  if(!lib||!lib.getDocument) throw new Error('Библиотека PDF не загрузилась (нет интернета?)');
  const data=await readBuf(file);
  const doc=await lib.getDocument({data,disableWorker:false}).promise;
  let text='', pages=[];
  for(let i=1;i<=doc.numPages;i++){
    const page=await doc.getPage(i);
    const tc=await page.getTextContent();
    let line='',lastY=null;
    const items=tc.items||[];
    for(const it of items){
      const y=it.transform&&it.transform[5];
      if(lastY!=null&&Math.abs(y-lastY)>2.2){ line+='\n'; }
      line+=it.str;
      if(it.hasEOL) line+='\n';
      lastY=y;
    }
    const pt=cleanText(line);
    pages.push(pt);
    text+=(i>1?'\n\n':'')+'--- Страница '+i+' ---\n'+pt;
    onProg&&onProg(i,doc.numPages);
  }
  return {text:cleanText(text),pages,kind:'pdf',meta:{pages:doc.numPages}};
}

/* ---------- DOCX ---------- */
export async function parseDOCX(file){
  const mammoth=await ensureMammoth();
  if(!mammoth||!mammoth.extractRawText) throw new Error('Библиотека DOCX не загрузилась');
  const buf=await readBuf(file);
  const r=await mammoth.extractRawText({arrayBuffer:buf});
  return {text:cleanText(r.value),pages:[],kind:'docx',meta:{}};
}

/* ---------- PPTX ---------- */
export async function parsePPTX(file,onProg){
  const JSZip=await ensureJSZip();
  if(!JSZip) throw new Error('Библиотека JSZip не загрузилась');
  const buf=await readBuf(file);
  const zip=await JSZip.loadAsync(buf);
  const files=Object.keys(zip.files).filter(f=>/^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a,b)=>(+a.match(/(\d+)/)[1])-(+b.match(/(\d+)/)[1]));
  let text=''; const pages=[];
  for(let i=0;i<files.length;i++){
    const xml=await zip.files[files[i]].async('string');
    const runs=[...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m=>m[1]
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'"));
    const p=cleanText(runs.join(' '));
    pages.push(p);
    text+=(i>0?'\n\n':'')+'--- Слайд '+(i+1)+' ---\n'+p;
    onProg&&onProg(i+1,files.length);
  }
  return {text:cleanText(text),pages,kind:'pptx',meta:{slides:files.length}};
}

/* ---------- plain formats ---------- */
export async function parseText(file){
  let t=await readTxt(file);
  if(ext(file)==='html'||ext(file)==='htm'){
    const d=new DOMParser().parseFromString(t,'text/html');
    d.querySelectorAll('script,style,noscript').forEach(n=>n.remove());
    t=d.body?d.body.innerText:t;
  }
  if(ext(file)==='json'){ try{ const j=JSON.parse(t); t=JSON.stringify(j,null,1); }catch(e){} }
  if(ext(file)==='rtf'){
    t=t.replace(/\\'([0-9]{2})/g,(m,h)=>String.fromCharCode(parseInt(h,16)))
         .replace(/\\[a-z]+-?\d*\s?/g,' ').replace(/[{}]/g,' ');
  }
  return {text:cleanText(t),pages:[],kind:ext(file)||'txt',meta:{}};
}

/* ---------- images + OCR ---------- */
export async function parseImage(file,onProg,langs='rus+eng'){
  const T=await ensureTesseract();
  if(!T||!T.recognize) throw new Error('OCR-модуль не загрузился');
  onProg&&onProg('Распознаём текст (OCR)…');
  const res=await T.recognize(file, langs, {logger:m=>{ if(m&&m.status&&onProg) onProg(m.status); }});
  return {text:cleanText((res&&res.data&&res.data.text)||''),pages:[],kind:'image',meta:{ocr:true}};
}

/* ---------- dispatcher ---------- */
export async function parseFile(file,onProg){
  const e=ext(file);
  try{
    if(e==='pdf') return await parsePDF(file,onProg);
    if(e==='docx') return await parseDOCX(file);
    if(e==='pptx') return await parsePPTX(file,onProg);
    if(['png','jpg','jpeg','webp','gif','bmp'].includes(e)) return await parseImage(file,onProg);
    return await parseText(file);
  }catch(err){
    throw new Error('Не удалось прочитать «'+file.name+'»: '+(err&&err.message||err));
  }
}
export const ACCEPT='.pdf,.docx,.pptx,.txt,.md,.markdown,.csv,.json,.html,.htm,.rtf,.png,.jpg,.jpeg,.webp,.gif';
export {fmtBytes};
