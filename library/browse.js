// 书目指向具体的作品或注本。仅用显式 bookId 关联本站正文。
const referenceCategories = {};
const referenceLists = [];
const localLists = [];

function displayCategory(book) {
  // 原台账中的「曲类」是「词曲类」的子集，展示合并，底本元数据不改。
  return book.section==='集' && book.category==='曲类' ? '词曲类' : book.category;
}
function categoryIndex(catalog) {
  const groups = new Map(Object.entries(referenceCategories).map(([name,categories])=>[
    name,new Map(categories.map(category=>[category,[]]))
  ]));
  for (const book of catalog) {
    if (!groups.has(book.section)) groups.set(book.section,new Map());
    const group = groups.get(book.section);
    const category = displayCategory(book);
    if (!group.has(category)) group.set(category,[]);
    group.get(category).push(book);
  }
  return groups;
}
function collectionIndex(catalog) {
  const byId=new Map(catalog.map(b=>[b.id,b]));
  const lists=referenceLists.map(({id,name,members})=>({
    id,name,entries:members.map(([title,byline,bookId])=>({title,byline,book:byId.get(bookId)}))
  }));
  for(const list of localLists){
    const entries=list.ids.map(id=>byId.get(id)).filter(Boolean).map(book=>({
      title:book.title,byline:book.byline,book
    }));
    if(entries.length) lists.push({id:list.id,name:list.name,entries});
  }
  return lists;
}

let browseScreen='',browsePendingReturn=null;
const makeBrowseEl=(tag,className,text)=>{
  const el=document.createElement(tag);
  if(className) el.className=className;
  if(text!==undefined) el.textContent=text;
  return el;
};
function browseButton(className,label,run){
  const button=makeBrowseEl('button',className,label);
  button.type='button';button.addEventListener('click',run);return button;
}
function captureBrowsePosition(){
  const rails=Array.from(document.querySelectorAll('[data-browse-rail]')).map(rail=>[rail.dataset.browseRail,rail.scrollLeft]);
  return {screen:browseScreen,y:window.scrollY,rails};
}
function restoreBrowsePosition(screen){
  browseScreen=screen;
  const saved=browsePendingReturn;
  browsePendingReturn=null;
  if(!saved||saved.screen!==screen)return;
  const scrollByRail=new Map(saved.rails);
  for(const rail of document.querySelectorAll('[data-browse-rail]'))rail.scrollLeft=scrollByRail.get(rail.dataset.browseRail)||0;
  window.scrollTo(0,saved.y);
}
function showBrowseBook(book){
  const index=bookIndex(book.id);
  if(!Number.isInteger(index)||index<0)return;
  browsePendingReturn=captureBrowsePosition();
  showBookDetail(index);
}
function browseCover(entry){
  const readable=Boolean(entry.book);
  const el=readable ? browseButton('browse-cover',undefined,()=>showBrowseBook(entry.book)) : makeBrowseEl('div','browse-cover unavailable');
  const title=readable?convertScript(entry.book.title,'simplified'):entry.title;
  const byline=readable?coverByline(entry.book):entry.byline;
  el.append(makeBrowseEl('strong','',title),makeBrowseEl('small','',byline));
  if(!readable)el.append(makeBrowseEl('span','entry-state','未入库'));
  if(readable)el.setAttribute('aria-label','查看《'+title+'》 '+byline);
  return el;
}
function browseCategories(){
  const result=document.getElementById('catalogueResults');
  result.replaceChildren();
  for(const [section,categories] of categoryIndex(GujiCatalog.books)){
    const group=makeBrowseEl('section','catalogue-group browse-categories');
    group.append(makeBrowseEl('h2','',section));
    const grid=makeBrowseEl('div','category-grid');
    for(const [category,members] of categories){
      const choice=browseButton('',category,()=>browseCategory(section,category));
      choice.setAttribute('aria-label',section+' · '+category+'，已收录 '+members.length+' 部');
      grid.append(choice);
    }
    group.append(grid);result.append(group);
  }
  restoreBrowsePosition('categories');
}
function browseLists(){
  const result=document.getElementById('catalogueResults');
  result.replaceChildren();
  const lists=collectionIndex(GujiCatalog.books);
  if(!lists.length)result.append(makeBrowseEl('p','shell-empty','暂无书单'));
  for(const list of lists){
    const group=makeBrowseEl('section','catalogue-group browse-list');
    group.append(makeBrowseEl('h2','',list.name));
    const rail=makeBrowseEl('div','browse-rail');rail.dataset.browseRail=list.id;
    rail.tabIndex=0;rail.setAttribute('aria-label',list.name+'书目，可横向浏览');
    rail.append(...list.entries.map(browseCover));
    const available=list.entries.filter(e=>e.book).length;
    const label='查看书单 · '+list.entries.length+' 种'+(available===list.entries.length?'':' · 已收录 '+available+' 种');
    group.append(rail,browseButton('browse-all',label,()=>browseCollection(list.id)));
    result.append(group);
  }
  restoreBrowsePosition('lists');
}
function browseDetail(subset,entries){
  const screen=JSON.stringify([subset.browseKind,subset.section,subset.category,subset.id]);
  const parent=libraryView.subset;
  // 分类/书单 → 书目 → 详情 → 原书目；保留上一级纵向与书封横向位置。
  if(!parent)subset.parentPosition=captureBrowsePosition();
  else subset.parentPosition=parent.parentPosition;
  libraryView.subset=subset;
  const app=document.getElementById('app');
  const header=makeBrowseEl('header','browse-header');
  const back=browseButton('shell-icon','‹',()=>{
    browsePendingReturn=subset.parentPosition;
    libraryView.subset=null;renderLibrary();
  });
  back.setAttribute('aria-label','返回'+libraryView.section);
  header.append(back,makeBrowseEl('h1','',subset.name));
  app.replaceChildren(header);
  const grid=makeBrowseEl('div','browse-detail-grid');grid.append(...entries.map(browseCover));
  if(entries.length)app.append(grid);
  else app.append(makeBrowseEl('p','shell-empty','本类尚未收录古籍'));
  if(!browsePendingReturn)window.scrollTo(0,0);
  restoreBrowsePosition(screen);
}
function browseCollection(id){
  const list=collectionIndex(GujiCatalog.books).find(list=>list.id===id);
  if(list)browseDetail({browseKind:'collection',id,name:list.name},list.entries);
}
function browseCategory(section,category){
  const books=categoryIndex(GujiCatalog.books).get(section)?.get(category);
  if(books)browseDetail({browseKind:'category',section,category,name:section+' · '+category},books.map(book=>({book})));
}
