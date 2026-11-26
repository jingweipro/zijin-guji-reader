const key=GujiStorage.keys.current;
const initialShelf=catalogue.slice(0,3).map(b=>bookIndex(b.id));
const readerStore=GujiStorage.open({
 // Some privacy modes throw from the localStorage getter itself.
 storage:{
  getItem:name=>window.localStorage.getItem(name),
  setItem:(name,value)=>window.localStorage.setItem(name,value),
  removeItem:name=>window.localStorage.removeItem(name)
 },
 catalog:catalogue,bookId,bookIndex,chapters:i=>libraryCache.get(i),
 defaults:{shelf:initialShelf,notes:[],progress:{},font:20,night:false}
});
let state=readerStore.read();
function storageAlert(message){
 let alert=document.getElementById('storage-alert');
 if(!alert){
  alert=document.createElement('aside');alert.id='storage-alert';alert.setAttribute('role','alert');
  const label=document.createElement('span'),button=document.createElement('button');
  button.textContent='备份与恢复';button.onclick=storagePanel;
  alert.append(label,button);document.body.append(alert)
 }
 alert.firstChild.textContent=message
}
function save(){
 try{readerStore.save(state);return true}
 catch(error){storageAlert('当前改动未保存。'+error.message);return false}
}
const tabs=['书架','笔记','书库','设置'];
const icons=['M2 5Q7 2 11.5 5V21Q7 18 2 20ZM13 5Q18 2 23 5V20Q18 18 13 21Z','M4 4L15 2L16 4L7 6L7 20L4 20ZM9 7L21 5V22H9Z','M6 3H18V5H6ZM4 6H20V8H4ZM3 9H21V22H3Z','M12 1Q13 11 23 12Q13 13 12 23Q11 13 1 12Q11 11 12 1Z'];
let tab=0,filter='所有',book=null;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Attribute escaping alone does not make untrusted URL schemes safe.
function safeExternalUrl(value){
 if(typeof value!=='string'||!/^https?:\/\//i.test(value))return '';
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:''}catch{return ''}
}
let chapterList=[],activeChapter=0,columnWidth=0,readerColumns=[];
let placedAnchor=null;
let windowStart=0,windowEnd=0,chromeOn=false,scrollTimer,layoutTimer,loadToken=0;
const directions=['原字','繁体','简体'];
const scriptModes=['original','traditional','simplified'];
// Array order is part of V1 reader backups. New faces are appended.
const typefaces=[
 {id:'song',name:'宋体',stack:'"Songti SC","STSong","Noto Serif CJK SC",serif'},
 {id:'fang',name:'朱雀仿宋',stack:'"Zhuque Fangsong","Songti SC",serif',family:'Zhuque Fangsong',notice:'fonts/Zhuque-OFL.txt'},
 {id:'ming',name:'明朝',stack:'"Songti TC","PMingLiU","Yu Mincho",serif'},
 {id:'kai',name:'楷体',stack:'"Kaiti SC","STKaiti","KaiTi",cursive'},
 {id:'hei',name:'黑体',stack:'"PingFang SC","Microsoft YaHei",sans-serif'},
 {id:'wenkai',name:'霞鹜文楷 TC',stack:'"Zijin WenKai TC","Kaiti TC","Kaiti SC","Songti SC",serif',family:'Zijin WenKai TC',notice:'fonts/WenKaiTC-OFL.txt'},
 {id:'cnskai',name:'全字库正楷体',stack:'"Zijin CNS Kai","Kaiti TC","Kaiti SC","Songti SC",serif',family:'Zijin CNS Kai',notice:'fonts/CNS-Kai-OFL.txt'}
];
function fontCredits(){
 const names=typefaces.filter(face=>face.notice).map(face=>'<p><a href="'+face.notice+'" target="_blank" rel="noopener">'+esc(face.name)+' · SIL OFL 1.1</a></p>').join('');
 openSheet('字体与版权','<div class="font-credits">'+names+'<p>霞鹜文楷 TC 源自 LXGW WenKai 项目，全字库正楷体源自數位發展部 CNS11643 中文標準交換碼全字庫。两款楷书在本机按需载入常用字子集，缺字沿用系统字体。</p><button onclick="fontSheet()">返回字体</button></div>')
}
const palettes=[
 ['墨白本色','#fcfcfa','#191919','#767674'],['宣白朱栏','#f8f5ed','#27221c','#ac534b'],
 ['藏经褐笺','#efe2ce','#49392e','#9c8068'],['青涧古卷','#e7edef','#293e45','#71898e'],
 ['竹影青笺','#edf0df','#39402c','#889178'],['乌檀金楷','#211d19','#d5bc8a','#88734e']
];
const settings=Object.assign({size:28,face:0,annotations:true,punctuation:true,script:'simplified',theme:0,frame:true,rules:true,double:false,light:100,mode:'day'},state.typography);
function convertReader(text){return convertScript(text,settings.script)}
function closeSheet(){if(box.open)box.close()}
function openSheet(title,html){
 delete box.dataset.loading;closeSheet();box.className='reader-sheet';
 box.innerHTML='<header class="sheet-head"><strong>'+esc(title)+'</strong><button aria-label="关闭" onclick="closeSheet()">×</button></header><div class="sheet-body">'+html+'</div>';
 box.showModal()
}
function modal(title,html){openSheet(title,html)}
box.addEventListener('click',e=>{if(e.target===box){const r=box.getBoundingClientRect();if(e.clientY<r.top||e.clientY>r.bottom||e.clientX<r.left||e.clientX>r.right)closeSheet()}})
function oldLocation(id,offset){
 let rest=Math.max(0,offset||0);
 if(!rest)return {chapter:0,offset:0};
 for(const [i,chapter] of getChapters(id).entries()){
  const length=chapter.blocks.reduce((n,b)=>n+(b.main||'').length,0);
  if(rest<=length){
   let anchor=0;for(const b of chapter.blocks){if(b.main&&rest<=b.main.length)return {chapter:i,offset:anchor+rest};rest-=(b.main||'').length;anchor+=(b.main||b.note||'').length}
   return {chapter:i,offset:0}
  }
  rest-=length
 }
 return {chapter:0,offset:0}
}
async function loadForReading(id,open){
 const token=++loadToken;
 openSheet('正在打开《'+books[id][0]+'》','<p role="status">正在排入正文…</p>');
 try{
  await ensureBookText(id);
  if(token===loadToken&&box.open&&box.dataset.loading===String(token))open()
 }catch{
  if(token===loadToken&&box.open&&box.dataset.loading===String(token)){
   openSheet('暂时无法打开','<p>正文文件未能加载。</p><button id="retry-book">重试</button>');
   document.getElementById('retry-book').onclick=()=>{
    loadForReading(id,open);box.dataset.loading=loadToken;
   }
  }
 }
}
function restartProgress(id){
 delete state.places[id];goLocation(id,{chapter:0,offset:0})
}
function readBook(id,oldPage,offset){
 if(needsText(id)){const task=loadForReading(id,()=>readBook(id,oldPage,offset));box.dataset.loading=loadToken;return task}
 readerStore.resolveBook(state,id);
 if(state.places?.[id]?.needsReview && offset===undefined){
  openSheet('旧进度待核对','<p>'+esc(state.places[id].needsReview)+'</p><button onclick="restartProgress('+id+')">从篇首重新记录进度</button>');return
 }
 const loc=offset!==undefined?oldLocation(id,offset):state.places?.[id]||oldLocation(id,state.anchors?.[id]||0);
 goLocation(id,loc)
}
const glyphs={toc:'<path d="M4 3v18M8 4h8v16H8zM20 3v18"/>',study:'<path d="m4 16 11-12a2 2 0 0 1 4 4L8 19l-5 1zM13 6l4 4M4 22h17"/>',style:'<circle cx="12" cy="12" r="9"/><path fill="currentColor" d="M12 3c-6 5 2 8 4 10 2 3 1 5 0 7 9-5 6-16-4-17z"/>',mark:'<path d="M6 3h12v18l-6-5-6 5z"/>',close:'<path d="m5 5 14 14M19 5 5 19"/>'};
function toolIcon(id){return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7">'+glyphs[id]+'</svg>'}
function goLocation(id,loc){
 if(needsText(id)){const task=loadForReading(id,()=>goLocation(id,loc));box.dataset.loading=loadToken;return task}
 closeSheet();clearTimeout(scrollTimer);clearTimeout(layoutTimer);
 readerStore.resolveBook(state,id);
 const entering=book!==id||!document.getElementById('scrollBook');book=id;chapterList=getChapters(id);
 if(entering){
  endPointSelection();
  if(state.typography?.script===undefined)settings.script=catalogue[id].layout==='heshanggong'?'traditional':'simplified';
  if(state.typography?.punctuation===undefined)settings.punctuation=catalogue[id].layout!=='heshanggong';
  if(state.typography?.size===undefined)settings.size=catalogue[id].layout==='heshanggong'?34:28;
  if(state.typography?.double===undefined)settings.double=catalogue[id].layout==='heshanggong';
  if(state.typography?.face===undefined)settings.face=catalogue[id].layout==='heshanggong'?0:1;
  document.title=books[id][0]+' · 子衿古籍';
  document.body.classList.add('reading');chromeOn=false;
  app.innerHTML='<section class="reading-room"><div class="book-frame"><div id="scrollBook" tabindex="0" aria-label="古籍竖排正文，左右滑动或使用方向键"><div id="colStrip"></div></div></div><div class="reader-tools"><button class="corner mark" title="添加书签" aria-label="添加书签" onclick="toggleBookmark();refreshMark()">'+toolIcon('mark')+'</button><button class="corner leave" aria-label="返回" onclick="exitReader()">'+toolIcon('close')+'</button><button class="point-entry" onclick="beginPointSelection()" title="两点选文">选文</button><div class="tool-dock"><button title="目录" aria-label="目录" onclick="showToc()">'+toolIcon('toc')+'</button><button title="书签与划线笔记" aria-label="书签与划线笔记" onclick="renderStudySheet()">'+toolIcon('study')+'</button><button title="样式" aria-label="样式" onclick="styleSheet()">'+toolIcon('style')+'</button><button title="字体" aria-label="字体" onclick="fontSheet()">字</button></div></div></section>';
  scrollBook.addEventListener('scroll',onBookScroll,{passive:true});scrollBook.addEventListener('wheel',onWheel,{passive:false});
  scrollBook.addEventListener('click',readerTap);scrollBook.addEventListener('pointerup',()=>setTimeout(selectionMenu,40));
 }
 activeChapter=Math.min(chapterList.length-1,Math.max(0,loc?.chapter||0));drawBook(activeChapter,loc?.offset||0);syncReaderChrome();savePlace()
}
function exitReader(){endPointSelection();closeSheet();savePlace();clearTimeout(scrollTimer);go(tab);if(location.hash.startsWith('#read/'))history.replaceState(null,'',location.pathname+location.search)}
function readerLocation(){
 const index=visibleColumn(),column=readerColumns[index];
 if(!column)return {chapter:activeChapter,offset:0};
 if(placedAnchor?.index===index)return {chapter:column.chapter,offset:placedAnchor.offset};
 return {chapter:column.chapter,offset:column.offset}
}
function visibleColumn(){return Math.max(0,Math.min(readerColumns.length-1,Math.floor((Math.abs(document.getElementById('scrollBook')?.scrollLeft||0)+1)/columnWidth)))||0}
function savePlace(){if(book===null||!readerColumns.length||state.places?.[book]?.needsReview)return;state.places??={};state.places[book]=readerLocation();save()}
function syncReaderChrome(){app.querySelector('.reading-room')?.classList.toggle('tools-on',chromeOn);refreshMark()}
function refreshMark(){const el=app.querySelector('.mark');if(el){const on=isStudyBookmarked();el.classList.toggle('selected',on);el.setAttribute('aria-label',on?'移除书签':'添加书签')}}
let lastSelection=0;
function selectionMenu(){
 if(pointSession())return;
 const sel=getSelection();if(!sel||sel.isCollapsed||!sel.rangeCount||!document.getElementById('scrollBook')?.contains(sel.anchorNode))return;
 lastSelection=Date.now();openSelectionMenu(sel.toString(),sel.getRangeAt(0).getBoundingClientRect())
}
document.addEventListener('selectionchange',()=>{if(book===null||box.open)return;clearTimeout(selectionMenu.timer);selectionMenu.timer=setTimeout(selectionMenu,300)});
function readerTap(e){if(readPointTap(e))return;if(!getSelection().isCollapsed||Date.now()-lastSelection<450)return;chromeOn=!chromeOn;syncReaderChrome()}
function onWheel(e){if(Math.abs(e.deltaY)>Math.abs(e.deltaX)&&!e.ctrlKey){e.preventDefault();scrollBook.scrollLeft-=e.deltaY}}
function onBookScroll(){
 clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{
  if(book===null||!document.getElementById('scrollBook'))return;
  const pos=readerLocation();activeChapter=pos.chapter;savePlace();refreshMark();
  const distance=Math.abs(scrollBook.scrollLeft),remaining=scrollBook.scrollWidth-scrollBook.clientWidth-distance;
  if((remaining<columnWidth*2&&windowEnd<chapterList.length-1)||(distance<1&&windowStart>0)){
   const extra=remaining<columnWidth*2&&windowEnd<chapterList.length-1?1:-1;
   const index=visibleColumn();
   const relative=index-readerColumns.findIndex(c=>c.chapter===pos.chapter);
   const fraction=distance/columnWidth-index;
   // Keep the visible columns stationary while replacing off-screen chapters.
   drawBook(pos.chapter,pos.offset,{
    start:extra<0?Math.max(0,windowStart-1):Math.max(windowStart,pos.chapter-1),
    end:extra>0?windowEnd+1:Math.min(windowEnd,pos.chapter+2),
    relative,fraction
   })
  }
 },100)
}
function applyPaper(){
 const room=app.querySelector('.reading-room');const dark=settings.mode==='night'||(settings.mode==='auto'&&matchMedia('(prefers-color-scheme:dark)').matches);
 const pal=palettes[dark?5:settings.theme];
 for(const [name,val] of Object.entries({paper:pal[1],ink:pal[2],rule:pal[3],face:typefaces[settings.face].stack}))room.style.setProperty('--'+name,val);
 room.classList.toggle('no-frame',!settings.frame);room.classList.toggle('double-frame',settings.double);room.classList.toggle('no-rules',!settings.rules);room.style.filter='brightness('+settings.light+'%)'
}
// A font's vertical advance may exceed one em even when its ideographs are square.
function calibrateType(){
 const strip=document.getElementById('scrollBook');
 if(!strip)return;
 const probe=document.createElement('span');
 probe.className='type-probe';probe.textContent='天地玄黃';
 strip.append(probe);
 for(const [font,step,tracking] of [['--type','--step','--main-tracking'],['--little','--short','--note-tracking']]){
  probe.style.fontSize=strip.style.getPropertyValue(font);
  const advance=probe.getBoundingClientRect().height/4;
  strip.style.setProperty(tracking,(parseFloat(strip.style.getPropertyValue(step))-advance)+'px');
 }
 probe.remove()
}
document.fonts?.addEventListener('loadingdone',calibrateType);
function drawBook(chapter,offset,range){
 applyPaper();const size=settings.size;
 const advance=Math.ceil(size*(catalogue[book].layout==='heshanggong'?1.28:1.36)),smallAdvance=Math.max(10,Math.round(advance*.49));
 const height=Math.max(advance*2,scrollBook.clientHeight-8), view=scrollBook.clientWidth;
 columnWidth=Math.min(view/3,size*1.75);
 const visible=Math.ceil(view/columnWidth);
 scrollBook.style.setProperty('--col',columnWidth+'px');scrollBook.style.setProperty('--type',size+'px');scrollBook.style.setProperty('--step',advance+'px');
 scrollBook.style.setProperty('--little',Math.max(9,Math.round(size*.51))+'px');scrollBook.style.setProperty('--short',smallAdvance+'px');
 calibrateType();
 windowStart=range?.start??Math.max(0,chapter-1);windowEnd=range?.end??Math.min(chapterList.length-1,chapter+1);
 readerColumns=[];
 for(let ci=windowStart;ci<=windowEnd;ci++){
  const source=chapterList[ci];let col,used,rawOffset=0;
  function newCol(start){col={chapter:ci,offset:start,html:[]};readerColumns.push(col);used=0}
  function heading(text,indent,own=true){
   let pad=Math.min(indent*advance,height*.22);
   const chars=Array.from(convertReader(text));
   for(let i=0;i<chars.length;){
    newCol(0);const count=Math.max(1,Math.floor((height-pad)/advance)),part=chars.slice(i,i+count);
    col.html.push('<div class="heading-run" style="margin-top:'+pad+'px">'+esc(part.join(''))+'</div>');
    used=pad+part.length*advance;i+=part.length;pad=0
   }
   if(own)used=height
  }
  if(catalogue[book].layout==='heshanggong'&&(ci===0||ci===37))heading(source.part,1);
  if(catalogue[book].layout==='heshanggong'&&[0,16,37,59].includes(ci))heading('河上公章句第'+['一','二','三','四'][[0,16,37,59].indexOf(ci)],2);
  heading(source.title,catalogue[book].layout==='heshanggong'?3:1,source.blocks[0]?.note===undefined);
  for(const block of source.blocks){
   const small=block.note!==undefined;const raw=block.note??block.main??'';const start=rawOffset;rawOffset+=raw.length;
   if(small&&!settings.annotations)continue;
   const step=small?smallAdvance:advance;
   const {glyphs:chars,raw:original,starts:offsets}=readerBlockCells(raw,start);
   const styleRun=(a,b)=>{
    const positions=[];
    for(let n=a;n<b;n++){
     let at=offsets[n];for(const cp of original[n]){positions.push(at);at+=cp.length}
    }
    const value=chars.slice(a,b).join('');
    return '<span class="ink-run" data-chapter="'+ci+'" data-offset="'+positions[0]+'" data-end="'+(offsets[b-1]+original[b-1].length)+'" data-offsets="['+positions.join(',')+']">'+decorateStudyText(value,ci,positions[0],positions)+'</span>'
   };
   for(let pos=0;pos<chars.length;){
    if(height-used<step)newCol(offsets[pos]);
    const slots=Math.max(1,Math.floor((height-used)/step)),n=Math.min(chars.length-pos,slots*(small?2:1)),half=small?Math.ceil(n/2):n;
    const h=half*step;
    col.html.push('<div class="'+(small?'interlinear':'main-run')+'" style="height:'+h+'px">'+styleRun(pos,pos+half)+(small&&n>half?styleRun(pos+half,pos+n):'')+'</div>');
    used+=h;pos+=n
   }
  }
  if(ci===windowEnd&&ci<chapterList.length-1){
   const leading=readerColumns.findLastIndex(c=>c.chapter===chapter&&c.offset<=offset);
   if(readerColumns.length-leading<visible+2)windowEnd++;
  }
 }
 colStrip.innerHTML=readerColumns.map(c=>'<div class="text-column">'+c.html.join('')+'</div>').join('');
 const first=readerColumns.findIndex(c=>c.chapter===chapter),last=readerColumns.findLastIndex(c=>c.chapter===chapter&&c.offset<=offset);
 const place=range?.relative!==undefined?first+range.relative:offset?Math.max(first,last):first;
 placedAnchor={index:place,offset};
 // Leave enough space to bring the last chapter's final column to the leading edge.
 colStrip.style.paddingLeft=windowEnd===chapterList.length-1?(view-columnWidth)+'px':'0';
 scrollBook.scrollLeft=-Math.max(0,place+(range?.fraction||0))*columnWidth;activeChapter=chapter;
 if(pointSession())paintPointSelection()
}
function setType(key,value,which){
 const pos=readerLocation();settings[key]=value;(state.typography??={})[key]=value;save();
 drawBook(pos.chapter,pos.offset);which==='font'?fontSheet():styleSheet();
 const family=key==='face' && typefaces[value].family;
 if(family && document.fonts)document.fonts.load('24px "'+family+'"','天地').catch(()=>{
  if(settings.face===value)studyFeedback('字体暂未载入，已用系统字体排版')
 })
}
function opt(text,key,val,sheet='font'){
 return '<button class="option '+(settings[key]===val?'chosen':'')+'" aria-pressed="'+(settings[key]===val)+'" onclick="setType(\''+key+'\','+esc(JSON.stringify(val))+',\''+sheet+'\')">'+text+'</button>'
}
function fontSheet(){
 const sizes=[20,24,28,34,38,42];
 const dots=sizes.map((s,i)=>'<button aria-label="'+s+'号字" class="size-dot '+(settings.size===s?'chosen':'')+'" onclick="setType(\'size\','+s+',\'font\')"><i style="width:'+(12+i*2)+'px;height:'+(12+i*2)+'px"></i></button>').join('');
 const toggle=(key,label)=>'<button class="option '+(settings[key]?'chosen':'')+'" aria-pressed="'+settings[key]+'" onclick="setType(\''+key+'\','+!settings[key]+',\'font\')">'+label+'</button>';
 openSheet('字体','<div class="size-scale">小'+dots+'大</div><div class="option-line vertical">'+scriptModes.map((m,i)=>opt(directions[i],'script',m)).join('')+toggle('annotations','注疏')+toggle('punctuation','标点')+'</div><div class="option-line face-line vertical">'+typefaces.map((face,i)=>opt(esc(face.name),'face',i)).join('')+'</div><button class="font-credits-link" onclick="fontCredits()">字体与版权</button>')
}
function styleSheet(){
 const toggle=(key,label)=>'<button class="option '+(settings[key]?'chosen':'')+'" aria-pressed="'+settings[key]+'" onclick="setType(\''+key+'\','+!settings[key]+',\'style\')">'+label+'</button>';
 openSheet('样式','<label class="size-scale">☼ <input aria-label="亮度" type="range" min="50" max="110" value="'+settings.light+'" oninput="settings.light=+this.value;applyPaper();(state.typography??={}).light=settings.light;save()"> ☀</label><div class="option-line">'+opt('日间','mode','day','style')+opt('夜间','mode','night','style')+opt('自动','mode','auto','style')+toggle('frame','版框')+toggle('double','双线')+toggle('rules','界栏')+'</div><div class="option-line palettes vertical">'+palettes.map((p,i)=>'<button class="option '+(i===settings.theme?'selected-palette':'')+'" style="background:'+p[1]+';color:'+p[2]+';border-color:'+p[3]+'" onclick="settings.mode=\'day\';(state.typography??={}).mode=\'day\';setType(\'theme\','+i+',\'style\')">'+p[0]+'</button>').join('')+'</div>')
}
const groupStarts=[0,16,37,59];
const laoGroup=i=>'河上公章句第'+['一','二','三','四'][groupStarts.findLastIndex(n=>n<=i)];
let tocPart='',tocGroup='',tocRoot=true;
function showToc(reset=true){
 if(reset){tocPart=chapterList[activeChapter]?.part||'';tocRoot=true;tocGroup=catalogue[book].layout==='heshanggong'?laoGroup(activeChapter):''}
 const parts=[...new Set(chapterList.map(c=>c.part).filter(Boolean))];
 const tag=(label,action,level,current=false)=>'<button class="fish-tag level-'+level+(current?' current':'')+'" onclick="'+action+'">'+esc(convertReader(label))+'</button>';
 let html=tag(catalogue[book].layout==='heshanggong'?'老子篇目':books[book][0],'tocRoot=!tocRoot;showToc(false)',0);
 if(tocRoot){
  if(parts.length){for(const [i,part] of parts.entries()){
   html+=tag(part,'choosePart('+i+')',1);
   if(tocPart===part&&catalogue[book].layout==='heshanggong'){
    for(const start of groupStarts.filter(n=>chapterList[n].part===part)){
     const group=laoGroup(start);
     html+=tag(group,'tocGroup=tocGroup===laoGroup('+start+')?String():laoGroup('+start+');showToc(false)',2);
     if(tocGroup===group)html+=chapterList.map((c,n)=>laoGroup(n)===group?tag(c.title,'goLocation(book,{chapter:'+n+',offset:0})',3,n===activeChapter):'').join('')
    }
   }else if(tocPart===part)html+=chapterList.map((c,n)=>c.part===part?tag(c.title,'goLocation(book,{chapter:'+n+',offset:0})',2,n===activeChapter):'').join('')
  }}else html+=chapterList.map((c,n)=>tag(c.title,'goLocation(book,{chapter:'+n+',offset:0})',1,n===activeChapter)).join('')
 }
 openSheet('目录','<div class="toc-strip">'+html+'</div>');
 if(reset)box.querySelector('.current')?.scrollIntoView({block:'nearest',inline:'nearest'})
}
function choosePart(i){const part=[...new Set(chapterList.map(c=>c.part).filter(Boolean))][i];tocPart=tocPart===part?'':part;showToc(false)}
document.addEventListener('keydown',e=>{
 if(book===null||box.open)return;
 if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();scrollBook.scrollBy({left:(e.key==='ArrowLeft'?-1:1)*Math.max(columnWidth,scrollBook.clientWidth-columnWidth),behavior:'smooth'})}
 if(e.key==='Escape'){if(pointSession())endPointSelection();else exitReader()}if(e.code==='Space'&&!pointSession()&&e.target.tagName!=='BUTTON'){e.preventDefault();chromeOn=!chromeOn;syncReaderChrome()}
});
window.addEventListener('resize',()=>{if(book!==null){clearTimeout(layoutTimer);layoutTimer=setTimeout(()=>{if(book!==null){const loc=readerLocation();drawBook(loc.chapter,loc.offset)}},100)}});
function start(){
 if(readerStore.warning)storageAlert(readerStore.warning);
 const route=location.hash.match(/^#read\/([a-z0-9-]+)$/);
 const alias={"suwen":"huangdi-neijing","laozi":"laozi-heshanggong"};
 const index=route?bookIndex(alias[route[1]]||route[1]):-1;
 if(index>=0){goLocation(index,{chapter:0,offset:0});return}
 if(location.hash==='#library'){
  endPointSelection(); libraryView.section='全部'; libraryView.subset=null; libraryView.query=''; libraryView.searching=false;
  go(2);return
 }
 go(0)
}
