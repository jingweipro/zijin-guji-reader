import {access} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

export async function findChrome() {
  const choices = process.env.CHROME ? [process.env.CHROME] : [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ];
  for (const file of choices) { try { await access(file); return file; } catch {} }
  throw new Error('Set CHROME to the installed Chromium executable.');
}
export async function waitFor(task, label) {
  const stop = Date.now() + 60000;
  let last;
  do {
    try { const value = await task(); if (value) return value; }
    catch (error) { last = error; }
    await delay(75);
  } while (Date.now() < stop);
  throw new Error('Timed out: ' + label, {cause:last});
}
export function devtools(socket, exceptions=[]) {
  const pending = new Map();
  let serial = 0;
  socket.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      const detail = msg.params.exceptionDetails;
      exceptions.push(detail.exception?.description || detail.text);
    }
    if (!msg.id) return;
    const handler = pending.get(msg.id);
    if (!handler) return;
    pending.delete(msg.id);
    clearTimeout(handler.timer);
    if (msg.error) handler.reject(new Error(msg.error.message)); else handler.resolve(msg.result);
  };
  return (method, params={}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timed out: ' + method)); }, 25000);
    pending.set(id, {resolve,reject,timer});
    socket.send(JSON.stringify({id,method,params}));
  });
}
