// Reader coordinates count UTF-16 units in the original main and note runs.
const GujiCorrections = (() => {
  const types = ['疑似错别字','缺字或多字','断句、标点','注释问题','篇章顺序','字体或显示问题','其他'];
  const statuses = ['待审核','已确认','版本异文','不予修改','已修复','待补充证据'];
  const prefix = 'zijin-correction-v1/';
  const format = 'zijin-guji.corrections';
  function requireThat(condition, message) { if (!condition) throw new Error(message); }
  function anchor(meta, chapters, p) {
    requireThat(p.exact && p.quote && chapters[p.chapter] && chapters[p.endChapter] && p.chapter <= p.endChapter, '请在正文或夹注中重新选择文字。');
    const parts = [];
    for (let i = p.chapter; i <= p.endChapter; i++) {
      const source = chapters[i].blocks.map(b => b.main ?? b.note ?? '').join('');
      const start = i === p.chapter ? p.offset : 0;
      const end = i === p.endChapter ? p.end : source.length;
      requireThat(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && end <= source.length, '选文边界不完整，请重新选择。');
      parts.push({chapterId:chapters[i].id, chapterTitle:chapters[i].title, start, end, original:source.slice(start,end),
        before:Array.from(source.slice(0,start)).slice(-24).join(''), after:Array.from(source.slice(end)).slice(0,24).join('')});
    }
    requireThat(parts.some(s => s.original.length) && parts.reduce((n,s)=>n+s.original.length,0) <= 16000, '请选取一万六千字以内的一段原文。');
    return {bookId:meta.id, title:meta.title, editionId:meta.editionId || 'edition-'+meta.id+'-v15',
      edition:meta.edition, contentVersion:meta.contentVersion, contentSha256:meta.contentSha256,
      reportId:meta.collationStatus ? meta.id : null, quote:p.quote, parts};
  }
  function validate(r) {
    const string = (v,max) => typeof v === 'string' && v.length <= max;
    requireThat(r && /^[a-zA-Z0-9_-]{4,100}$/.test(r.id) && typeof r.id === 'string' && types.includes(r.type) && Array.isArray(r.parts) && r.parts.length && r.parts.length<=16000, '勘误记录格式错误');
    requireThat([r.title,r.edition,r.editionId,r.contentVersion,r.bookId].every(s=>string(s,1000)) && /^[0-9a-f]{64}$/.test(r.contentSha256) &&
      string(r.quote,32000) && string(r.suggestion,6000) && Number.isSafeInteger(r.created) && Array.isArray(r.history), '勘误来源或说明无效');
    for (const p of r.parts) requireThat(p && string(p.chapterId,300) && string(p.chapterTitle,2000) && Number.isSafeInteger(p.start) && p.start>=0 &&
      Number.isSafeInteger(p.end) && string(p.original,16000) && p.end-p.start===p.original.length && string(p.before,48) && string(p.after,48),'勘误原文位置无效');
    for (const h of r.history) {
      requireThat(h && statuses.includes(h.status) && Number.isSafeInteger(h.date) && [h.adopted,h.source,h.version,h.memo].every(s=>string(s,6000)), '审核履历无效');
      if (['已修复','已确认'].includes(h.status)) requireThat(h.source.trim() && h.memo.trim(), '请登记依据底本与审核说明。');
      if (h.status==='已修复') requireThat(h.version.trim(), '请登记已核实修订的正文版本。');
    }
    return r;
  }
  function status(r) { return r.history.at(-1)?.status || statuses[0]; }
  function save(store,r,expected=null) {
    validate(r);
    const key=prefix+r.id, raw=JSON.stringify(r);
    requireThat(store.getItem(key)===expected,'记录已有新版本，请重新打开核对。');
    store.setItem(key,raw);
    requireThat(store.getItem(key)===raw,'未能验证本机保存结果。');
  }
  function list(store) {
    const records=[];
    for (let i=0;i<store.length;i++) {
      const key=store.key(i);
      if (key?.startsWith(prefix)) records.push(validate(JSON.parse(store.getItem(key))));
    }
    return records.sort((a,b)=>b.created-a.created);
  }
  function backup(store) { return {format,schemaVersion:1,records:list(store)}; }
  function sameValue(a,b) {
    if (a===b) return true;
    if (!a || !b || typeof a!=='object' || typeof b!=='object' || Array.isArray(a)!==Array.isArray(b)) return false;
    const keys=Object.keys(a);
    return keys.length===Object.keys(b).length && keys.every(k=>Object.hasOwn(b,k) && sameValue(a[k],b[k]));
  }
  function importBackup(store,data) {
    requireThat(data?.format===format && data.schemaVersion===1 && Array.isArray(data.records),'请选择子衿古籍勘误备份。');
    const staged=new Map();
    for (const r of data.records) {
      validate(r);
      let change=staged.get(r.id);
      if (!change) {
        const expected=store.getItem(prefix+r.id);
        change={expected,record:expected===null?null:validate(JSON.parse(expected)),modified:false};
        staged.set(r.id,change);
      }
      if (change.record) {
        const {history:oldEvents,...oldEvidence}=change.record;
        const {history:newEvents,...newEvidence}=r;
        requireThat(sameValue(oldEvidence,newEvidence),'同一条勘误的原始反馈或锚点不同，请保留文件并核对。');
        const shared=Math.min(oldEvents.length,newEvents.length);
        for (let i=0;i<shared;i++) requireThat(sameValue(oldEvents[i],newEvents[i]),'同一条勘误存在不同的审核履历，请分别保留文件并核对。');
        if (newEvents.length<=oldEvents.length) continue;
      }
      change.record=r;
      change.modified=true;
    }
    let done=0;
    for (const change of staged.values()) {
      if (!change.modified) continue;
      try {save(store,change.record,change.expected);done++}
      catch(error){throw new Error('已导入 '+done+' 条。'+error.message+' 重试时会跳过相同记录。')}
    }
    return done;
  }
  return {types,statuses,anchor,status,validate,list,save,backup,importBackup,prefix};
})();

function correctionOptions(values,all='') {
  return (all?'<option value="">'+esc(all)+'</option>':'')+values.map(v=>'<option>'+esc(v)+'</option>').join('');
}
function openCorrection(passage) {
  let evidence;
  try {evidence=GujiCorrections.anchor(catalogue[passage.book],getChapters(passage.book),passage)}
  catch(e){studyFeedback(e.message);return}
  openSheet('古籍勘误','<form id="correction-form" class="study-editor correction-form"><small>'+esc(evidence.title)+' · '+esc(evidence.parts[0].chapterTitle)+'</small><blockquote>'+esc(evidence.quote)+'</blockquote><label>问题类型<select name="type">'+correctionOptions(GujiCorrections.types)+'</select></label><label>说明或建议读法<textarea name="suggestion" rows="3" maxlength="6000"></textarea></label><small>保存到此浏览器，可在设置中导出转交。集中提交尚未启用。</small><p role="alert"></p><button class="study-primary">保存勘误</button><button type="button" onclick="closeSheet()">取消</button></form>');
  const form=document.querySelector('#correction-form');
  const id=studyKey(),created=Date.now();
  form.onsubmit=e=>{
    e.preventDefault();
    const record={...evidence,id,created,type:form.elements.type.value,suggestion:form.elements.suggestion.value.trim(),history:[]};
    try {GujiCorrections.save(localStorage,record);closeSheet();studyFeedback('勘误已保存在本机。')}
    catch {form.querySelector('[role=alert]').textContent='保存失败。请检查浏览器存储空间，保留本页后重试。'}
  };
}
function correctionReview(record) {
  const opts=correctionOptions(GujiCorrections.statuses);
  const passages=record.parts.map(p=>'<small>'+esc(p.chapterTitle)+' · '+p.start+'–'+p.end+'</small><blockquote>'+esc(p.before)+'<b>'+esc(p.original)+'</b>'+esc(p.after)+'</blockquote>').join('');
  const history=record.history.map(h=>'<p>'+esc([new Date(h.date).toLocaleDateString(),h.status,h.source,h.adopted,h.version,h.memo].filter(Boolean).join(' · '))+'</p>').join('');
  openSheet('审核勘误','<form class="study-editor correction-form" id="correction-review"><small>'+esc(record.title)+' · '+esc(record.edition)+' · '+esc(record.contentVersion)+'</small>'+passages+'<p>'+esc(record.type)+' · '+esc(record.suggestion||'未附说明')+'</p><details><summary>选文与底本依据</summary><p>'+esc(record.quote)+'</p><small>'+esc(record.editionId)+' · '+esc(record.contentSha256)+(record.reportId?' · 校勘报告 '+esc(record.reportId):'')+'</small></details>'+history+'<label>处理状态<select name="status">'+opts+'</select></label><label>采用文字<input name="adopted" maxlength="6000"></label><label>依据底本<input name="source" maxlength="6000"></label><label>修订版本<input name="version" maxlength="256"></label><label>审核说明<textarea name="memo" rows="2" maxlength="6000"></textarea></label><small>此处登记审核结论。正式修订需另行校勘入库。</small><p role="alert"></p><button class="study-primary">登记审核</button><button type="button" onclick="correctionsPanel()">返回记录</button></form>');
  const form=document.querySelector('#correction-review');
  form.elements.status.value=GujiCorrections.status(record);
  const expected=JSON.stringify(record);
  form.onsubmit=e=>{
    e.preventDefault();
    const event={date:Date.now(),...Object.fromEntries(new FormData(form))};
    try {GujiCorrections.save(localStorage,{...record,history:[...record.history,event]},expected);correctionsPanel();studyFeedback('审核记录已保存到本机。')}
    catch(error){form.querySelector('[role=alert]').textContent='登记失败。'+error.message}
  };
}
function correctionsPanel() {
  let records;
  try {records=GujiCorrections.list(localStorage)}catch {openSheet('勘误记录','<p>本机勘误记录未能读取，请检查浏览器存储。</p>');return}
  const titles=[...new Set(records.map(r=>r.title))];
  const chapters=[...new Set(records.flatMap(r=>r.parts.map(p=>p.chapterTitle)))];
  openSheet('本机勘误记录','<div class="study-editor correction-form"><small>仅在此浏览器保存。可导出勘误备份，交给审校者导入。</small><div class="correction-filters">'+
    [ ['title',titles,'全部书籍'],['chapter',chapters,'全部篇章'],['type',GujiCorrections.types,'全部类型'],['status',GujiCorrections.statuses,'全部状态'] ].map(([key,values,name])=>'<select aria-label="'+name+'" data-filter="'+key+'">'+correctionOptions(values,name)+'</select>').join('')+'</div><div id="correction-records"></div><div class="study-options"><button id="export-corrections">导出勘误</button><button id="import-corrections">导入勘误</button></div><input id="correction-file" hidden type="file" accept=".json,application/json"><p role="status" id="correction-message"></p></div>');
  const list=document.querySelector('#correction-records'),filters=[...box.querySelectorAll('[data-filter]')];
  function refresh(){
    const visible=records.filter(r=>filters.every(({dataset:{filter:k},value:v})=>!v || (k==='chapter'?r.parts.some(p=>p.chapterTitle===v):(k==='status'?GujiCorrections.status(r):r[k])===v)));
    list.replaceChildren();
    if(!visible.length) list.textContent='没有符合条件的勘误。';
    for(const r of visible){const b=document.createElement('button');b.className='study-result';b.textContent=[r.title,r.parts[0].chapterTitle,GujiCorrections.status(r),r.quote.slice(0,32)].join(' · ');b.onclick=()=>correctionReview(r);list.append(b)}
  }
  filters.forEach(el=>el.onchange=refresh);refresh();
  document.querySelector('#export-corrections').onclick=()=>{try{const data=JSON.stringify(GujiCorrections.backup(localStorage),null,2);downloadStudyFile(new File([data],'子衿古籍-勘误记录.json',{type:'application/json'}))}catch{studyFeedback('勘误导出失败，请重试。')}};
  const input=document.querySelector('#correction-file');
  document.querySelector('#import-corrections').onclick=()=>input.click();
  input.onchange=async()=>{
    try {const f=input.files[0];if(!f)return;if(f.size>16*1024*1024)throw new Error('勘误文件超过 16 MiB');
      const n=GujiCorrections.importBackup(localStorage,JSON.parse(await f.text()));correctionsPanel();studyFeedback(n?'已新增或更新 '+n+' 条勘误。':'本机已包含这些勘误及审核记录。')}
    catch(e){document.querySelector('#correction-message').textContent='导入失败。'+e.message}
  };
}
