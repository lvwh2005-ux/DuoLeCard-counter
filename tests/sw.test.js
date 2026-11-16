'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
  const scope = 'https://example.test/DuoLeCard-counter/';
  const handlers = new Map(), buckets = new Map();
  let online = true, status = 200;
  const key = request => new URL(typeof request === 'string' ? request : request.url, scope).href;
  const fetch = async request => {
    if (!online) throw new Error('offline');
    return new Response('network:' + key(request), { status });
  };
  const caches = {
    async open(name) {
      if (!buckets.has(name)) buckets.set(name, new Map());
      const bucket = buckets.get(name);
      return {
        async addAll(urls) { for (const url of urls) bucket.set(key(url), await fetch(url)); },
        async put(request, response) { bucket.set(key(request), response); }
      };
    },
    async keys() { return [...buckets.keys()]; },
    async delete(name) { return buckets.delete(name); },
    async match(request) {
      for (const bucket of buckets.values()) if (bucket.has(key(request))) return bucket.get(key(request)).clone();
    }
  };
  const self = { registration: { scope }, addEventListener: (type, handler) => handlers.set(type, handler),
    skipWaiting: async () => {}, clients: { claim: async () => {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8'), { self, caches, fetch, URL, Set });
  return {
    buckets,
    offline() { online = false; },
    setStatus(value) { status = value; },
    async lifecycle(type) {
      const jobs = []; handlers.get(type)({ waitUntil: promise => jobs.push(promise) }); await Promise.all(jobs);
    },
    async request(relative, mode = 'navigate', method = 'GET') {
      let response; const jobs = [];
      handlers.get('fetch')({ request: { url: key(relative), mode, method },
        respondWith: promise => { response = promise; }, waitUntil: promise => jobs.push(promise) });
      if (!response) return null;
      const result = await response; await Promise.all(jobs); return result;
    }
  };
}

test('离线缓存：首次安装后页面和算法/交互脚本均能断网读取', async () => {
  const h = harness(); await h.lifecycle('install'); h.offline();
  assert.match(await (await h.request('./')).text(), /index\.html/);
  assert.match(await (await h.request('./counter.js?v=1', 'cors')).text(), /counter\.js\?v=1/);
  assert.match(await (await h.request('./app.js?v=1', 'cors')).text(), /app\.js\?v=1/);
});

test('更新缓存只清理本项目旧版本，保留其他项目缓存', async () => {
  const h = harness(); h.buckets.set('other-project-cache', new Map());
  h.buckets.set('duole-card-counter-v0', new Map());
  await h.lifecycle('install'); await h.lifecycle('activate');
  assert.ok(h.buckets.has('other-project-cache'));
  assert.ok(h.buckets.has('duole-card-counter-v1'));
  assert.equal(h.buckets.has('duole-card-counter-v0'), false);
});

test('不拦截其他站点/项目、POST、以及本项目非应用资源', async () => {
  const h = harness(); await h.lifecycle('install');
  assert.equal(await h.request('https://other.test/index.html'), null);
  assert.equal(await h.request('../other-project/index.html'), null);
  assert.equal(await h.request('./', 'navigate', 'POST'), null);
  assert.equal(await h.request('./screenshots/desktop-1440.jpg', 'cors'), null);
});

test('网络成功优先取新页面，失败响应不污染离线副本', async () => {
  const h = harness(); await h.lifecycle('install');
  const live = await h.request('./index.html'); assert.equal(live.status, 200);
  h.setStatus(404); assert.equal((await h.request('./index.html')).status, 404);
  h.offline(); assert.equal((await h.request('./index.html')).status, 200);
});
