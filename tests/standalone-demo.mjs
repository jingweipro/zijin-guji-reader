import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {findChrome,waitFor,devtools} from './chromium.mjs';

const root=path.resolve(process.argv[2]||'');
assert(process.argv[2],'Pass private demo path');
const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.woff':'font/woff','.woff2':'font/woff2','.txt':'text/plain','.epub':'application/epub+zip'};
const server=http.createServer(async(req,res)=>{
 try{
  const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'/index.html'));
  if(!p.startsWith(root+path.sep))return res.writeHead(404).end();
  const b=await readFile(p);
  res.writeHead(200,{'Content-Type':(types[path.extname(p)]||'application/octet-stream')}).end(b);
 }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(path.join(os.tmpdir(),'zijin-demo-chrome-'));
const chrome=spawn(await findChrome(),['--headless','--disable-gpu','--no-proxy-server','--disable-extensions','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','about:blank'],{stdio:'ignore'});
let ws;
try{
 const port=await waitFor(async()=>(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0],'Chrome');
 const target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json())[0];
 ws=new WebSocket(target.webSocketDebuggerUrl);await once(ws,'open');
 const errors=[],cdp=devtools(ws,errors);
 const run=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
 await cdp('Page.enable');await cdp('Runtime.enable');
 await cdp('Page.navigate',{url:base+'/#library'});
 await waitFor(()=>run("document.querySelectorAll('.catalogue-row').length===1"),'one-book catalogue');
 await cdp('Page.navigate',{url:base+'/#read/qianziwen'});
 await waitFor(()=>run("document.querySelector('.ink-run')?.textContent.includes('天地')"),'vertical reader');
 assert.equal(await run("getComputedStyle(document.querySelector('.ink-run')).writingMode"),'vertical-rl');
 console.log('PASS catalogue and vertical reader');
 await cdp('Page.navigate',{url:base+'/#library'});
 await waitFor(()=>run("document.querySelectorAll('.catalogue-row').length===1"),'library');
 await run("document.querySelector('button[aria-label=搜索书库]').click();Array.from(document.querySelectorAll('button')).find(x=>x.innerText.trim()==='全文检索').click();document.querySelector('#fulltext-query').value='天地';document.querySelector('#fulltext-form').requestSubmit()");
 await waitFor(()=>run("document.querySelectorAll('#fulltext-results [data-hit]').length>0"),'local fulltext');
 console.log('PASS search:',await run("document.getElementById('fulltext-status').textContent"));
 const statuses=await run("Promise.all(['books/qianziwen/edition.txt','books/qianziwen/edition.epub','s/20.html'].map(x=>fetch(x).then(r=>r.status)))");
 assert.deepEqual(statuses,[200,200,200]);
 assert.equal(await run("cardCreditUrl({creditPage:'s/20.html'})"),base+'/s/20.html');
 // Isolated, inert audit payloads; mutate only the disposable browser profile.
 await run("closeSheet();const meta=catalogue[0];meta.title='<img data-audit-marker src=x>';meta.exports.licenceUrl='javascript:void(0)';meta.sources.push({kind:'original',status:'approved',detail:'<img data-audit-marker src=x>',url:'javascript:void(0)'});bookSources(0)");
 assert.equal(await run("box.querySelectorAll('[data-audit-marker],a[href^=javascript]').length"),0);
 assert.equal(await run("box.textContent.includes('<img data-audit-marker src=x>')"),true);
 await run("closeSheet();catalogue[0].creditPage='javascript:void(0)';openStudyShare({book:0,quote:'天地'})");
 assert.equal(await run("box.querySelectorAll('a[href^=javascript]').length"),0);
 assert.equal(await run("box.querySelectorAll('[data-audit-marker]').length"),0);
 console.log('PASS hostile metadata text and URL attributes are inert');
 assert.equal(errors.length,0,JSON.stringify(errors));
 console.log('PASS exports, local attribution, no browser exceptions');
}finally{
 ws?.close();if(chrome.exitCode===null){const exit=once(chrome,'exit');chrome.kill();await exit}
 server.close();await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
