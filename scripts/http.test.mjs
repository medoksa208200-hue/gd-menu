import {test} from 'node:test';
import assert from 'node:assert/strict';
const env=new Map();globalThis.Deno={env:{get:k=>env.get(k)}};
const {responseHeaders,originAllowed,readJson,clientAddress}=await import('../supabase/functions/_shared/http.mjs');
const request=(headers={},body='{}')=>new Request('https://fn.example/x',{method:'POST',headers,body});

test('origins are open until ALLOWED_ORIGINS is configured, then restricted',()=>{
 env.delete('ALLOWED_ORIGINS');
 assert.equal(responseHeaders(request({origin:'https://evil.example'}))['Access-Control-Allow-Origin'],'*');
 assert.ok(originAllowed(request({origin:'https://evil.example'})));
 env.set('ALLOWED_ORIGINS','https://gd.example, https://www.gd.example');
 assert.equal(responseHeaders(request({origin:'https://www.gd.example'}))['Access-Control-Allow-Origin'],'https://www.gd.example');
 assert.equal(originAllowed(request({origin:'https://evil.example'})),false);
 assert.ok(originAllowed(request({})));
 env.delete('ALLOWED_ORIGINS');
});

test('request bodies must be small JSON objects',async()=>{
 assert.deepEqual(await readJson(request({'content-type':'application/json'},'{"a":1}')),{a:1});
 await assert.rejects(()=>readJson(request({'content-type':'text/plain'},'{}')));
 await assert.rejects(()=>readJson(request({'content-type':'application/json'},'[1]')));
 await assert.rejects(()=>readJson(request({'content-type':'application/json'},JSON.stringify({q:'x'.repeat(17000)}))));
});

test('client address prefers proxy-set headers over client-supplied forwarding entries',()=>{
 assert.equal(clientAddress(request({'cf-connecting-ip':'1.1.1.1','x-forwarded-for':'9.9.9.9'})),'1.1.1.1');
 assert.equal(clientAddress(request({'x-forwarded-for':'9.9.9.9, 2.2.2.2'})),'2.2.2.2');
});
