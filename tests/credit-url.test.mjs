import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const source=readFileSync(new URL('../study.js',import.meta.url),'utf8');
const fn=source.match(/^function cardCreditUrl\(meta\)\{[\s\S]*?^\}/m)[0];
function url(base,creditPage){
 return runInNewContext(fn+';cardCreditUrl(meta)',{URL,document:{baseURI:base},meta:{creditPage}});
}
test('credit link follows actual host and subdirectory',()=>{
 assert.equal(url('https://guji.wuyunliuqi.top/#read/a','s/book-1.html'),'https://guji.wuyunliuqi.top/s/book-1.html');
 assert.equal(url('https://example.org/reader/index.html','s/book-1.html'),'https://example.org/reader/s/book-1.html');
 assert.equal(url('http://localhost:8000/','s/book-1.html'),'http://localhost:8000/s/book-1.html');
});
test('offline cards do not expose local absolute filesystem paths',()=>{
 assert.equal(url('file:///private/example/index.html','s/book-1.html'),'s/book-1.html');
});
test('credit paths reject external schemes, traversal and missing values',()=>{
 for(const value of ['javascript:alert(1)','https://example.org/s/a.html','//example.org/a','s/../a.html','s/a.html?x=1','',null])assert.equal(url('https://example.org/',value),'');
});
