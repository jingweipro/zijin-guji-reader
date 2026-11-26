// All saved positions are UTF-16 offsets in the original chapter, including notes.
const GujiFulltext = (() => {
  function fold(value, entries) {
    let text = '';
    for (const ch of value) text += entries.get(ch) ?? (/[A-Z]/.test(ch) ? ch.toLowerCase() : ch);
    return text;
  }

  function* lanes(chapter, field) {
    let offset = 0, text = '', segments = [];
    for (const block of chapter.blocks) {
      const note = block.note !== undefined;
      const raw = note ? block.note : block.main;
      if (note && field !== 'main') {
        yield {field:'note', text:raw, segments:[[0, offset]]};
      } else if (!note && field !== 'note') {
        if (!segments.length || segments.at(-1)[1] - segments.at(-1)[0] !== offset - text.length) {
          segments.push([text.length, offset]);
        }
        text += raw;
      }
      offset += raw.length;
    }
    if (text) yield {field:'main', text, segments};
  }

  // Hashed postings may over-select a shard. An exact comparison always follows.
  const singleKey = point => ((point * 40503) ^ (point >>> 8)) & 65535;
  const pairKey = (prior,point) => ((prior * 40503) ^ (point * 17389) ^ (prior >>> 7) ^ (point >>> 3)) & 65535;
  function* tokens(text, includeSingles) {
    let prior = -1;
    for (const ch of text) {
      const point = ch.codePointAt(0);
      if (includeSingles) yield singleKey(point);
      if (prior >= 0) yield pairKey(prior,point);
      prior = point;
    }
  }

  function* matches(chapter,kind,needle,entries) {
    for (const lane of lanes(chapter, kind)) {
      const searchable = fold(lane.text, entries);
      let originalAt;
      if (searchable.length !== lane.text.length || needsMap(lane.text, entries)) {
        originalAt = [];
        let start = 0;
        for (const ch of lane.text) {
          const width = (entries.get(ch) || ch).length;
          for (let i=0; i<width; i++) originalAt.push(start);
          start += ch.length;
        }
        originalAt.push(start);
      }
      let next = 0, seg = 0;
      while (next < searchable.length) {
        const found = searchable.indexOf(needle, next);
        if (found < 0) break;
        next = found + (searchable.codePointAt(found) > 0xffff ? 2 : 1);
        const start = originalAt ? originalAt[found] : found;
        const end = originalAt ? originalAt[found + needle.length] : found + needle.length;
        while (seg+1<lane.segments.length && lane.segments[seg+1][0]<=start) seg++;
        const [at,raw] = lane.segments[seg];
        yield {lane, start, end, offset:raw+start-at};
      }
    }
  }

  function searchChapter(chapter, needle, field, entries, skip, take) {
    const hits = [];
    let count = 0;
    if (!needle) return {count,hits};
    const main=matches(chapter,'main',needle,entries), notes=matches(chapter,'note',needle,entries);
    let m=field==='note'?undefined:main.next().value, n=field==='main'?undefined:notes.next().value;
    while (m || n) {
      const inMain=m && (!n || m.offset<n.offset);
      const {lane,start,end,offset}=inMain?m:n;
      if (count++>=skip && hits.length<take) {
        const left = Array.from(lane.text.slice(Math.max(start-34,0), start)).slice(-14).join('');
        const right = Array.from(lane.text.slice(end, end+34)).slice(0,14).join('');
        hits.push({field:lane.field, offset, left, match:lane.text.slice(start,end), right});
      }
      if (inMain) m=main.next().value;else n=notes.next().value;
    }
    return {count,hits};
  }

  function needsMap(text, entries) {
    // A pair of opposite width changes could otherwise cancel the length difference.
    if (!/[\u{10000}-\u{10ffff}]/u.test(text)) return false;
    for (const ch of text) if ((entries.get(ch) || ch).length !== ch.length) return true;
    return false;
  }
  return {fold, lanes, tokens, singleKey, pairKey, searchChapter};
})();
if (typeof module === 'object' && module.exports) module.exports = GujiFulltext;
