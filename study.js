/* The saved address is a chapter and source-text offset, independent of screen size. */
let studyPassage = null;
let studyShelfMode = 'all';
let studyShelfIndex = 0;
let studySheetTab = 'bookmark';
let shareEntry = null;
let sharePart = 0;
let sharePageCount = 1;
const cardThemes = [
  {name:'玄墨', paper:'#100f0d', ink:'#e0cba8', rule:'#bda57f'},
  {name:'墨白', paper:'#faf9f6', ink:'#211e1a', rule:'#625a4f'},
  {name:'朱栏', paper:'#f2ebdb', ink:'#2e2721', rule:'#ab4942'},
  {name:'藏青', paper:'#094654', ink:'#e8d9b5', rule:'#c7ba98'},
  {name:'竹青', paper:'#e4eadd', ink:'#323f32', rule:'#6b8068'},
  {name:'绛雪', paper:'#6c303a', ink:'#f5e4cd', rule:'#cca69a'},
  {name:'藏蓝', paper:'#233758', ink:'#f3e7cb', rule:'#b6a784'},
  {name:'宣笺', paper:'#eee3d1', ink:'#3d3128', rule:'#aa9278'}
];
function studyOptions(){
  return state.cardStyle = {layout:'scroll',theme:1,height:430,font:27,book:true,author:true,chapter:false,seal:true,date:false,rules:true,...state.cardStyle};
}
function studyKey(){
  return crypto.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
}
function studyFeedback(message){
  document.querySelector('.study-toast')?.remove();
  const el=document.createElement('div');
  el.className='study-toast';el.setAttribute('role','status');el.textContent=message;
  (document.querySelector('dialog[open]') || document.body).append(el);
  setTimeout(()=>el.remove(),2100);
}
function studyChapterText(index){
  return (chapterList[index]?.blocks || []).map(block=>block.main ?? block.note ?? '').join('');
}
function selectionAddress(node,offset,end=false){
  const host=(node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement)?.closest('[data-offset]');
  if(!host)return null;
  const range=document.createRange();
  range.selectNodeContents(host);
  try{range.setEnd(node,offset)}catch{return null}
  const prefix=range.toString();
  const count=Array.from(prefix).length;
  let positions;
  try{positions=JSON.parse(host.dataset.offsets || 'null')}catch{}
  const chapter=Number(host.dataset.chapter??activeChapter);
  if(!Array.isArray(positions) || count>positions.length)return null;
  if(end && count){
    const last=positions[count-1], cp=studyChapterText(chapter).codePointAt(last);
    return Number.isInteger(cp)?{chapter,offset:last+(cp>0xffff?2:1)}:null;
  }
  return {chapter,offset:positions[count]??Number(host.dataset.end)};
}
function currentPassage(text=''){
  const location=readerLocation();
  let start=location.offset, exact=false;
  let chapter=location.chapter;
  let end=start+text.length, endChapter=chapter;
  const sel=window.getSelection();
  if(text && sel?.rangeCount){
    const range=sel.getRangeAt(0);
    const a=selectionAddress(range.startContainer,range.startOffset);
    const b=selectionAddress(range.endContainer,range.endOffset,true);
    if(a && b){
      exact=true;chapter=a.chapter;endChapter=b.chapter;start=a.offset;end=b.offset
    }
  }
  let runs=[];
  if(text && sel?.rangeCount){
    const selected=sel.getRangeAt(0);
    const root=selected.commonAncestorContainer;
    const each=(root.nodeType===Node.ELEMENT_NODE?root:root.parentElement);
    const host=each.closest('[data-offset]');
    const fragments=host?[host]:each.querySelectorAll('[data-offset]');
    for(const el of fragments){
      if(!selected.intersectsNode(el))continue;
      const part=document.createRange();part.selectNodeContents(el);
      if(part.compareBoundaryPoints(Range.START_TO_START,selected)<0)part.setStart(selected.startContainer,selected.startOffset);
      if(part.compareBoundaryPoints(Range.END_TO_END,selected)>0)part.setEnd(selected.endContainer,selected.endOffset);
      const content=part.toString();if(!content)continue;
      const note=Boolean(el.closest('[data-kind="note"],.interlinear,.annotation'));
      if(runs.length && runs.at(-1).note===note)runs.at(-1).text+=content;
      else runs.push({text:content,note})
    }
  }
  return {book,chapter,endChapter,exact,offset:start,end,chapterTitle:chapterList[chapter]?.title||'',quote:text,runs};
}
function clearStudyMenu(){document.getElementById('study-selection')?.remove()}
function studySelectionActions(){
  return [['查询',searchStudyText],['划线',markStudyText],['笔记',()=>openStudyNote(studyPassage)],['复制',()=>studyCopy(studyPassage.quote)],['分享',()=>openStudyShare(studyPassage)],['纠错',()=>openCorrection(studyPassage)]];
}
function openSelectionMenu(text,rect){
  clearStudyMenu();
  if(!text?.trim() || !rect || book===null)return;
  studyPassage=currentPassage(text);
  const panel=document.createElement('div');
  panel.id='study-selection';panel.className='study-menu';
  panel.setAttribute('role','toolbar');panel.setAttribute('aria-label','选文操作');

  for(const [name,action] of studySelectionActions()){
    const btn=document.createElement('button');btn.textContent=name;
    btn.addEventListener('pointerdown',e=>e.preventDefault());
    btn.onclick=e=>{
      e.stopPropagation();clearStudyMenu();
      if(!studyPassage.exact && ['划线','笔记','纠错'].includes(name)){studyFeedback('选文边界未能定位，请重新选择或使用两点选文。');return}
      action()
    };
    panel.append(btn)
  }
  document.body.append(panel);
  const w=panel.offsetWidth,h=panel.offsetHeight;
  panel.style.left=Math.max(6,Math.min(innerWidth-w-6,(rect.left+rect.right-w)/2))+'px';
  const top=rect.bottom+h+10<innerHeight ? rect.bottom+6 : rect.top-h-6;
  panel.style.top=Math.max(6,Math.min(innerHeight-h-6,top))+'px';
}
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#study-selection'))clearStudyMenu()},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape')clearStudyMenu()});
function refreshStudyReader(){
  const location=readerLocation();
  closeSheet();goLocation(book,location)
}
function markStudyText(){
  const entry={...studyPassage,id:studyKey(),kind:'line',created:Date.now()};
  const entries=state.studyLines??=[];
  let persisted=true;
  if(!entries.some(item=>item.book===entry.book && item.chapter===entry.chapter && item.offset===entry.offset && item.end===entry.end && (item.endChapter??item.chapter)===entry.endChapter)){
    entries.unshift(entry);persisted=save()
  }
  window.getSelection()?.removeAllRanges();
  refreshStudyReader();studyFeedback(persisted?'已划线':'划线仅保留在当前页，请导出备份')
}
function decorateStudyText(text,chapter,offset,positions){
  const ranges=(state.studyLines||[]).filter(m=>!m.needsReview && m.book===book && m.chapter<=chapter && (m.endChapter??m.chapter)>=chapter);
  if(!ranges.length)return esc(text);
  let html='',active=false;
  let sourceOffset=offset;
  Array.from(text).forEach((ch,i)=>{
    const pos=positions?.[i]??sourceOffset;
    sourceOffset+=ch.length;
    const marked=ranges.some(m=>(m.chapter<chapter||m.offset<=pos)&&((m.endChapter??m.chapter)>chapter||m.end>pos));
    if(marked!==active){html+=marked?'<mark class="study-line">':'</mark>';active=marked}
    html+=esc(ch)
  });
  return html+(active?'</mark>':'')
}
let studyMatches=[];
function searchStudyText(){
  const normalized=s=>(typeof convertScript==='function'?convertScript(s,'simplified'):s);
  const ignore=/[\s\p{P}]/u;
  const needle=normalized(studyPassage.quote).replace(/[\s\p{P}]/gu,'');
  studyMatches=[];
  if(needle){
    // A quotation can cross chapters or skip hidden interlinear notes. Keep the offsets of the base text.
    const crossChapters=studyPassage.endChapter>studyPassage.chapter;
    let carry='',position=0,nextMatch=0;
    const sections=[];
    for(let chapter=0;chapter<chapterList.length;chapter++){
      let body='',sourceOffset=0;const map=[];
      for(const block of chapterList[chapter].blocks){
        const raw=block.main??block.note??'';
        if(block.note!==undefined && !settings.annotations){sourceOffset+=raw.length;continue}
        const original=Array.from(raw),simple=Array.from(normalized(raw));
        original.forEach((char,i)=>{
          const v=simple.length===original.length?simple[i]:normalized(char);
          if(!ignore.test(v)){body+=v;for(let j=0;j<v.length;j++)map.push(sourceOffset)}
          sourceOffset+=char.length;
        });
      }
      if(!body.length)continue;
      sections.push({chapter,map,start:position,end:position+body.length});
      const text=carry+body,base=position-carry.length;
      let section=0;
      for(let at=text.indexOf(needle,Math.max(0,nextMatch-base));at!==-1;at=text.indexOf(needle,at+needle.length)){
        const absolute=base+at;
        while(section+1<sections.length && sections[section+1].start<=absolute)section++;
        const first=sections[section];
        studyMatches.push({chapter:first.chapter,offset:first.map[absolute-first.start]});
        nextMatch=absolute+needle.length;
      }
      position+=body.length;
      // Only keep the suffix that could be the beginning of a match in a later chapter.
      const keep=crossChapters?Math.min(text.length,needle.length-1):0;
      carry=keep?text.slice(-keep):'';
      while(sections.length && sections[0].end<=position-keep)sections.shift();
    }
  }
  showStudyMatches(0)
}
function showStudyMatches(page){
  const size=40,total=studyMatches.length;
  const results=studyMatches.slice(page*size,(page+1)*size).map(item=>{
    const source=studyChapterText(item.chapter),len=Math.min(28,studyPassage.quote.length);
    return '<button class="study-result" onclick="jumpStudyResult('+item.chapter+','+item.offset+')"><small>'+esc(chapterList[item.chapter].title)+'</small>'+esc(source.slice(Math.max(0,item.offset-6),item.offset+len+12))+'</button>'
  }).join('');
  const pager=total>size?'<div class="study-options"><button '+(!page?'disabled':'')+' onclick="showStudyMatches('+(page-1)+')">上一页</button><button '+((page+1)*size>=total?'disabled':'')+' onclick="showStudyMatches('+(page+1)+')">下一页</button></div>':'';
  openSheet('全书查询','<div class="study-search"><p>「'+esc(studyPassage.quote.trim())+'」 · '+total+' 处</p>'+results+pager+'</div>')
}
function jumpStudyResult(chapter,offset){closeSheet();goLocation(book,{chapter,offset})}
function toggleBookmark(){
  const location=currentPassage();
  const entries=state.studyBookmarks??=[];
  const i=entries.findIndex(bookmarkInLeadingColumn);
  if(i>=0)entries.splice(i,1);
  else entries.unshift({...location,id:studyKey(),kind:'bookmark',created:Date.now(),
    quote:studyChapterText(location.chapter).slice(location.offset,location.offset+28)});
  const persisted=save();
  studyFeedback(persisted?(i>=0?'已移除书签':'已加入书签'):'书签改动仅保留在当前页，请导出备份');return i<0
}
function bookmarkInLeadingColumn(mark){
  const index=visibleColumn(), column=readerColumns[index], next=readerColumns[index+1];
  if(mark.needsReview||!column||mark.book!==book||mark.chapter!==column.chapter)return false;
  const limit=next?.chapter===column.chapter?next.offset:Infinity;
  return mark.offset===column.offset||(mark.offset>column.offset&&mark.offset<limit)
}
function isStudyBookmarked(){
  return (state.studyBookmarks||[]).some(bookmarkInLeadingColumn)
}
function studyEntries(type){
  return type==='bookmark'?state.studyBookmarks??[]:type==='line'?state.studyLines??[]:state.notes??[]
}
function renderStudySheet(type=studySheetTab){
  studySheetTab=type==='bookmark'?'bookmark':'study';
  const groups=studySheetTab==='bookmark'?['bookmark']:['note','line'];
  const list=groups.flatMap(kind=>studyEntries(kind).map((item,index)=>({item,index,kind}))).filter(({item})=>item.book===book).sort((a,b)=>(b.item.created||0)-(a.item.created||0));
  const labels={note:'笔记',line:'划线',bookmark:'书签'};
  const items=list.map(({kind,item,index})=>'<div class="study-record"><button onclick="locateStudyEntry(\''+kind+'\','+index+')"><small>'+labels[kind]+(item.needsReview?' · 待核对':'')+' · '+esc(item.chapterTitle||books[item.book][0])+'</small><span>'+esc(item.text||item.quote||'此处')+'</span></button><button class="study-delete" onclick="deleteStudyRecord(\''+kind+'\','+index+')">删除</button></div>').join('');
  const placeholder=studySheetTab==='bookmark'?'<div class="study-blank"><b>无书签</b><small>轻点页面，点击左上角书签按钮</small></div>':'<div class="study-blank"><b>无划线笔记</b><small>轻点书页，点「选文」选取起止字</small></div>';
  openSheet('书签与划线笔记','<div class="study-register"><div class="study-register-tabs">'+[['bookmark','书签'],['study','划线笔记']].map(([v,t])=>'<button aria-pressed="'+(v===studySheetTab)+'" onclick="renderStudySheet(\''+v+'\')">'+t+'</button>').join('')+'</div><div class="study-register-list">'+(items||placeholder)+'</div><button type="button" class="source-button" onclick="openFulltextSearch(book)">检索本书</button></div>')
}
function locateStudyEntry(kind,index){
  const entry=studyEntries(kind)[index];
  if(!entry)return;
  if(needsText(entry.book)){const task=loadForReading(entry.book,()=>locateStudyEntry(kind,index));box.dataset.loading=loadToken;return task}
  readerStore.resolveBook(state,entry.book);
  if(entry.needsReview){openSheet('原文位置待核对','<p>'+esc(entry.needsReview)+'</p><blockquote>'+esc(entry.quote||entry.text||'')+'</blockquote>');return}
  closeSheet();studyShelfIndex=0;
  if(entry.chapter!=null)goLocation(entry.book,{chapter:entry.chapter,offset:entry.offset??0});
  else readBook(entry.book,entry.page,entry.offset)
}
function deleteStudyRecord(kind,index){
  if(!window.confirm('删除这条'+({line:'划线',note:'笔记',bookmark:'书签'}[kind])+'？'))return;
  studyEntries(kind).splice(index,1);save();
  if(book!=null){
    if(kind==='line')refreshStudyReader();
    renderStudySheet()
  }else{closeSheet();go(1)}
}
let editingStudyEntry;
function openStudyNote(passage){
  editingStudyEntry=passage?.book!=null ? {...passage} : currentPassage(window.getSelection()?.toString().trim()||'');
  const val=editingStudyEntry.text||'';
  const quote=editingStudyEntry.quote?'<blockquote>'+esc(editingStudyEntry.quote)+'</blockquote>':'';
  openSheet('笔记','<form class="study-editor" id="study-editor"><small>'+esc(books[editingStudyEntry.book][0])+' · '+esc(editingStudyEntry.chapterTitle||'读书笔记')+'</small>'+quote+'<textarea aria-label="笔记正文" placeholder="记下心得…" rows="4" maxlength="6000">'+esc(val)+'</textarea><button class="study-primary" type="submit">保存笔记</button></form>');
  const form=document.getElementById('study-editor');
  form.onsubmit=e=>{
    e.preventDefault();const text=form.querySelector('textarea').value.trim();
    if(!text&&!editingStudyEntry.quote){form.querySelector('textarea').focus();return}
    editingStudyEntry.id ||= studyKey();
    const found=state.notes.find(n=>n.id===editingStudyEntry.id);
    if(found)found.text=text;
    else state.notes.unshift({...editingStudyEntry,kind:'note',text,created:Date.now()});
    if(!save()){
      studyFeedback('笔记暂存本页。可重试保存，或关闭后导出备份。');return
    }
    closeSheet();if(book===null)go(1);studyFeedback('笔记已保存');
  };
  form.querySelector('textarea').focus()
}
async function studyCopy(text){
  try{await navigator.clipboard.writeText(text);studyFeedback('已复制')}
  catch{
    const area=document.createElement('textarea');area.value=text;
    const host=document.querySelector('dialog[open]')||document.body;host.append(area);area.select();
    if(document.execCommand('copy')){area.remove();studyFeedback('已复制')}
    else {openSheet('复制文字','<textarea aria-label="待复制的文字" class="study-copy-text" readonly>'+esc(text)+'</textarea>');document.querySelector('.study-copy-text').select()}
  }
}
function noteExcerpt(entry){return [entry.quote,entry.text].filter(Boolean).join('　')}
function renderNotesHome(){
  app.innerHTML='<header><h1>笔记</h1></header>';
  const entries=state.notes || [];
  if(!entries.length){
    app.insertAdjacentHTML('beforeend','<div class="study-no-notes"><span aria-hidden="true">記</span><p>尚无笔记</p><small>在书中点「选文」，选好起止字后点「笔记」。</small></div>');
    return
  }
  const index=Math.min(studyShelfIndex,entries.length-1);
  const sources=studyShelfMode==='one'?[[entries[index],index]]:entries.map((item,i)=>[item,i]);
  app.querySelector('header')?.insertAdjacentHTML('beforeend','<div class="study-home-actions"><button aria-label="分享笔记" title="分享笔记" onclick="openStudyShare(state.notes['+index+'])">↥</button><button aria-label="笔记选项" title="笔记选项" onclick="showNotesOptions()">···</button></div>');
  const opts=studyOptions();
  app.insertAdjacentHTML('beforeend','<div class="study-gallery">'+sources.map(([item,i])=>{
    const title=esc(item.chapterTitle||books[item.book]?.[0]||'笔记');
    return '<button class="study-card" onclick="showHomeNote('+i+')" aria-label="查看'+title+'笔记"><canvas data-note="'+i+'"></canvas></button>'
  }).join('')+'</div>');
  const painter=new IntersectionObserver(entries=>{
    for(const entry of entries){
      if(!entry.isIntersecting)continue;
      const canvas=entry.target, note=state.notes[Number(canvas.dataset.note)];
      if(note){
        const options={...opts,height:500,chapter:true};
        paintStudyCard(canvas,note,options,0);
        loadCardFace(options).then(()=>{if(canvas.isConnected)paintStudyCard(canvas,note,options,0)})
      }
      painter.unobserve(canvas)
    }
  });
  for(const canvas of app.querySelectorAll('[data-note]'))painter.observe(canvas)
}
function showNotesOptions(){
  openSheet('笔记','<div class="study-options"><button onclick="randomStudyNote()">随机回顾</button><button onclick="studyShelfMode=\'all\';studyShelfIndex=0;closeSheet();go(1)">全部笔记</button></div>')
}
function randomStudyNote(){
  const len=state.notes.length;
  studyShelfIndex=len>1?(studyShelfIndex+1+Math.floor(Math.random()*(len-1)))%len:0;
  studyShelfMode='one';closeSheet();go(1)
}
function showHomeNote(index){
  const entry=state.notes[index];
  if(!entry.id){entry.id=studyKey();save()}
  openSheet(books[entry.book][0],'<div class="study-editor">'+(entry.quote?'<blockquote>'+esc(entry.quote)+'</blockquote>':'')+'<p>'+esc(entry.text||'')+'</p><div class="study-options"><button onclick="locateStudyEntry(\'note\','+index+')">回到原文</button><button onclick="openStudyNote(state.notes['+index+'])">编辑</button><button onclick="openStudyShare(state.notes['+index+'])">分享</button><button onclick="deleteStudyRecord(\'note\','+index+')">删除</button></div></div>')
}
let shareTab='style', shareFallback=false;
function openStudyShare(entry){
  if(!entry)return;
  shareEntry={...entry,created:entry.created??Date.now()};sharePart=0;shareTab='style';shareFallback=false;showStudyShare()
}
function showStudyShare(){
  const opts=studyOptions();
  const switches=[['book','书名'],['author','作者'],['chapter','章节'],['seal','印章'],['date','日期'],['imprint','落款']];
  const frames=[['none','无框'],['single','单框'],['double','双框']];
  const framing='<div class="share-switches">'+frames.map(([value,label])=>'<button aria-pressed="'+((opts.frame||'double')===value)+'" onclick="setCardOption(\'frame\',\''+value+'\')">'+label+'</button>').join('')+'<button aria-pressed="'+opts.rules+'" onclick="setCardOption(\'rules\','+!opts.rules+')">界栏</button>'+(opts.layout==='pages'?'<button aria-pressed="'+!!opts.narrow+'" onclick="setCardOption(\'narrow\','+!opts.narrow+')">窄幅</button>':'')+'</div>';
  const styles='<div class="share-switches">'+switches.map(([key,label])=>'<button aria-pressed="'+!!opts[key]+'" onclick="setCardOption(\''+key+'\','+!opts[key]+')">'+label+'</button>').join('')+'</div>'+framing+'<div class="share-colors">'+cardThemes.map((c,i)=>'<button aria-label="'+c.name+'" title="'+c.name+'" aria-pressed="'+(opts.theme===i)+'" style="--swatch:'+c.paper+';--swatch-line:'+c.rule+'" onclick="setCardOption(\'theme\','+i+')"></button>').join('')+'</div>';
  const fonts='<div class="share-switches">'+typefaces.map(({id:key,name:label})=>'<button aria-pressed="'+((opts.face||'song')===key)+'" onclick="setCardOption(\'face\',\''+key+'\')">'+label+'</button>').join('')+'</div><label class="share-setting">字号<input type="range" min="18" max="38" value="'+opts.font+'" oninput="setCardSize(\'font\',this.value)"></label>';
  const controls='<div class="share-control-panel"><div class="share-tabs">'+[['style','样式'],['font','字体']].map(([key,label])=>'<button aria-pressed="'+(shareTab===key)+'" onclick="shareTab=\''+key+'\';showStudyShare()">'+label+'</button>').join('')+'</div>'+(shareTab==='style'?styles:fonts)+'<label class="share-setting">高度<input type="range" min="280" max="610" step="10" value="'+opts.height+'" oninput="setCardSize(\'height\',this.value)"></label></div>';
  const layouts='<div class="share-tabs share-layouts" aria-label="分享版式">'+[['scroll','长卷'],['pages','分页']].map(([key,label])=>'<button aria-pressed="'+(opts.layout===key)+'" onclick="setCardOption(\'layout\',\''+key+'\')">'+label+'</button>').join('')+'</div>';
  const credit=cardCredits(shareEntry);
  const sourceUrl=cardCreditUrl(catalogue[shareEntry.book]);
  const source=credit.length?'<details class="share-source"><summary>出处与许可</summary><div>'+credit.map(line=>'<p>'+esc(line)+'</p>').join('')+(sourceUrl?'<a href="'+esc(sourceUrl)+'" target="_blank" rel="noopener">查看版本出处页</a>':'')+'</div></details>':'';
  openSheet('分享','<div class="share-workspace">'+layouts+'<div id="share-paper-window" tabindex="0" aria-label="从右向左的摘录预览"><div id="share-paper-strip"><canvas id="study-share-canvas" aria-label="竖排摘录预览"></canvas></div></div><div class="share-paging" id="share-paging" aria-live="polite"></div>'+controls+'<div class="share-outputs"><button data-png disabled onclick="saveStudyCard()">保存图片</button><button data-png disabled onclick="sendStudyCard()">分享图片</button><button data-share-text disabled onclick="sendStudyText()">分享文字</button></div>'+source+'</div>');
  box.classList.add('share-screen');drawStudyCard()
}
function setCardOption(key,value){studyOptions()[key]=value;sharePart=0;shareFallback=false;save();showStudyShare()}
function setCardSize(key,value){studyOptions()[key]=Number(value);sharePart=0;shareFallback=false;save();drawStudyCard()}
function changeSharePart(delta){sharePart=Math.max(0,Math.min(sharePageCount-1,sharePart+delta));drawStudyCard()}
function verticalGlyph(ch){
  return ({'。':'︒','、':'︑','，':'︐','：':'︓','；':'︔','？':'︖','！':'︕','（':'︵','）':'︶','「':'﹁','」':'﹂','《':'︽','》':'︾','〈':'︿','〉':'﹀','『':'﹃','』':'﹄','【':'︻','】':'︼','…':'︙','—':'︱'})[ch]||ch
}
function cardFace(opts){return typefaces.find(face=>face.id===(opts.face||'song'))||typefaces[0]}
function loadCardFace(opts){
  const face=cardFace(opts);
  return face.family && document.fonts ? document.fonts.load('24px "'+face.family+'"','天地').catch(()=>[]) : Promise.resolve()
}
let pngRevision=0, preparedCard=null, preparingCard=Promise.resolve(null), discardPreview=()=>{};
let preparedCredits=null, preparingCredits=Promise.resolve([]);
function displayCardPreview(view,canvas,plan){
  const strip=canvas.parentElement;
  let frame=0,needsSizing=true;
  function draw(){
    frame=0;
    if(!canvas.isConnected || !box.open)return;
    const width=view.clientWidth, height=view.clientHeight;
    if(!width||!height)return;
    const fit=Math.min(height/plan.height,plan.long?1:width/plan.width);
    const paperWidth=plan.width*fit, paperHeight=plan.height*fit;
    if(needsSizing){
      strip.style.width=paperWidth+'px';strip.style.height=paperHeight+'px';
      view.scrollLeft=0;needsSizing=false;
    }
    const left=Math.max(0,Math.min(paperWidth-width,view.getBoundingClientRect().left-strip.getBoundingClientRect().left));
    const visible=Math.min(width,paperWidth),dpr=Math.min(2,devicePixelRatio||1);
    canvas.style.left=left+'px';canvas.style.width=visible+'px';canvas.style.height=paperHeight+'px';
    renderCardRegion(canvas,plan,left*dpr,0,Math.max(1,Math.ceil(visible*dpr)),Math.max(1,Math.ceil(paperHeight*dpr)),fit*dpr);
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(draw)}
  const observer=new ResizeObserver(()=>{needsSizing=true;schedule()});
  observer.observe(view);view.addEventListener('scroll',schedule,{passive:true});draw();
  return ()=>{observer.disconnect();cancelAnimationFrame(frame);view.removeEventListener('scroll',schedule)}
}
function drawStudyCard(){
  const canvas=document.getElementById('study-share-canvas'),view=document.getElementById('share-paper-window');
  if(!canvas||!shareEntry)return;
  discardPreview();
  const revision=++pngRevision,entry=shareEntry,opts={...studyOptions()},outputs=box.querySelectorAll('[data-png]');
  let plan=studyCardPlan(entry,opts,sharePart,shareFallback);
  const active=()=>revision===pngRevision && canvas.isConnected && box.open;
  preparedCard=null;for(const button of outputs)button.disabled=true;
  function preview(){
    sharePageCount=plan.pageCount;sharePart=plan.part;
    discardPreview();discardPreview=displayCardPreview(view,canvas,plan);
    const paging=document.getElementById('share-paging');
    const reason=opts.layout==='scroll'&&!plan.long?'此摘录已按设备绘图容量分为 '+plan.pageCount+' 张。':'';
    const nav=sharePageCount>1?'<button '+(sharePart===0?'disabled':'')+' onclick="changeSharePart(-1)">上一张</button><span>'+(sharePart+1)+' / '+sharePageCount+'</span><button '+(sharePart===sharePageCount-1?'disabled':'')+' onclick="changeSharePart(1)">下一张</button>':'';
    paging.innerHTML='<small>'+esc(reason)+'</small>'+nav;
  }
  preview();
  preparedCredits=null;
  const textButton=box.querySelector('[data-share-text]');
  textButton.disabled=true;
  preparingCredits=completeCardCredits(entry).then(credits=>{
    if(active()){preparedCredits=credits;textButton.disabled=false}
    return credits
  });
  // Prepare files ahead of the tap so native sharing retains its user activation.
  preparingCard=Promise.all([loadCardFace(opts),preparingCredits]).then(async ([loaded,credits])=>{
    if(!active())return null;
    if(cardFace(opts).family && loaded?.length===0)studyFeedback('字体暂未载入，图卡已用系统字体排版');
    preview();
    const encode=()=>GujiScrollPng.encode(plan,(...args)=>renderCardRegion(args[0],plan,...args.slice(1)),credits,active);
    let blob;
    try{blob=await encode()}catch(error){
      if(!active())return null;
      if(!plan.long)throw error;
      shareFallback=true;plan=studyCardPlan(entry,opts,0,true);preview();blob=await encode()
    }
    if(!active())return null;
    const suffix=plan.long?'长卷':('摘录-'+String(plan.part+1).padStart(String(plan.pageCount).length,'0'));
    preparedCard=new File([blob],books[entry.book][0]+'-'+suffix+'.png',{type:'image/png'});
    for(const button of outputs)button.disabled=false;
    return preparedCard
  }).catch(()=>{
    if(active()){
      const error=document.createElement('div');
      error.textContent=preparedCredits?'此设备未能生成图片。':'版本出处暂未载入。';
      const retry=document.createElement('button');retry.textContent='重试';retry.onclick=drawStudyCard;
      error.append(retry);document.getElementById('share-paging').append(error);
    }
    return null
  });
}
box.addEventListener('close',()=>{if(!box.open){++pngRevision;discardPreview();preparedCard=null;preparingCard=Promise.resolve(null)}});
// Keep an ideograph and its variation selector or combining mark in one cell.
const studySegmenter=typeof Intl.Segmenter==='function' ? new Intl.Segmenter('zh',{granularity:'grapheme'}) : null;
function studyGlyphs(text){
  return studySegmenter ? Array.from(studySegmenter.segment(text),item=>item.segment) :
    text.match(/[^\p{Mark}][\p{Mark}]*|[\p{Mark}]+/gu)||[]
}
function layoutStudyRuns(runs,rows){
  const layout=[[]];
  let halfRow=0;
  for(const run of runs){
    const chars=studyGlyphs(run.text.replace(/\s+/gu,'　'));
    let from=0;
    while(from<chars.length){
      const free=rows*2-halfRow;
      let count=Math.min(chars.length-from,run.note?free*2:Math.floor(free/2));
      if(!count){layout.push([]);halfRow=0;continue}
      const wraps=from+count<chars.length;
      if(wraps && count>1 && !run.note && (chars.length-from-count===1 || /^[，。、：；！？〉》」』】）]/u.test(chars[from+count])))count--;
      layout.at(-1).push({chars:chars.slice(from,from+count),halfRow,note:run.note});
      halfRow+=run.note?Math.ceil(count/2):count*2;
      from+=count;
      if(wraps){layout.push([]);halfRow=0}
    }
  }
  return layout
}
function cardGrant(meta){return meta?.attribution || meta?.exports}
function cardCreditUrl(meta){
  if(!/^s\/[\da-z-]+\.html$/.test(meta?.creditPage||''))return '';
  // Keep attribution local to the current deployment, without exposing a local file path.
  const url=new URL(meta.creditPage,document.baseURI);
  return ['http:','https:'].includes(url.protocol)?url.href:meta.creditPage;
}
function cardCredits(entry){
  const meta=catalogue[entry.book],grant=cardGrant(meta);
  if(!grant)return [];
  const urls=[...new Set((meta.sources||[]).map(s=>s.url).filter(Boolean))];
  return [meta.title+' · '+meta.edition,grant.credit,grant.method,grant.licence+' · '+grant.licenceUrl,...urls,cardCreditUrl(meta)].filter(Boolean)
}
// Keep the complete source notices inside standalone files, including original TEI headers.
const creditAttachments=new Map();
async function completeCardCredits(entry){
  const meta=catalogue[entry.book],credits=cardCredits(entry);
  if(!cardCreditUrl(meta))return credits;
  const key=meta.creditPage+'@'+meta.creditSha256;
  if(!creditAttachments.has(key)){
    const attachment=(async()=>{
      const response=await fetch(meta.creditPage,{cache:'no-cache'});
      if(!response.ok)throw Error('版本出处暂不可用');
      const bytes=await response.arrayBuffer();
      if(crypto.subtle){
        const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
        const hex=Array.from(digest,v=>v.toString(16).padStart(2,'0')).join('');
        if(hex!==meta.creditSha256)throw Error('版本出处与书目不符');
      }
      const doc=new DOMParser().parseFromString(new TextDecoder('utf-8',{fatal:true}).decode(bytes),'text/html');
      const links=Array.from(doc.querySelectorAll('main ol a'),a=>a.getAttribute('href'));
      const appendices=Array.from(doc.querySelectorAll('main details pre'),pre=>pre.textContent);
      if(!links.length || (meta.sourceNoticeSha256 && !appendices.some(p=>p.includes('<teiHeader>'))))throw Error('版本出处不完整');
      return [...links,...appendices];
    })().catch(error=>{creditAttachments.delete(key);throw error});
    creditAttachments.set(key,attachment);
  }
  return [...new Set([...credits,...await creditAttachments.get(key)])];
}
function cardMarginalia(meta){
  const grant=cardGrant(meta);
  if(!grant)return [];
  const url=cardCreditUrl(meta);
  const museum=grant.credit.includes('國立故宮博物院');
  const shortCredit=museum?grant.credit:grant.credit.includes('CBETA')?'CBETA · '+grant.licence:grant.licence;
  return [shortCredit,(url||grant.licenceUrl).replace(/^https?:\/\//,'')];
}
function studyCardPlan(entry,opts,requestedPart,forcePages=false){
  const meta=catalogue[entry.book],height=opts.height,font=opts.font;
  const pad=18,top=pad+9,bottom=height-top,step=font*1.21;
  const rows=Math.max(1,Math.floor((bottom-top)/step));
  const runs=entry.runs?.length?[...entry.runs]:[{text:entry.quote||'',note:false}];
  if(entry.text)runs.push({note:false,text:(entry.quote?'　':'')+entry.text});
  const layout=layoutStudyRuns(runs,rows);
  const name=typeof coverByline==='function'?coverByline(meta):meta.byline;
  const label=[opts.book&&meta.title,opts.author&&name,opts.imprint&&'子衿古籍'].filter(Boolean).join(' · ');
  const heading=opts.chapter?entry.chapterTitle:'';
  const headingWidth=heading?Math.min(42,font*1.4):0,dateWidth=opts.date?25:0;
  const credits=cardMarginalia(meta);
  const stampWidth=label||opts.seal?27:0,creditWidth=credits.length?25:0;
  const fixed=2*pad+dateWidth+headingWidth+stampWidth+creditWidth;
  const naturalCol=Math.ceil(font*1.48),naturalWidth=fixed+naturalCol*layout.length;
  const long=opts.layout==='scroll' && !forcePages && GujiScrollPng.outputSize(naturalWidth,height).scale>=1;
  const width=long?Math.max(165,naturalWidth):(opts.narrow?225:330);
  const available=width-fixed;
  const cols=long?layout.length:Math.max(1,Math.floor(available/naturalCol));
  const colWidth=available/cols,pageCount=Math.ceil(layout.length/cols);
  const part=Math.max(0,Math.min(requestedPart||0,pageCount-1));
  const date=new Date(entry.created??Date.now());
  const dateText=new Intl.DateTimeFormat('zh-CN-u-nu-hanidec',{year:'numeric',month:'long',day:'numeric'}).format(date);
  return {width,height,long,layout,cols,colWidth,part,pageCount,font,step,pad,top,bottom,opts,heading,headingWidth,dateText,dateWidth,label,stampWidth,credits,creditWidth,face:cardFace(opts).stack,colors:cardThemes[opts.theme]||cardThemes[0]}
}
// Preview, thumbnails, ordinary PNGs and banded PNGs all use this one layout.
function renderCardRegion(canvas,plan,px,py,pixelWidth,pixelHeight,scale){
  const {width,height,opts,pad,top,bottom,font,step,face,colors,heading,headingWidth,dateWidth,stampWidth,creditWidth,colWidth,cols}=plan;
  if(canvas.width!==pixelWidth)canvas.width=pixelWidth;
  if(canvas.height!==pixelHeight)canvas.height=pixelHeight;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('无法分配画布');
  ctx.setTransform(scale,0,0,scale,-px,-py);
  const left=px/scale,rightEdge=(px+pixelWidth)/scale,bandTop=py/scale,bandBottom=(py+pixelHeight)/scale;
  ctx.fillStyle=colors.paper;ctx.fillRect(left-1,bandTop-1,pixelWidth/scale+2,pixelHeight/scale+2);
  ctx.strokeStyle=colors.rule;ctx.lineWidth=1.8;
  if(!opts.frame||opts.frame==='double')ctx.strokeRect(pad-4,pad-4,width-2*pad+8,height-2*pad+8);
  ctx.lineWidth=.8;
  if(opts.frame!=='none')ctx.strokeRect(pad,pad,width-2*pad,height-2*pad);
  function rule(x){
    if(!opts.rules || x<left-1 || x>rightEdge+1)return;
    ctx.beginPath();ctx.moveTo(x,pad);ctx.lineTo(x,height-pad);ctx.stroke()
  }
  function vertical(chars,x,y,size,gap=size*1.16){
    if(x+size<left || x-size>rightEdge || !chars.length)return;
    ctx.font=size+'px '+face;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=colors.ink;
    const from=Math.max(0,Math.floor((bandTop-y-size)/gap));
    const end=Math.min(chars.length,Math.ceil((bandBottom-y+size)/gap));
    for(let i=from;i<end;i++)ctx.fillText(verticalGlyph(chars[i]),x,y+(i+.5)*gap);
  }
  let right=width-pad;
  if(opts.date){
    const chars=studyGlyphs(plan.dateText);
    vertical(chars,right-dateWidth/2,top,Math.min(13,(bottom-top)/(chars.length*1.16)));
    right-=dateWidth;rule(right)
  }
  if(heading){
    const chars=studyGlyphs(heading);
    vertical(chars,right-headingWidth/2,top,Math.min(font,(bottom-top)/(1.16*chars.length)));
    right-=headingWidth;rule(right)
  }
  const first=Math.max(0,Math.floor((right-rightEdge-1)/colWidth));
  const stop=Math.min(cols,Math.ceil((right-left+1)/colWidth));
  for(let col=first;col<stop;col++){
    const x=right-(col+.5)*colWidth;
    for(const run of plan.layout[plan.part*cols+col]||[]){
      const y=top+run.halfRow*step/2;
      if(run.note){
        const split=Math.ceil(run.chars.length/2);
        vertical(run.chars.slice(0,split),x+colWidth*.2,y,font*.5,step*.5);
        vertical(run.chars.slice(split),x-colWidth*.2,y,font*.5,step*.5)
      }else vertical(run.chars,x,y,font,step)
    }
    if(col<cols-1||stampWidth||creditWidth)rule(right-(col+1)*colWidth)
  }
  const stampX=pad+creditWidth+stampWidth/2;
  if(plan.label){
    const chars=studyGlyphs(plan.label);
    vertical(chars,stampX,top,Math.min(14,(bottom-top-(opts.seal?35:0))/(chars.length*1.16)))
  }
  if(opts.seal && stampX+10>=left && stampX-10<=rightEdge){
    const y=bottom-29;
    ctx.fillStyle='#a73832';ctx.fillRect(stampX-8,y,16,30);
    ctx.fillStyle='#fff2d9';ctx.font='12px '+face;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('读',stampX,y+8);ctx.fillText('记',stampX,y+21)
  }
  if(plan.credits.length && pad+creditWidth>=left){
    if(stampWidth)rule(pad+creditWidth);
    ctx.fillStyle=colors.ink;ctx.textAlign='left';ctx.textBaseline='middle';
    for(const [i,line] of plan.credits.entries()){
      ctx.save();ctx.translate(pad+creditWidth-6-i*11,top);ctx.rotate(Math.PI/2);
      ctx.font='10px system-ui,sans-serif';ctx.fillText(line,0,0,bottom-top);ctx.restore();
    }
  }
  return ctx
}
function paintStudyCard(canvas,entry,opts,part){
  const plan=studyCardPlan(entry,opts,part,true);
  renderCardRegion(canvas,plan,0,0,plan.width*2,plan.height*2,2);
  return plan.pageCount
}
function studyCardFile(){return document.getElementById('study-share-canvas') ? preparingCard : Promise.resolve(null)}
function downloadStudyFile(file){
  const url=URL.createObjectURL(file),a=document.createElement('a');
  a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000)
}
function saveStudyCard(){if(preparedCard)downloadStudyFile(preparedCard)}
async function sendStudyCard(){
  const f=preparedCard;if(!f)return;
  if(navigator.canShare?.({files:[f]})){
    try{await navigator.share({files:[f],title:books[shareEntry.book][0]});return}
    catch(e){if(e.name==='AbortError')return}
  }
  downloadStudyFile(f);studyFeedback('已下载图卡，可用图片分享')
}
async function sendStudyText(){
  const entry=shareEntry;
  let credits=preparedCredits;
  if(!credits){try{credits=await preparingCredits}catch{studyFeedback('请重新载入版本出处');return}}
  const text=[noteExcerpt(entry),'——《'+books[entry.book][0]+'》',...credits].join('\n');
  if(navigator.share){try{await navigator.share({text});return}catch(e){if(e.name==='AbortError')return}}
  await studyCopy(text)
}
