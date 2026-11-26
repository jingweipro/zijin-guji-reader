import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const fn=source.match(/^function safeExternalUrl\(value\)\{[\s\S]*?^\}/m)[0];
const check=value=>runInNewContext(fn+';safeExternalUrl(value)',{URL,value});
test('source links permit valid HTTP and HTTPS URLs',()=>{
 assert.equal(check('https://example.org/book'),'https://example.org/book');
 assert.equal(check('http://example.org/'),'http://example.org/');
});
test('source links reject active schemes, malformed and credential-bearing URLs',()=>{
 for(const value of ['javascript:void(0)','data:text/html,test','file:///tmp/test','//example.org/',' https://example.org','https://','https://user:pass@example.org','',null])assert.equal(check(value),'');
});
