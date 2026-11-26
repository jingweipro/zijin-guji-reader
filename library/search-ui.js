// Search fetches only allowlisted, content-addressed assets in a built site.
// The source tree and file: protocol read verified books sequentially instead.
function openFulltextSearch(initialBook) {
  const pageSize = 30;
  const initialId = catalogue[initialBook]?.id;
  const options = catalogue.map(meta=>'<label><input type="checkbox" value="'+esc(meta.id)+'"'+
    (meta.id===initialId?' checked':'')+'> '+esc(meta.title)+' <small>'+esc(meta.author||'')+'</small></label>').join('');
  openSheet('全文检索','<form id="fulltext-form"><label for="fulltext-query">检索文字</label>'+
    '<div class="fulltext-query"><input id="fulltext-query" type="search" required autocomplete="off" maxlength="160"><button>检索</button></div>'+
    '<div class="fulltext-filters"><label>范围<select name="scope"><option value="all">整个书库</option><option value="selected">选择书籍</option></select></label>'+
    '<label>文字<select name="field"><option value="both">正文和夹注</option><option value="main">仅正文</option><option value="note">仅夹注</option></select></label></div>'+
    '<details id="fulltext-books" hidden><summary>选择书籍</summary><div>'+options+'</div></details></form>'+
    '<p id="fulltext-status" role="status"></p><div id="fulltext-results"></div><div id="fulltext-pages"></div>');
  const form = box.querySelector('#fulltext-form');
  const query = form.querySelector('input[type=search]');
  const scope = form.elements.scope;
  const picker = form.querySelector('details');
  const status = box.querySelector('#fulltext-status');
  const results = box.querySelector('#fulltext-results');
  const pages = box.querySelector('#fulltext-pages');
  const entries = shellConversions.simplified.entries;
  let controller, current, visibleHits = [];

  function active(signal) { return !signal.aborted && form.isConnected && box.open; }
  function reset() {
    controller?.abort();
    current = null; visibleHits = [];
    results.replaceChildren(); pages.replaceChildren(); status.textContent='';
  }
  function updateScope() {
    picker.hidden = scope.value !== 'selected';
    const n = picker.querySelectorAll(':checked').length;
    picker.querySelector('summary').textContent = '已选 '+n+' 部 · 选择书籍';
  }
  if (initialId) scope.value = 'selected';
  form.oninput = () => { reset(); updateScope(); };
  scope.onchange = () => { updateScope(); picker.open = !picker.hidden; };
  updateScope();
  // A pending close event from a previous sheet must not abort a newly opened one.
  const stopOnClose = () => { if (!box.open || !form.isConnected) {controller?.abort();box.removeEventListener('close',stopOnClose);} };
  box.addEventListener('close',stopOnClose);
  if (matchMedia('(pointer:fine)').matches) query.focus();

  async function readAsset(hash, signal) {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('索引摘要无效');
    const response = await fetch('books/search/'+hash+'.json', {signal});
    if (!response.ok) throw new Error('索引文件暂时无法读取');
    const bytes = await response.arrayBuffer();
    const sum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if (sum!==hash) throw new Error('索引文件校验失败');
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function candidates(ids, needle, field, signal) {
    const hash = document.querySelector('meta[name="guji-search-index"]').content;
    if (!hash || location.protocol==='file:') return Array.from(ids,book=>({book}));
    const manifest = await readAsset(hash,signal);
    if (manifest.schemaVersion!==1) throw new Error('索引格式无法识别');
    for (const id of ids) {
      if (manifest.editions?.[id]!==catalogue[bookIndex(id)].contentSha256) throw new Error('索引与本书版本不符，请刷新页面');
    }
    const possible = manifest.shards.map((s,i)=>ids.has(s.book)?i:-1).filter(i=>i>=0);
    if (!possible.length) return [];
    const singlet = Array.from(needle).length === 1;
    const keys = [...new Set(GujiFulltext.tokens(needle,singlet))];
    // Four evenly spaced bigrams bound the number of directory requests on long queries.
    const sample = keys.length<=4 ? keys : [keys[0],keys[Math.floor(keys.length/3)],keys[Math.floor(keys.length*2/3)],keys.at(-1)];
    if (Array.from(needle).length<=2 && manifest.counts) {
      const bucket=await readAsset(manifest.counts[keys[0]%manifest.counts.length],signal);
      if (Object.hasOwn(bucket,needle)) {
        const bytes=atob(bucket[needle]);
        let cursor=0, shard=0;
        function integer() {
          let n=0, weight=1;
          while (cursor<bytes.length) {
            const b=bytes.charCodeAt(cursor++);n+=(b%128)*weight;
            if (b<128) return n;
            weight*=128;
          }
          throw new Error('索引计数不完整');
        }
        const indexed=[];
        while (cursor<bytes.length) {
          shard+=integer();
          const main=integer(),note=integer();
          const count=field==='main'?main:field==='note'?note:main+note;
          const entry=manifest.shards[shard];
          if(count && ids.has(entry.book)) indexed.push({...entry,count});
        }
        return indexed;
      }
    }
    const bucketCache = new Map();
    for (const key of sample) {
      const hash = manifest.buckets[key%128];
      if (!bucketCache.has(hash)) bucketCache.set(hash,await readAsset(hash,signal));
      const mask = bucketCache.get(hash)[key>>7];
      if (!mask) return [];
      const bits = atob(mask);
      for (let i=possible.length-1;i>=0;i--) {
        const id = possible[i];
        if (!(bits.charCodeAt(id>>3) & (1<<(id&7)))) possible.splice(i,1);
      }
      if (!possible.length) break;
    }
    return possible.map(i=>manifest.shards[i]);
  }

  async function scan(job, chunk, skip, take) {
    const chapters = chunk.hash ? await readAsset(chunk.hash,job.signal) : await readBookOnce(bookIndex(chunk.book));
    const hits = [];
    let count = 0, lastYield = performance.now();
    for (const c of chapters) {
      if (!active(job.signal)) throw new DOMException('已取消','AbortError');
      const result = GujiFulltext.searchChapter(c,job.needle,job.field,entries,Math.max(0,skip-count),take-hits.length);
      for (const hit of result.hits) hits.push({...hit,book:chunk.book,chapterId:c.id,title:c.title});
      count += result.count;
      if (performance.now()-lastYield>12) {await new Promise(r=>setTimeout(r,0));lastYield=performance.now();}
    }
    return {count,hits};
  }

  function display(job, page, hits) {
    visibleHits=hits;
    const shownStart=page*pageSize+1, shownEnd=Math.min((page+1)*pageSize,job.total);
    status.textContent='已检索 '+job.ids.size+' 部 · 共 '+job.total.toLocaleString()+' 处'+(job.total?' · 第 '+shownStart+'–'+shownEnd+' 处':'');
    results.innerHTML=hits.map((hit,i)=>
      '<button type="button" data-hit="'+i+'"><small>'+esc(catalogue[bookIndex(hit.book)].title)+' · '+esc(hit.title)+' · '+
      (hit.field==='main'?'正文':settings.annotations?'夹注':'显示夹注并定位')+'</small><span>'+esc(hit.left)+'<mark>'+esc(hit.match)+'</mark>'+esc(hit.right)+'</span></button>').join('');
    pages.replaceChildren();
    if (page>0) pageButton('上一页',page-1);
    if (shownEnd<job.total) pageButton('下一页',page+1);
    function pageButton(label,n) {
      const button=document.createElement('button');button.textContent=label;button.onclick=()=>switchPage(job,n);pages.append(button);
    }
  }

  async function switchPage(job,n) {
    pages.replaceChildren(); status.textContent='正在取回第 '+(n+1)+' 页…';
    let skip=n*pageSize;
    const hits=[];
    try {
      for (const chunk of job.found) {
        if (skip>=chunk.count) {skip-=chunk.count;continue;}
        const next=await scan(job,chunk,skip,pageSize-hits.length);
        hits.push(...next.hits);skip=0;
        if (hits.length>=pageSize) break;
      }
      if (active(job.signal)) {display(job,n,hits);status.scrollIntoView({block:'nearest'});}
    } catch (err) {if(active(job.signal)) {status.textContent='取回本页失败。'+err.message;displayRetry(()=>switchPage(job,n));}}
  }

  function displayRetry(callback) {
    const retry=document.createElement('button');retry.type='button';retry.textContent='重试';retry.onclick=callback;
    pages.replaceChildren(retry);
  }

  form.onsubmit=async event=>{
    event.preventDefault();reset();
    const needle=GujiFulltext.fold(query.value.trim(),entries);
    const ids=new Set(scope.value==='all'?catalogue.map(b=>b.id):Array.from(picker.querySelectorAll(':checked'),el=>el.value));
    if (!needle || !ids.size) {status.textContent=needle?'请至少选择一部书。':'请输入检索文字。';return;}
    picker.open=false;
    controller=new AbortController();
    const job={ids,needle,field:form.elements.field.value,signal:controller.signal,found:[],total:0};
    current=job;
    const first=[];
    status.textContent='正在查找索引…';
    try {
      const chunks=await candidates(ids,needle,job.field,job.signal);
      for (const [i,chunk] of chunks.entries()) {
        if (!active(job.signal)) return;
        status.textContent='已查 '+i+' / '+chunks.length+' 组 · '+job.total.toLocaleString()+' 处 · '+catalogue[bookIndex(chunk.book)].title;
        const part=chunk.count!==undefined && first.length>=pageSize ?
          {count:chunk.count,hits:[]} : await scan(job,chunk,0,pageSize-first.length);
        if (chunk.count!==undefined && chunk.count!==part.count) throw new Error('索引计数与原文不一致');
        if (part.count) job.found.push({...chunk,count:part.count});
        job.total+=part.count;first.push(...part.hits);
      }
      if (active(job.signal)) display(job,0,first);
    } catch (err) {
      if (!active(job.signal)) return;
      status.textContent='本次检索未完成。'+err.message;
      displayRetry(()=>form.requestSubmit());
    }
  };

  results.onclick=async event=>{
    const target=event.target.closest('[data-hit]');
    const hit=target && visibleHits[Number(target.dataset.hit)];
    const job=current;
    if (!hit || !job) return;
    const id=bookIndex(hit.book);
    try {
      const chapters=await ensureBookText(id);
      if (!active(job.signal)) return;
      const chapter=chapters.findIndex(c=>c.id===hit.chapterId);
      if (chapter<0) throw new Error('章节与当前版本不一致');
      if (hit.field==='note') settings.annotations=true;
      goLocation(id,{chapter,offset:hit.offset});
      highlightSearchStart(chapter,hit.offset);
    } catch(err) {if(active(job.signal))status.textContent='定位未完成。'+err.message;}
  };
}

function highlightSearchStart(chapter,offset) {
  if (!globalThis.Highlight || !globalThis.CSS?.highlights) return;
  const ink=Array.from(document.querySelectorAll('.ink-run[data-chapter="'+chapter+'"]')).find(node=>
    Number(node.dataset.offset)<=offset && Number(node.dataset.end)>offset && JSON.parse(node.dataset.offsets).includes(offset));
  if (!ink) return;
  let index=JSON.parse(ink.dataset.offsets).indexOf(offset);
  const nodes=document.createTreeWalker(ink,NodeFilter.SHOW_TEXT);
  for (let text; (text=nodes.nextNode());) {
    const chars=Array.from(text.textContent);
    if(index>=chars.length){index-=chars.length;continue;}
    const range=new Range();
    const start=chars.slice(0,index).join('').length;
    range.setStart(text,start);range.setEnd(text,start+chars[index].length);
    const mark=new Highlight(range);
    CSS.highlights.set('guji-search-start',mark);
    setTimeout(()=>{if(CSS.highlights.get('guji-search-start')===mark) CSS.highlights.delete('guji-search-start');},5000);
    break;
  }
}
