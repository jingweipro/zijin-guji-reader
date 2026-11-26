import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {createSearchIndex} from './search-index.mjs';
import {catalogScript,offlineScript,serialize,sha256,validateBook,validateCatalog,validId} from './book-format.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
assert(args.length>=2,'Usage: node tools/build-library.mjs NEW_OUTPUT DATA_DIR [DATA_DIR] [--book ID]');
const out=path.resolve(args.shift());
let selected=null;
const flag=args.indexOf('--book');
if(flag>=0){assert(flag===args.length-2&&validId(args[flag+1]));selected=args[flag+1];args.splice(flag,2)}
assert(args.length&&args.every(a=>!a.startsWith('--')),'Data directories required');
const files=new Map(),books=[];
const add=(name,bytes)=>{
 assert(!path.posix.isAbsolute(name)&&!name.split('/').includes('..')&&!name.includes('\\'));
 bytes=Buffer.from(bytes);
 assert(bytes.length<=25*1024*1024,'Asset exceeds 25 MiB');
 if(files.has(name))assert.deepEqual(files.get(name),bytes,'Conflicting file '+name);
 else files.set(name,bytes);
};
const assets='index.html app.js shell.js study.js fonts.css shell.css study.css reader.css library/browse.js library/corrections.js library/fulltext.js library/loader.js library/point-selection.js library/scroll-png.js library/search-ui.js library/search.css library/storage.js library/study-room.js fonts/ZhuqueFangsong-Regular.woff fonts/Zhuque-OFL.txt fonts/Zijin-WenKaiTC.woff2 fonts/WenKaiTC-OFL.txt fonts/Zijin-CNSKai.woff2 fonts/CNS-Kai-OFL.txt licenses/ICU-LICENSE.txt _headers'.split(' ');
for(const f of assets)add(f,await readFile(path.join(root,f)));
const index=createSearchIndex(files.get('shell.js').toString());
const seen=new Set();
for(const dir of args){
 const src=await realpath(dir);
 const catalogue=JSON.parse(await readFile(path.join(src,'catalog-sharing.json'),'utf8'));
 assert(Array.isArray(catalogue.books));
 for(const b of catalogue.books){
  if(selected&&b.id!==selected)continue;
  assert(validId(b.id)&&!seen.has(b.id),'Invalid or duplicate book');
  const id=b.id,base='books/'+id+'/';
  assert(['CC BY 4.0','CC BY-SA 4.0','MIT','CC BY-NC-SA 4.0'].includes(b.licence),'Unknown license');
  const entries=new Map(b.files.map(x=>[x.path,x]));assert(entries.size===b.files.length);
  async function checked(name){
   const e=entries.get(name);assert(e,'Missing '+name);
   const p=path.join(src,name);assert.equal(await realpath(p),p,'Redirected path');
   const bytes=await readFile(p);assert.equal(bytes.length,e.bytes);assert.equal(sha256(bytes),e.sha256);return bytes;
  }
  const meta=JSON.parse(await checked(base+'meta.json'));
  const raw=await checked(base+'content.json'),content=JSON.parse(raw);
  validateBook(meta,content,raw.toString());
  assert(meta.id===id&&meta.rights.publicApproved&&meta.exports?.licence===b.licence);
  assert(meta.exports.contentSha256===meta.contentSha256);
  const grant=meta.attribution||meta.exports;
  assert(grant.credit===b.credit&&grant.licence===b.licence&&grant.licenceUrl===b.licenceUrl);
  assert(/^s\/[0-9]+\.html$/.test(meta.creditPage));
  const credit=await checked(meta.creditPage);
  assert.equal(sha256(credit),meta.creditSha256);
  // Attribution pages are approved static documents, not executable applications.
  assert(!/<\s*(?:script|iframe|object|embed)\b|\bon[a-z]+\s*=|javascript\s*:/i.test(credit.toString()),'Active credit page');
  add(meta.creditPage,credit);
  for(const [ext,digest] of [['txt',meta.exports.txtSha256],['epub',meta.exports.epubSha256]]){
   const name=base+'edition.'+ext,bytes=await checked(name);assert.equal(sha256(bytes),digest);add(name,bytes);
  }
  if(meta.sourceNoticeSha256){
   assert(/^[a-f0-9]{64}$/.test(meta.sourceNoticeSha256));
   const f='notices/'+meta.sourceNoticeSha256+'.txt',bytes=await checked(f);assert.equal(sha256(bytes),meta.sourceNoticeSha256);add(f,bytes);
  }
  if(b.licence==='CC BY-NC-SA 4.0'){
   assert(meta.sourceNoticeSha256,'Missing original notice');
   add('notices/CBETA-usage.txt',await checked('notices/CBETA-usage.txt'));
  }
  // Comparison texts are intentionally not distributed by the data repositories.
  delete meta.witness;
  books.push(meta);seen.add(id);
  add(base+'meta.json',serialize(meta));add(base+'content.json',raw);
  add(base+'offline.js',offlineScript(id,raw.toString()));
  index.index(meta,content);
 }
}
assert(books.length,'No selected books');
const catalog={schemaVersion:1,books};validateCatalog(catalog);
add('books/catalog.json',serialize(catalog));add('books/catalog.js',catalogScript(catalog));
const searchHash=index.finish(add);
let html=files.get('index.html').toString();
assert(html.includes('name="guji-search-index" content=""'));
files.set('index.html',Buffer.from(html.replace('name="guji-search-index" content=""','name="guji-search-index" content="'+searchHash+'"')));
const sections=new Map();
for(const b of books){if(!sections.has(b.section))sections.set(b.section,[]);sections.get(b.section).push(b.id)}
const lists=[...sections].map(([name,ids],i)=>({id:'section-'+i,name,ids}));
let browse=files.get('library/browse.js').toString();
assert(browse.includes('const localLists = [];'));
files.set('library/browse.js',Buffer.from(browse.replace('const localLists = [];','const localLists = '+JSON.stringify(lists)+';')));
assert(files.size<20000,'Too many static assets');
await mkdir(out,{recursive:false});
for(const [name,bytes] of files){const dest=path.join(out,name);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,bytes,{flag:'wx'})}
console.log('Built',books.length,'books;',files.size,'assets at',out);
