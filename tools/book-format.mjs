import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

export const MAX_BOOK_BYTES = 24 * 1024 * 1024;
export const validId = id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,119}$/.test(id);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const serialize = value => JSON.stringify(value, null, 2) + '\n';
export const catalogScript = catalog => 'const GujiCatalog = ' + JSON.stringify(catalog) + ';\n';
export const offlineScript = (id, raw) => 'registerOfflineBook(' + JSON.stringify(id) + ',' + JSON.stringify(raw) + ');\n';
export const sourceKinds = ['original','transcription','annotation','translation','facsimile'];
const nonblank = s => typeof s === 'string' && Boolean(s.trim());

export function validateMeta(meta) {
  assert(validId(meta.id), '无效的 bookId');
  if ('workId' in meta || 'editionId' in meta || 'collationStatus' in meta) {
    assert(validId(meta.workId) && validId(meta.editionId) && ['A','B'].includes(meta.collationStatus),'作品、版本或校勘等级无效');
  }
  if ('sourceNoticeSha256' in meta) assert(/^[0-9a-f]{64}$/.test(meta.sourceNoticeSha256),'来源标头摘要无效');
  for (const field of ['title','byline','author','dynasty','section','category','genre','description','contentVersion']) {
    assert(nonblank(meta[field]), '缺少 ' + field);
  }
  assert(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(meta.contentVersion), '内容版本须为三段版本号');
  assert(meta.legacyIndex === null || (Number.isSafeInteger(meta.legacyIndex) && meta.legacyIndex >= 0), '旧书号无效');
  assert(Array.isArray(meta.aliases) && meta.aliases.every(nonblank), '别名必须是文本数组');
  assert(typeof meta.excerpt === 'string' && typeof meta.coverAuthor === 'string', '缺少封面或摘录字段');
  assert(['classic','heshanggong'].includes(meta.layout), '未知版式');
  assert(typeof meta.rights?.publicApproved === 'boolean', '缺少公开审核结果');
  assert(Array.isArray(meta.sources), '缺少来源');
  for (const kind of sourceKinds) assert(meta.sources.some(s => s.kind === kind), '缺少来源分类 ' + kind);
  for (const source of meta.sources) {
    assert(nonblank(source.kind) && nonblank(source.detail) && ['pending','approved','not-applicable'].includes(source.status), '来源记录缺失或状态不明');
    if (source.url) assert(/^https?:\/\//.test(source.url), '来源链接无效');
  }
  assert(meta.sources.some(s => s.kind === 'original' && s.status !== 'not-applicable'), '原文必须登记');
  if (meta.rights.publicApproved) {
    assert(meta.sources.every(s => s.status !== 'pending'), '尚有待审来源，不能公开');
    assert(meta.sources.some(s => s.kind === 'original' && s.status === 'approved'), '公开原文须经过审核');
  }
  assert(/^[a-f0-9]{64}$/.test(meta.contentSha256), '校验值格式无效');
  assert(Number.isSafeInteger(meta.chapterCount) && meta.chapterCount > 0, '篇数无效');
  assert(Number.isSafeInteger(meta.characters) && meta.characters >= 0, '字数无效');
}

export function validateContent(id, content) {
  assert(content.schemaVersion === 1 && content.bookId === id && validId(id), '正文版本或 bookId 不匹配');
  assert(Array.isArray(content.chapters) && content.chapters.length, '正文至少需要一个章节');
  const seen = new Set();
  let characters = 0;
  const count = text => (text.match(/\p{Script=Han}/gu) || []).length;
  for (const ch of content.chapters) {
    assert(validId(ch.id) && !seen.has(ch.id), '章节 ID 无效或重复');
    seen.add(ch.id);
    assert(nonblank(ch.title) && ch.title.isWellFormed(), '章节标题无效');
    assert(ch.part === undefined || (nonblank(ch.part) && ch.part.isWellFormed()), '卷册名无效');
    assert(Array.isArray(ch.blocks), '章节正文须为数组');
    characters += count(ch.title);
    for (const block of ch.blocks) {
      const keys = Object.keys(block);
      assert(keys.length === 1 && ['main','note'].includes(keys[0]), '正文块必须且只能包含 main 或 note');
      const value = block[keys[0]];
      assert(typeof value === 'string' && value.isWellFormed(), '正文须为有效 Unicode 文本');
      characters += count(value);
    }
  }
  return characters;
}

export function validateBook(meta, content, raw = serialize(content)) {
  validateMeta(meta);
  assert(Buffer.byteLength(raw) <= MAX_BOOK_BYTES, '单书超过 24 MiB，需拆卷后复核');
  assert.equal(sha256(raw), meta.contentSha256, 'content.json 字节校验失败');
  assert.deepEqual(JSON.parse(raw), content, '验证对象并非所登记的原文');
  const characters = validateContent(meta.id, content);
  assert.equal(meta.chapterCount, content.chapters.length, '目录篇数不匹配');
  assert.equal(meta.characters, characters, '汉字计数不匹配');
}

export function makeBook(metadata, chapters) {
  const content = {schemaVersion:1, bookId:metadata.id, chapters};
  const characters = validateContent(metadata.id, content);
  const raw = serialize(content);
  const meta = {...metadata, chapterCount:chapters.length, characters, contentSha256:sha256(raw)};
  validateBook(meta, content, raw);
  return {meta, content, raw, offline:offlineScript(meta.id, raw)};
}

export function validateCatalog(catalog) {
  assert(catalog.schemaVersion === 1 && Array.isArray(catalog.books), '未知书目格式');
  const ids = new Set(), legacy = new Set();
  for (const meta of catalog.books) {
    validateMeta(meta);
    assert(!ids.has(meta.id), '重复 bookId ' + meta.id);
    ids.add(meta.id);
    if (meta.legacyIndex !== null) {
      assert(!legacy.has(meta.legacyIndex), '旧索引重复');
      legacy.add(meta.legacyIndex);
    }
  }
}

async function atomicWrite(file, value) {
  const staging = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(staging, value, {flag:'wx'});
    await rename(staging, file);
  } finally { await rm(staging, {force:true}); }
}

// Use these in staging directories. The importer controls publication of the whole change.
export async function writeBook(directory, bundle) {
  const {meta, content, raw, offline} = bundle;
  validateBook(meta, content, raw);
  assert.equal(offline, offlineScript(meta.id, raw));
  await mkdir(directory, {recursive:true});
  await atomicWrite(path.join(directory, 'content.json'), raw);
  await atomicWrite(path.join(directory, 'offline.js'), offline);
  await atomicWrite(path.join(directory, 'meta.json'), serialize(meta));
}

export async function writeCatalog(directory, catalog) {
  validateCatalog(catalog);
  await mkdir(directory, {recursive:true});
  await atomicWrite(path.join(directory, 'catalog.js'), catalogScript(catalog));
  await atomicWrite(path.join(directory, 'catalog.json'), serialize(catalog));
}
