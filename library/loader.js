// Numerical slots exist only in the current view. Catalog ordering is not an identity.
const catalogue=GujiCatalog.books;
const books=catalogue.map(b=>[b.title,b.byline,b.genre,...b.aliases]);
const slots=new Map(catalogue.map((b,i)=>[b.id,i]));
function bookIndex(id){return slots.get(id)??-1}
function bookId(index){return catalogue[index]?.id}
const libraryCache=new Map(), pendingBooks=new Map(), offlineReceivers=new Map();
function registerOfflineBook(id,raw){offlineReceivers.get(id)?.(raw)}
function offlineText(meta,url){
 return new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  let source;
  offlineReceivers.set(meta.id,raw=>{source=raw});
  function finish(){
   script.remove();offlineReceivers.delete(meta.id);
   if(typeof source==='string')resolve(source);
   else reject(new Error('无法读取离线正文'))
  }
  script.onload=finish;script.onerror=finish;script.src=url;document.head.appendChild(script)
 })
}
async function loadBook(meta){
 const offline=location.protocol==='file:';
 const url='books/'+encodeURIComponent(meta.id)+'/'+(offline?'offline.js':'content.json')+'?v='+meta.contentSha256;
 let raw;
 if(offline)raw=await offlineText(meta,url);
 else{
  const response=await fetch(url);
  if(!response.ok)throw new Error('正文请求失败 '+response.status);
  raw=await response.text()
 }
 const bytes=new TextEncoder().encode(raw);
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(digest!==meta.contentSha256)throw new Error('正文与目录校验值不一致');
 const content=JSON.parse(raw);
 if(content.bookId!==meta.id||content.schemaVersion!==1||content.chapters.length!==meta.chapterCount)throw new Error('正文与目录版本不符');
 return content.chapters
}
function readBookOnce(index){
 const meta=catalogue[index];
 if(!meta)return Promise.reject(new Error('当前书库没有这部书'));
 if(libraryCache.has(index))return Promise.resolve(libraryCache.get(index));
 if(!pendingBooks.has(index)){
  const request=loadBook(meta).finally(()=>pendingBooks.delete(index));
  pendingBooks.set(index,request)
 }
 return pendingBooks.get(index)
}
function ensureBookText(index){
 return readBookOnce(index).then(chapters=>{libraryCache.set(index,chapters);return chapters})
}
function getChapters(index){return libraryCache.get(index)||[]}
function needsText(index){return !libraryCache.has(index)}
