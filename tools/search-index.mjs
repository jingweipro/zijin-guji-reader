import {createHash} from 'node:crypto';
import fulltext from '../library/fulltext.js';

function encodeCounts(rows) {
  const bytes=[];
  function integer(n) {
    while (n>=128) {bytes.push((n%128)+128);n=Math.floor(n/128);}
    bytes.push(n);
  }
  let previous=0;
  for (let i=0;i<rows.length;i+=3) {
    integer(rows[i]-previous);integer(rows[i+1]);integer(rows[i+2]);previous=rows[i];
  }
  return Buffer.from(bytes).toString('base64');
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function createSearchIndex(shell) {
  const table = shell.match(/shellConversions\.simplified\s*=\s*conversionTable\(\s*"([^"]+)",\s*"([^"]+)"/u);
  if (!table) throw new Error('找不到现用简繁对照表');
  const target = Array.from(table[2]);
  const entries = new Map(Array.from(table[1], (ch, i) => [ch,target[i]]));
  const editions = {};
  const shards = [], postings = new Map(), assets = new Map();

  function addShard(meta, chapters) {
    const id = shards.length;
    const keys = new Set();
    for (const chapter of chapters) {
      for (const lane of fulltext.lanes(chapter, 'both')) {
        for (const key of fulltext.tokens(fulltext.fold(lane.text,entries),true)) keys.add(key);
      }
    }
    for (const key of keys) {
      if (!postings.has(key)) postings.set(key, []);
      postings.get(key).push(id);
    }
    const bytes = JSON.stringify(chapters);
    const hash = digest(bytes);
    assets.set(hash + '.json', bytes);
    shards.push({book:meta.id, hash});
  }

  function frequentCounts() {
    // Count exact short terms only where hashed postings span many chunks.
    // Indexing has two passes so rare terms never acquire library-wide arrays.
    const threshold=10;
    const common=new Set([...postings].filter(([,ids])=>ids.length>=threshold).map(([key])=>key));
    const rows=new Map();
    for (const [id,shard] of shards.entries()) {
      const local=new Map();
      function count(term,type) {
        let n=local.get(term);
        if (!n) {n=[0,0];local.set(term,n);}
        n[type]++;
      }
      const chapters=JSON.parse(assets.get(shard.hash+'.json'));
      for (const c of chapters) for (const lane of fulltext.lanes(c,'both')) {
        const type=lane.field==='main'?0:1;
        let previous='',prior=-1;
        for (const ch of fulltext.fold(lane.text,entries)) {
          const point=ch.codePointAt(0);
          if (common.has(fulltext.singleKey(point))) count(ch,type);
          if (prior>=0 && common.has(fulltext.pairKey(prior,point))) count(previous+ch,type);
          previous=ch;prior=point;
        }
      }
      for (const [term,[main,note]] of local) {
        if (!rows.has(term)) rows.set(term,[]);
        rows.get(term).push(id,main,note);
      }
    }
    const buckets=Array.from({length:512},()=>({}));
    for (const [term,values] of rows) {
      if (values.length<threshold*3) continue;
      const chars=Array.from(term);
      const [key]=fulltext.tokens(term,chars.length===1);
      buckets[key%512][term]=encodeCounts(values);
    }
    return buckets.map(store);
  }

  function store(value) {
    const bytes=JSON.stringify(value),hash=digest(bytes);
    assets.set(hash+'.json',bytes);
    return hash;
  }

  return {
    index(meta, content) {
      editions[meta.id]=meta.contentSha256;
      let chunk = [], length = 0;
      for (const chapter of content.chapters) {
        const size = chapter.blocks.reduce((n,b) => n+(b.note ?? b.main).length,0);
        if (length && length+size > 32000) { addShard(meta,chunk); chunk=[]; length=0; }
        chunk.push({id:chapter.id, title:chapter.title, blocks:chapter.blocks});
        length+=size;
      }
      if (chunk.length) addShard(meta,chunk);
    },
    finish(add) {
      if (!shards.length) return '';
      const buckets = Array.from({length:128}, () => ({}));
      for (const [token, ids] of postings) {
        const bits = Buffer.alloc(Math.ceil(shards.length/8));
        for (const id of ids) bits[id>>3] |= 1 << (id&7);
        buckets[token%128][token>>7] = bits.toString('base64');
      }
      const hashes = buckets.map(store);
      const counts = frequentCounts();
      const manifest = JSON.stringify({schemaVersion:1, editions, shards, buckets:hashes, counts});
      const hash = digest(manifest);
      assets.set(hash+'.json',manifest);
      for (const [name,bytes] of assets) add('books/search/'+name,bytes);
      return hash;
    }
  };
}
