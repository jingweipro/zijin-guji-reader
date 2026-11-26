// Display cells keep source UTF-16 offsets even when the converted glyph has a different width.
function readerBlockCells(source, base=0) {
  const split=text=>/[\p{Mark}\u200d\p{Emoji_Modifier}]/u.test(text) ? studyGlyphs(text) : Array.from(text);
  const original=split(source), converted=split(convertReader(source));
  const glyphs=[], raw=[], starts=[];
  let offset=base;
  for(let i=0;i<original.length;i++){
    const glyph=original[i];
    if(!/^\s/u.test(glyph) && (settings.punctuation || !/^\p{P}/u.test(glyph))){
      // The current transliteration tables are one code point to one code point.
      // A future expanding rule must not silently shift any subsequent anchor.
      const shown=converted.length===original.length?converted[i]:glyph;
      glyphs.push(shown===glyph || Array.from(shown).length===Array.from(glyph).length?shown:glyph);
      raw.push(glyph);starts.push(offset);
    }
    offset+=glyph.length;
  }
  return {glyphs,raw,starts};
}

let pointSelection=null;

function pointSession(){
  return pointSelection && pointSelection.room===document.querySelector('.reading-room') &&
    pointSelection.bookId===bookId(book) && pointSelection.hash===catalogue[book]?.contentSha256 ? pointSelection : null;
}
function beginPointSelection(){
  closeSheet();clearStudyMenu();getSelection()?.removeAllRanges();
  const room=document.querySelector('.reading-room');
  pointSelection={room,bookId:bookId(book),hash:catalogue[book].contentSha256,first:null,last:null,editing:'first'};
  room.classList.add('picking-text');chromeOn=false;syncReaderChrome();
  const bar=document.createElement('section');bar.className='point-controls';bar.setAttribute('aria-label','两点选文');
  room.append(bar);
  const session=pointSelection;
  const scroller=room.querySelector('#scrollBook');
  scroller.onpointerdown=e=>{session.down={x:e.clientX,y:e.clientY};session.dragged=false};
  scroller.onpointermove=e=>{
    if(session.down && Math.hypot(e.clientX-session.down.x,e.clientY-session.down.y)>8)session.dragged=true;
  };
  scroller.onpointerup=()=>{session.down=null};
  scroller.onpointercancel=()=>{session.dragged=true;session.down=null};
  refreshPointControls();
}
function endPointSelection(){
  const room=pointSelection?.room;
  pointSelection=null;
  const scroll=room?.querySelector('#scrollBook');
  if(scroll)scroll.onpointerdown=scroll.onpointermove=scroll.onpointerup=scroll.onpointercancel=null;
  room?.classList.remove('picking-text');
  room?.querySelector('.point-controls')?.remove();
  if(room?.isConnected) paintPointSelection();
}
function refreshPointControls(){
  const s=pointSession();if(!s)return;
  const bar=s.room.querySelector('.point-controls');
  const completed=s.first && s.last && !s.editing;
  const prompt=completed?'已选「'+s.first.glyph+'」至「'+s.last.glyph+'」':s.editing==='first'?'点选首字':'已选「'+s.first.glyph+'」 · 点选末字';
  bar.innerHTML='<div class="point-summary"><span role="status"></span><div class="point-commands"></div></div>';
  bar.querySelector('[role=status]').textContent=prompt;
  const commands=bar.querySelector('.point-commands');
  function button(label,action,parent=commands){
    const b=document.createElement('button');b.textContent=label;b.type='button';b.onclick=action;parent.append(b)
  }
  if(s.first && s.editing!=='first')button('改首字',()=>{s.editing='first';refreshPointControls()});
  if(s.last && s.editing!=='last')button('改末字',()=>{s.editing='last';refreshPointControls()});
  if(!completed)button('目录',()=>showToc());
  button('退出',endPointSelection);
  if(completed){
    const actions=document.createElement('div');actions.className='point-actions';actions.setAttribute('aria-label','选文操作');
    for(const [label,action] of studySelectionActions())button(label,()=>{
      // Re-evaluate against the current font/script/annotation visibility, never old DOM.
      const selected=makePointPassage(s);
      if(!selected){studyFeedback('原文位置已变动，请重新选文。');return}
      studyPassage=selected;endPointSelection();action();
    },actions);
    bar.append(actions);
  }
}

function textRangeForInk(host, start, end) {
  const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);
  const range=document.createRange();let pos=0,hasStart=false;
  for(let node=walker.nextNode();node;node=walker.nextNode()){
    const next=pos+node.length;
    if(!hasStart && start<next){range.setStart(node,start-pos);hasStart=true}
    if(hasStart && end<=next){range.setEnd(node,end-pos);return range}
    pos=next;
  }
  return null;
}

// Inspect measured text ranges inside the tapped half-column. A gap, heading or border is not a glyph.
function hitPointGlyph(target,x,y) {
  const host=target.closest?.('.ink-run[data-offsets]');
  if(!host || !pointSession()?.room.contains(host))return null;
  const ci=Number(host.dataset.chapter),chapter=chapterList[ci];
  if(!chapter)return null;
  const offsets=JSON.parse(host.dataset.offsets),text=host.textContent,raw=studyChapterText(ci);
  if(Array.from(text).length!==offsets.length)return null;
  let pos=0,index=0;
  for(const glyph of studyGlyphs(text)){
    const end=pos+glyph.length,count=Array.from(glyph).length;
    const range=textRangeForInk(host,pos,end);
    if(range){
      const r=range.getBoundingClientRect();
      if(x>=r.left && x<r.right && y>=r.top && y<r.bottom){
        const start=offsets[index], last=offsets[index+count-1], cp=raw.codePointAt(last);
        if(!Number.isInteger(cp))return null;
        return {chapterId:chapter.id,start,end:last+(cp>0xffff?2:1),glyph};
      }
    }
    pos=end;index+=count;
  }
  return null;
}
function readPointTap(event) {
  const s=pointSession();
  if(!s)return false;
  if(s.dragged){s.dragged=false;return true}
  const point=hitPointGlyph(event.target,event.clientX,event.clientY);
  if(!point){studyFeedback('请点在正文或小字夹注的一个字上。');return true}
  if(!s.editing){studyFeedback('可点「改首字」或「改末字」调整选文。');return true}
  s[s.editing]=point;
  if(s.first && s.last){
    const a=chapterList.findIndex(c=>c.id===s.first.chapterId),b=chapterList.findIndex(c=>c.id===s.last.chapterId);
    if(a>b || (a===b && s.first.start>s.last.start))[s.first,s.last]=[s.last,s.first];
    s.editing=null;
  }else s.editing='last';
  refreshPointControls();paintPointSelection();return true;
}
function makePointPassage(s){
  if(!pointSession() || !s.first || !s.last)return null;
  const chapter=chapterList.findIndex(c=>c.id===s.first.chapterId), endChapter=chapterList.findIndex(c=>c.id===s.last.chapterId);
  if(chapter<0 || endChapter<chapter)return null;
  if(![s.first,s.last].every((p,i)=>{
    const raw=studyChapterText(i?endChapter:chapter);
    return Number.isInteger(p.start) && p.start>=0 && p.end>p.start && p.end<=raw.length
  }))return null;
  const runs=[];
  for(let i=chapter;i<=endChapter;i++){
    const from=i===chapter?s.first.start:0,to=i===endChapter?s.last.end:Infinity;
    let offset=0;
    for(const block of chapterList[i].blocks){
      const note=block.note!==undefined,raw=block.note??block.main??'',base=offset;offset+=raw.length;
      if(offset<=from || base>=to || (note&&!settings.annotations))continue;
      const {glyphs,starts}=readerBlockCells(raw,base);
      const text=glyphs.filter((_,n)=>starts[n]>=from && starts[n]<to).join('');
      if(!text)continue;
      if(runs.length && runs.at(-1).note===note)runs.at(-1).text+=text;
      else runs.push({text,note});
    }
  }
  const quote=runs.map(run=>run.text).join('');
  if(!quote)return null;
  return {book,chapter,endChapter,offset:s.first.start,end:s.last.end,chapterTitle:chapterList[chapter].title,exact:true,quote,runs};
}
function paintPointSelection(){
  const ink=document.getElementById('colStrip');if(!ink)return;
  for(const m of ink.querySelectorAll('.point-ink')){
    if(m.classList.contains('ink-run')){m.classList.remove('point-ink');continue}
    const parent=m.parentNode;m.replaceWith(...m.childNodes);parent.normalize();
  }
  const s=pointSession();if(!s?.first)return;
  const first=s.first,last=s.last??first;
  const a=chapterList.findIndex(c=>c.id===first.chapterId),b=chapterList.findIndex(c=>c.id===last.chapterId);
  for(const el of ink.querySelectorAll('.ink-run')){
    const c=Number(el.dataset.chapter);
    if(c<a || c>b)continue;
    const lo=c===a?first.start:0,hi=c===b?last.end:Infinity;
    const start=Number(el.dataset.offset),end=Number(el.dataset.end);
    if(start>=hi || end<=lo)continue;
    if(lo<=start && end<=hi){el.classList.add('point-ink');continue}
    const positions=JSON.parse(el.dataset.offsets), chars=Array.from(el.textContent);
    let from=null,to=0,pos=0;
    positions.forEach((off,i)=>{
      if(off>=lo && off<hi){from??=pos;to=pos+chars[i].length}
      pos+=chars[i].length;
    });
    if(from===null)continue;
    // Wrap text nodes separately so an existing permanent underline keeps its exact boundaries.
    const nodes=[], walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode();node;node=walker.nextNode())nodes.push(node);
    let at=0;
    for(const node of nodes){
      const stop=at+node.length;
      if(from<stop && to>at){
        const r=document.createRange();r.setStart(node,Math.max(0,from-at));r.setEnd(node,Math.min(node.length,to-at));
        const mark=document.createElement('span');mark.className='point-ink';r.surroundContents(mark);
      }
      at=stop;
    }
  }
}
