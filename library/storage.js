// The reader uses temporary array indices in memory. Only stable book keys cross this boundary.
const GujiStorage = (() => {
  const keys = Object.freeze({
    legacy: 'guji-reader-v1', original: 'zijin-reader-original-v1',
    current: 'zijin-reader-v1.5', previous: 'zijin-reader-before-import'
  });
  const format = 'zijin-guji.reader';
  const recordLists = ['notes', 'studyBookmarks', 'studyLines'];
  const keyedMaps = ['places', 'anchors', 'progress'];
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const clone = value => JSON.parse(JSON.stringify(value));
  const natural = value => Number.isSafeInteger(value) && value >= 0;
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const stableKey = id => typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id);
  function requireValue(condition, reason) {
    if (!condition) throw new Error(reason);
  }
  function parse(raw) {
    return JSON.parse(raw, (key, value) => {
      requireValue(!['__proto__', 'constructor', 'prototype'].includes(key), '备份字段不受支持');
      return value;
    });
  }
  function verifyShape(s, stable) {
    const goodId = stable ? stableKey : natural;
    requireValue(isObject(s) && Array.isArray(s.shelf) && s.shelf.every(goodId), '书架格式不正确');
    requireValue(!own(s,'groups') || Array.isArray(s.groups),'分组列表格式不正确');
    for (const group of s.groups ?? []) {
      requireValue(isObject(group) && typeof group.name === 'string' && Array.isArray(group.ids) && group.ids.every(goodId), '分组格式不正确');
    }
    for (const key of recordLists) {
      const records = own(s,key) ? s[key] : [];
      requireValue(Array.isArray(records), '研读记录格式不正确');
      for (const item of records) {
        requireValue(isObject(item) && goodId(item.book), '记录引用的书籍无效');
        for (const field of ['chapter', 'offset', 'end', 'endChapter', 'page']) {
          requireValue(item[field] == null || natural(item[field]), '章节或偏移格式不正确');
        }
        for (const field of ['text', 'quote', 'chapterTitle', 'needsReview']) {
          requireValue(item[field] == null || typeof item[field] === 'string', '摘录字段格式不正确');
        }
        requireValue(item.created == null || (natural(item.created) && item.created < 8.64e15), '笔记日期无效');
        requireValue(item.runs == null || (Array.isArray(item.runs) && item.runs.every(r => isObject(r) && typeof r.text === 'string')), '摘录片段无效');
        if (item.positionEvidence != null) verifyEvidence(item.positionEvidence);
      }
    }
    for (const key of keyedMaps) {
      const map = s[key] ?? {};
      requireValue(isObject(map), '进度表格式不正确');
      for (const [id, v] of Object.entries(map)) {
        requireValue(stable ? goodId(id) : /^\d+$/.test(id), '进度引用的书籍无效');
        if (key === 'places') {
          requireValue(isObject(v) && natural(v.chapter) && natural(v.offset), '阅读位置无效');
          if (v.positionEvidence != null) verifyEvidence(v.positionEvidence);
        } else requireValue(natural(v), '旧版进度格式无效');
      }
    }
    if (s.typography != null) {
      const t = s.typography;
      requireValue(isObject(t), '阅读设置无效');
      for (const [k, min, max] of [['size',12,80],['face',0,6],['theme',0,5],['light',25,150]]) {
        requireValue(!own(t,k) || (natural(t[k]) && t[k]>=min && t[k]<=max), '阅读参数超出范围');
      }
      requireValue(t.mode == null || ['auto','night','day'].includes(t.mode), '阅读模式无效');
      requireValue(t.script == null || ['original','traditional','simplified'].includes(t.script), '简繁设置无效');
    }
    if (s.cardStyle != null) {
      const c=s.cardStyle;
      requireValue(isObject(c), '图卡设置无效');
      requireValue(c.layout == null || ['scroll','pages'].includes(c.layout), '无效的摘录排版');
      for (const [k,min,max] of [['theme',0,7],['font',12,64],['height',160,1200]]) {
        requireValue(!own(c,k) || (natural(c[k]) && c[k]>=min && c[k]<=max), '图卡参数超出范围');
      }
    }
  }
  function verifyEvidence(e) {
    requireValue(isObject(e) && typeof e.version === 'string', '定位版本缺失');
    for (const p of [e.start, e.end].filter(Boolean)) {
      requireValue(isObject(p) && typeof p.chapterId === 'string' && natural(p.offset), '定位证据无效');
      requireValue(['before','after'].every(k => p[k] == null || typeof p[k] === 'string'), '摘录上下文无效');
    }
    requireValue(e.selected == null || typeof e.selected === 'string', '选区校验文字无效');
  }
  function open({storage, catalog, defaults, chapters = () => null, bookIndex, bookId}) {
    bookId ??= i => catalog[i]?.id;
    bookIndex ??= id => catalog.findIndex(m => m.id === id);
    const legacyMap = new Map(catalog.filter(m => natural(m.legacyIndex)).map(m => [m.legacyIndex,m.id]));
    const meta = new Map(catalog.map(m => [m.id,m]));
    const sourceText = new WeakMap();
    let lastRaw, saved, warning = '';
    const hasBook = id => natural(bookIndex(id));
    function rawChapter(c) {
      if (!sourceText.has(c)) sourceText.set(c,c.blocks.map(b => b.main ?? b.note).join(''));
      return sourceText.get(c);
    }
    function mapRefs(input, toId, keepMissing=false) {
      const out = clone(input);
      function list(ids) { return ids.map(toId).filter(v => v != null && v !== -1); }
      out.shelf = list(out.shelf);
      for (const g of out.groups ?? []) g.ids = list(g.ids);
      for (const field of recordLists) {
        if (!out[field]) continue;
        out[field] = out[field].map(r => ({...r,book:toId(r.book)})).filter(r => r.book!=null && r.book!==-1);
      }
      for (const field of keyedMaps) {
        if (!out[field]) continue;
        out[field] = Object.fromEntries(Object.entries(out[field]).map(([id,v])=>[toId(id),v]).filter(([k])=>k!=null && k!==-1));
      }
      // A filtered public catalogue must not drop private-book entries on a later save.
      if (keepMissing && saved) {
        const missing = id => !hasBook(id);
        function retain(target, previous, getId) {
          previous.forEach((value,index)=>{
            if(missing(getId(value)))target.splice(Math.min(index,target.length),0,value);
          });
        }
        const identity=id=>id;
        retain(out.shelf,saved.shelf,identity);
        for (const g of out.groups ?? []) retain(g.ids,saved.groups?.find(o=>o.name===g.name)?.ids??[],identity);
        for (const field of recordLists) {
          if(saved[field])retain(out[field]??=[],saved[field],r=>r.book);
        }
        for (const field of keyedMaps) {
          for (const [id,v] of Object.entries(saved[field]??{})) if(missing(id))(out[field]??={})[id]=v;
        }
      }
      return out;
    }
    function eachPosition(s, callback) {
      for (const [id,p] of Object.entries(s.places??{})) callback(id,p);
      for (const field of recordLists) for (const p of s[field]??[]) callback(p.book,p);
    }
    function stampLegacy(s) {
      for (const [id,offset] of Object.entries(s.anchors??{})) {
        if(s.places?.[id])continue;
        (s.places??={})[id]={chapter:0,offset,legacyAbsoluteOffset:true};
      }
      for (const [id,page] of Object.entries(s.progress??{})) {
        if(page>0 && !s.places?.[id]){
          (s.places??={})[id]={chapter:0,offset:0,legacyPageOnly:true,page};
        }
      }
      eachPosition(s, (id,p) => {
        p.positionEvidence = {version:'1.0.0',legacy:true};
        if (natural(p.chapter) && !p.legacyAbsoluteOffset && !p.legacyPageOnly) {
          const point=(i,offset)=>({chapterId:'ch-'+String(i+1).padStart(3,'0'),offset:offset??0});
          p.positionEvidence.start=point(p.chapter,p.offset);
          if (p.end!=null) p.positionEvidence.end=point(p.endChapter??p.chapter,p.end);
        }
      });
      return s;
    }
    function decode(raw) {
      const data = parse(raw);
      if(data.format===format){
        requireValue(data.schemaVersion===2, '读者数据版本不受支持');
        verifyShape(data.state,true);
        return data.state;
      }
      requireValue(!own(data,'format') && !own(data,'schemaVersion'), '备份文件格式不受支持');
      verifyShape(data,false);
      return stampLegacy(mapRefs(data,n=>{
        const id = legacyMap.get(Number(n));
        requireValue(id!=null,'此目录缺少旧书号 '+n+' 的对应关系；请在完整内部书库恢复');
        return id;
      }));
    }
    const envelope = state => JSON.stringify({format,schemaVersion:2,state:{...defaults,...state}});
    function runtime(canonical) {
      return Object.assign(clone(defaults),mapRefs(canonical,id=>hasBook(id)?bookIndex(id):null));
    }
    function read() {
      try {
        lastRaw = storage.getItem(keys.current);
        if(lastRaw!=null){saved=decode(lastRaw);return runtime(saved)}
        const old=storage.getItem(keys.legacy);
        if(old==null) return clone(defaults);
        if(storage.getItem(keys.original)==null)storage.setItem(keys.original,old);
        const migrated=decode(old);
        const next=envelope(migrated);
        storage.setItem(keys.current,next);
        lastRaw=next;saved=migrated;
        return runtime(saved);
      } catch(error) {
        warning='本地数据未能载入，自动保存已暂停。'+error.message;
        return clone(defaults);
      }
    }
    function evidence(p,m,cs) {
      if(!cs || !natural(p.chapter) || !cs[p.chapter])return;
      const at=(c,offset)=>{
        const text=rawChapter(cs[c]);
        if(!natural(offset)||offset>text.length)return null;
        return {chapterId:cs[c].id,offset,before:text.slice(Math.max(0,offset-20),offset),after:text.slice(offset,offset+20)};
      };
      const start=at(p.chapter,p.offset??0), hasEnd=p.end!=null, ec=p.endChapter??p.chapter;
      if(!start || (hasEnd&&!cs[ec]))return;
      const end=hasEnd?at(ec,p.end):null;
      if(hasEnd && (!end || ec<p.chapter || (ec===p.chapter && p.end<start.offset)))return;
      const e={version:m.contentVersion,hash:m.contentSha256,start};
      if(end){
        e.end=end;
        e.selected=selectedText(cs,p.chapter,start.offset,ec,end.offset);
      }
      p.positionEvidence=e;
    }
    function selectedText(cs,ci,start,ei,end){
      let text='';
      for(let i=ci;i<=ei;i++)text+=rawChapter(cs[i]).slice(i===ci?start:0,i===ei?end:undefined);
      return text;
    }
    function capture(state) {
      const out=mapRefs(state,i=>{
        const id=bookId(Number(i));requireValue(stableKey(id),'运行时书号失效');return id;
      },true);
      eachPosition(out,(id,p)=>{
        if(!hasBook(id)||p.needsReview)return;
        // Older records stay pinned to their provenance until resolveBook validates them.
        if(p.positionEvidence)return;
        evidence(p,meta.get(id),chapters(bookIndex(id)));
      });
      verifyShape(out,true);
      return out;
    }
    function assertFresh() {
      requireValue(storage.getItem(keys.current) === lastRaw,'另一标签页已更改读者数据，请导出当前副本并刷新后重试');
    }
    function save(state) {
      requireValue(!warning,warning);
      assertFresh();
      const next=capture(state),raw=envelope(next);
      if(raw!==lastRaw)storage.setItem(keys.current,raw);
      lastRaw=raw;saved=next;
    }
    function locate(point,cs,same) {
      if(!point)return null;
      const index=cs.findIndex(ch=>ch.id===point.chapterId);
      if(index<0)return null;
      const text=rawChapter(cs[index]);
      const before=point.before??'', after=point.after??'', sample=before+after;
      if(same && point.offset<=text.length && (!sample || (
        text.slice(Math.max(0,point.offset-before.length),point.offset)===before &&
        text.slice(point.offset,point.offset+after.length)===after)))return {chapter:index,offset:point.offset};
      if(!sample)return null;
      const first=text.indexOf(sample);
      if(first<0 || text.indexOf(sample,first+1)!==-1)return null;
      return {chapter:index,offset:first+before.length};
    }
    function resolveBook(state,i) {
      const id=bookId(i),m=meta.get(id),cs=chapters(i);
      if(!m||!cs?.length)return 0;
      let unresolved=0;
      const records=[state.places?.[i], ...recordLists.flatMap(k=>(state[k]??[]).filter(r=>r.book===i))].filter(Boolean);
      for(const p of records){
        const e=p.positionEvidence;
        if(!e){evidence(p,m,cs);continue}
        const same=e.hash?e.hash===m.contentSha256:e.legacy && e.version===m.contentVersion;
        let start=locate(e.start,cs,same);
        // Early exports used absolute main-text offsets with no chapter information.
        if(!e.start&&same&&natural(p.offset)&&!p.legacyPageOnly){
          let rest=p.offset;
          for(let c=0;c<cs.length&&!start;c++){
            let n=0;for(const b of cs[c].blocks){
              if(b.main!=null && rest<=b.main.length){start={chapter:c,offset:n+rest};break}
              if(b.main!=null)rest-=b.main.length;
              n+=(b.main??b.note).length;
            }
          }
        }
        let end=e.end?locate(e.end,cs,same):null;
        if((!start||!end) && !same && e.selected && e.start?.chapterId===e.end?.chapterId){
          const chapter=cs.findIndex(c=>c.id===e.start.chapterId);
          if(chapter>=0){
            const source=rawChapter(cs[chapter]), pos=source.indexOf(e.selected);
            if(pos>=0 && source.indexOf(e.selected,pos+1)<0){
              start={chapter,offset:pos};end={chapter,offset:pos+e.selected.length};
            }
          }
        }
        const valid=start && (!e.end || (end && (start.chapter<end.chapter || (start.chapter===end.chapter && start.offset<=end.offset)) &&
          (e.selected==null || e.selected===selectedText(cs,start.chapter,start.offset,end.chapter,end.offset))));
        if(!valid){
          p.needsReview='正文或章节已变更，旧位置无法唯一核对。原摘录已保留。';unresolved++;continue;
        }
        delete p.needsReview;delete p.legacyAbsoluteOffset;
        Object.assign(p,start);
        if(end){p.endChapter=end.chapter;p.end=end.offset}
        evidence(p,m,cs);
      }
      return unresolved;
    }
    function replace(raw,backup=true) {
      const next=decode(raw);
      assertFresh();
      const value=envelope(next);
      if(value===lastRaw)return runtime(next);
      const formerUndo=backup?storage.getItem(keys.previous):null;
      if(backup){
        const previous=lastRaw??storage.getItem(keys.legacy)??envelope(capture(defaults));
        storage.setItem(keys.previous,previous);
      }
      try{
        storage.setItem(keys.current,value);
      }catch(error){
        // setItem is atomic per key. A failed replacement must keep the previous undo point.
        if(backup && formerUndo!==null)storage.setItem(keys.previous,formerUndo);
        else if(backup)storage.removeItem?.(keys.previous);
        throw error;
      }
      saved=next;lastRaw=value;warning='';
      return runtime(next);
    }
    function importData(raw){
      requireValue(typeof raw==='string' && raw.length<=16*1024*1024,'文件过大或文件格式无效');
      return replace(raw);
    }
    function undoImport() {
      const raw=storage.getItem(keys.previous);
      requireValue(raw!=null,'没有导入前的快照');
      return replace(raw,false);
    }
    function restoreLegacy(){
      const raw=storage.getItem(keys.original)??storage.getItem(keys.legacy);
      requireValue(raw!=null,'未找到 V1.0 的原始本地数据');
      return replace(raw);
    }
    return {read,save,resolveBook,importData,undoImport,restoreLegacy,
      exportData:state=>envelope(capture(state)),
      rawData:()=>lastRaw??storage.getItem(keys.legacy),
      legacyRaw:()=>storage.getItem(keys.original)??storage.getItem(keys.legacy),
      get warning(){return warning}};
  }
  return {open,keys};
})();
if(typeof module!=='undefined' && module.exports)module.exports=GujiStorage;
