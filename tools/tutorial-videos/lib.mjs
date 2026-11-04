// The recording studio: one browser context per video, with on-screen captions, a visible pointer and stand-ins
// for what a headless browser cannot show (camera, QR scanner, prompt dialogs).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

export const OUT = path.resolve('out');
export const WEB = 'http://localhost:3000';
export const MOBILE = 'http://localhost:5173';
const W = 1280;
const H = 720;
/** QA=1: the same scenes as a fast check — no recording, short pauses, every problem collected. */
export const QA = process.env.QA === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, QA ? Math.min(ms, 250) : ms));
let current = null;

/** What went wrong while running the scenes (QA mode): JS errors, failed API calls, skipped steps. */
export const issues = [];

/** Listens to a page for the problems a person would hit: script errors, server errors, refused calls. */
export function watch(page, where) {
  page.on('pageerror', (e) => issues.push({ where: where(), kind: 'lỗi JS', detail: e.message.split('\n')[0] }));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) issues.push({ where: where(), kind: 'console', detail: m.text().slice(0, 200) });
  });
  page.on('response', async (r) => {
    if (r.status() < 400 || !r.url().includes('/api/')) return;
    // Signing out and the first silent refresh on the sign-in page answer 401 by design.
    if (r.status() === 401 && /\/auth\/(refresh|me|logout)/.test(r.url())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 160); } catch { /* gone */ }
    issues.push({ where: where(), kind: `HTTP ${r.status()}`, detail: `${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} ${body}` });
  });
}

/** What the screen looked like when a scene failed: out/loi-<name>.png. */
export async function snapshotFailure(name) {
  if (!current) return;
  fs.mkdirSync(OUT, { recursive: true });
  await current.screenshot({ path: path.join(OUT, `loi-${name}.png`) }).catch(() => undefined);
  await current.context().browser()?.close().catch(() => undefined);
}

/** Runs at the start of every document; only the top document draws. State survives full page loads. */
const OVERLAY = () => {
  if (window.top !== window) return;
  const KEY = '__tv_state';
  const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  const save = (patch) => { const s = { ...read(), ...patch }; try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* none */ } return s; };
  const css = `
    #tv{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:'Noto Sans','Segoe UI',sans-serif}
    #tv-cursor{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:rgba(250,204,21,.55);
      border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.45);transition:left .65s cubic-bezier(.4,0,.2,1),top .65s cubic-bezier(.4,0,.2,1)}
    #tv-ripple{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:3px solid #facc15;opacity:0}
    #tv-ripple.go{animation:tvr .55s ease-out}
    @keyframes tvr{from{transform:scale(.6);opacity:1}to{transform:scale(2.8);opacity:0}}
    #tv-cap{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);max-width:1040px;min-width:420px;background:rgba(15,23,42,.92);
      color:#fff;border-radius:14px;padding:14px 22px 16px;box-shadow:0 8px 30px rgba(0,0,0,.35);transition:opacity .3s}
    #tv-cap .ch{font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5eead4;margin-bottom:4px}
    #tv-cap .tx{font-size:22px;line-height:1.38}
    #tv-hl{position:absolute;border:3px solid #facc15;border-radius:12px;box-shadow:0 0 0 9999px rgba(15,23,42,.28);transition:all .45s;opacity:0}
    #tv-card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
      background:linear-gradient(135deg,#0f766e,#0f172a);color:#fff;transition:opacity .5s}
    #tv-card .big{font-size:52px;font-weight:800;margin:10px 0}
    #tv-card .small{font-size:24px;opacity:.85;max-width:900px;line-height:1.45}
    #tv-card .logo{font-size:72px}
    #tv-modal[hidden]{display:none}
    #tv-modal{position:absolute;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center}
    #tv-modal .box{background:#fff;color:#0f172a;border-radius:16px;padding:20px 22px;width:340px;box-shadow:0 12px 40px rgba(0,0,0,.35)}
    #tv-modal .q{font-size:16px;margin-bottom:10px}
    #tv-modal .a{border:2px solid #0f766e;border-radius:10px;padding:10px;font-size:16px;min-height:22px}
    #tv-modal .ok{margin-top:12px;text-align:right;font-weight:700;color:#0f766e;font-size:16px}
  `;
  function build() {
    if (document.getElementById('tv') || !document.documentElement) return;
    const root = document.createElement('div');
    root.id = 'tv';
    root.innerHTML = `<style>${css}</style><div id="tv-hl"></div><div id="tv-modal" hidden><div class="box"><div class="q"></div><div class="a"></div><div class="ok">OK</div></div></div>
      <div id="tv-cap" style="opacity:0"><div class="ch"></div><div class="tx"></div></div><div id="tv-card" style="opacity:0"></div>
      <div id="tv-ripple"></div><div id="tv-cursor"></div>`;
    document.documentElement.appendChild(root);
    paint(read());
  }
  function paint(s) {
    const q = (id) => document.getElementById(id);
    if (!q('tv')) return;
    const cur = q('tv-cursor');
    cur.style.transition = 'none';
    cur.style.left = `${s.x ?? 640}px`;
    cur.style.top = `${s.y ?? 400}px`;
    cur.offsetWidth;
    cur.style.transition = '';
    cur.style.display = s.card ? 'none' : '';
    const panel = document.getElementById('panel-text');
    if (panel) {
      document.getElementById('panel-ch').textContent = s.ch || '';
      panel.textContent = s.text || '';
      q('tv-cap').style.display = 'none';
    } else {
      q('tv-cap').style.opacity = s.text ? '1' : '0';
      q('tv-cap').querySelector('.ch').textContent = s.ch || '';
      q('tv-cap').querySelector('.tx').textContent = s.text || '';
    }
    q('tv-card').innerHTML = s.card || '';
    q('tv-card').style.opacity = s.card ? '1' : '0';
  }
  // Pages may re-render the whole document: put the overlay back whenever it disappears.
  setInterval(build, 150);
  document.addEventListener('DOMContentLoaded', build);
  build();
  window.__tv = {
    caption: (ch, text) => paint(save({ ch, text })),
    card: (html) => paint(save({ card: html })),
    move: (x, y) => { save({ x, y }); const c = document.getElementById('tv-cursor'); if (c) { c.style.left = `${x}px`; c.style.top = `${y}px`; } },
    ripple: () => { const r = document.getElementById('tv-ripple'); const s = read(); r.style.left = `${s.x}px`; r.style.top = `${s.y}px`; r.classList.remove('go'); r.offsetWidth; r.classList.add('go'); },
    highlight: (b) => { const h = document.getElementById('tv-hl'); if (!b) { h.style.opacity = '0'; return; } Object.assign(h.style, { left: `${b.x - 6}px`, top: `${b.y - 6}px`, width: `${b.width + 12}px`, height: `${b.height + 12}px`, opacity: '1' }); },
    modal: (question, answer) => { const m = document.getElementById('tv-modal'); if (question === null) { m.hidden = true; return; } m.hidden = false; m.querySelector('.q').textContent = question; m.querySelector('.a').textContent = answer; },
  };
};

/** The page around the phone: the app runs in an iframe of the size of a phone screen, captions on the right. */
const STAGE = (role, who) => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:radial-gradient(circle at 30% 40%,#134e4a,#0f172a 70%);font-family:'Noto Sans','Segoe UI',sans-serif;color:#fff;overflow:hidden}
  #phone{position:absolute;left:150px;top:24px;width:360px;height:640px;border:14px solid #111827;border-radius:42px;background:#fff;
    box-shadow:0 0 0 2px #374151,0 25px 60px rgba(0,0,0,.6);overflow:hidden}
  #phone iframe{width:360px;height:640px;border:0;display:block}
  #fx{position:absolute;left:164px;top:38px;width:360px;height:640px;border-radius:28px;overflow:hidden;pointer-events:none}
  #fx>div{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column}
  #cam{background:#000}
  #cam .ring{width:200px;height:200px;border-radius:50%;border:3px dashed rgba(255,255,255,.7);display:flex;align-items:center;justify-content:center;font-size:96px}
  #cam .lbl,#qr .lbl{margin-top:26px;font-size:16px;opacity:.85}
  #cam .flash{position:absolute;inset:0;background:#fff;opacity:0}
  #cam .flash.go{animation:fl .5s ease-out}
  @keyframes fl{from{opacity:.95}to{opacity:0}}
  #qr{background:rgba(0,0,0,.82)}
  #qr .win{position:relative;width:220px;height:220px;border:4px solid #5eead4;border-radius:18px;overflow:hidden}
  #qr .win:before{content:'';position:absolute;left:8%;right:8%;height:3px;background:#5eead4;box-shadow:0 0 12px #5eead4;animation:scan 1.1s ease-in-out infinite alternate}
  #qr .tag{position:absolute;inset:34px;background:repeating-conic-gradient(#fff 0 25%,#111 0 50%) 0 0/22px 22px;border-radius:6px;opacity:.9}
  @keyframes scan{from{top:6%}to{top:92%}}
  #panel{position:absolute;left:600px;top:70px;width:600px}
  #panel .role{display:inline-block;background:#0f766e;border-radius:999px;padding:6px 16px;font-size:16px;font-weight:700;letter-spacing:.04em}
  #panel .who{margin-top:10px;font-size:16px;opacity:.7}
  #panel-ch{margin-top:46px;font-size:18px;font-weight:700;color:#5eead4;text-transform:uppercase;letter-spacing:.06em;min-height:24px}
  #panel-text{margin-top:14px;font-size:30px;line-height:1.42;font-weight:500;min-height:300px}
  #panel .brand{position:absolute;top:560px;font-size:15px;opacity:.55}
</style></head><body>
  <div id="phone"><iframe id="app" src="/" allow="geolocation; camera"></iframe></div>
  <div id="fx"><div id="cam"><div class="ring">🙂</div><div class="lbl">Camera</div><div class="flash"></div></div>
    <div id="qr"><div class="win"><div class="tag"></div></div><div class="lbl">Đưa mã QR vào khung</div></div></div>
  <div id="panel"><span class="role">${role}</span><div class="who">${who}</div><div id="panel-ch"></div><div id="panel-text"></div>
    <div class="brand">🛡️ IntelShield · Hướng dẫn sử dụng</div></div>
</body></html>`;

export async function makePhotos(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
  const shots = {
    selfie: '<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:330px;background:linear-gradient(#bae6fd,#e0f2fe)">👮</div>',
    leak: '<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:200px;background:linear-gradient(#cbd5e1,#94a3b8)">🚰💧<div style="font-size:40px;font-family:sans-serif">Ảnh minh hoạ</div></div>',
    checkpoint: '<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:260px;background:linear-gradient(#fde68a,#fcd34d)">🚪</div>',
  };
  const files = {};
  for (const [name, html] of Object.entries(shots)) {
    await page.setContent(`<html><body style="margin:0;height:640px">${html}</body></html>`);
    files[name] = path.join(dir, `${name}.jpg`);
    await page.screenshot({ path: files[name], type: 'jpeg', quality: 85 });
  }
  await browser.close();
  return files;
}

export async function studio({ name, mobile = false, role, who, title, intro, geolocation }) {
  const browser = await chromium.launch();
  const recDir = path.join('/tmp/rec', name);
  fs.rmSync(recDir, { recursive: true, force: true });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    ...(QA ? {} : { recordVideo: { dir: recDir, size: { width: W, height: H } } }),
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    permissions: ['geolocation'],
    geolocation: geolocation ?? { latitude: 21.0294, longitude: 105.7781, accuracy: 8 },
  });
  await context.addInitScript(OVERLAY);
  const page = await context.newPage();
  page.setDefaultTimeout(QA ? 8_000 : 20_000);
  current = page;
  let chapter = '';
  let chapterNo = 0;
  if (QA) watch(page, () => `${name} › ${chapter || 'mở đầu'}`);

  const answers = [];
  let photo = null;
  page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept(answers.shift() ?? '') : d.accept()).catch(() => undefined));
  page.on('filechooser', (fc) => void fc.setFiles(photo).catch(() => undefined));

  const origin = mobile ? MOBILE : WEB;
  await page.route(`${origin}/__intro`, (r) => r.fulfill({ contentType: 'text/html', body: '<html><body style="background:#0f172a"></body></html>' }));
  if (mobile) await page.route(`${MOBILE}/__stage`, (r) => r.fulfill({ contentType: 'text/html', body: STAGE(role, who) }));
  await page.goto(`${origin}/__intro`);
  const tv = (fn, ...args) => page.evaluate(([f, a]) => window.__tv?.[f](...a), [fn, args]).catch(() => undefined);
  await page.waitForFunction(() => window.__tv);
  await tv('card', `<div class="logo">🛡️</div><div class="small">Hướng dẫn sử dụng IntelShield</div><div class="big">${title}</div><div class="small">${intro}</div>`);
  await sleep(500);

  const s = {
    page,
    /** The document the app lives in: the phone's iframe, or the page itself on the web. */
    app: mobile ? page.frameLocator('#app') : page,
    sleep,
    async start(url) {
      if (mobile) {
        await page.goto(`${MOBILE}/__stage`);
        await page.waitForFunction(() => window.__tv && document.getElementById('panel-text'));
        await tv('card', `<div class="logo">🛡️</div><div class="small">Hướng dẫn sử dụng IntelShield</div><div class="big">${title}</div><div class="small">${intro}</div>`);
      } else {
        await page.goto(`${WEB}${url}`);
      }
      await sleep(4500);
      await tv('card', '');
      await sleep(600);
    },
    chapter(text) {
      chapterNo += 1;
      chapter = `${chapterNo}. ${text}`;
    },
    /** A caption, held long enough to read. */
    async say(text, ms) {
      await tv('caption', chapter, text);
      await sleep(ms ?? Math.min(9_000, Math.max(2_600, 1_400 + text.length * 52)));
    },
    async point(locator, { hold = 250 } = {}) {
      await locator.scrollIntoViewIfNeeded().catch(() => undefined);
      const b = await locator.boundingBox();
      if (!b) return null;
      await tv('move', Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
      await sleep(750);
      await tv('ripple');
      await sleep(hold);
      return b;
    },
    async tap(locator, { wait = 900 } = {}) {
      await s.point(locator);
      await locator.click();
      await sleep(wait);
    },
    async type(locator, text, { delay = 55 } = {}) {
      await s.tap(locator, { wait: 200 });
      await locator.pressSequentially(text, { delay });
      await sleep(400);
    },
    async choose(locator, option) {
      await s.point(locator);
      await locator.selectOption(option);
      await sleep(900);
    },
    /** Picks the option whose text contains `text` (option labels often carry a code or client name first). */
    async chooseText(locator, text) {
      const option = locator.locator('option', { hasText: text }).first();
      await option.waitFor({ state: 'attached' });
      await s.choose(locator, await option.getAttribute('value'));
    },
    /** A yellow frame around something worth looking at, with a caption. */
    async show(locator, text, ms) {
      await locator.scrollIntoViewIfNeeded().catch(() => undefined);
      await sleep(300);
      const b = await locator.boundingBox();
      if (b) await tv('highlight', b);
      await s.say(text, ms);
      await tv('highlight', null);
      await sleep(350);
    },
    async scroll(dy, { x = mobile ? 330 : 760, y = mobile ? 360 : 400 } = {}) {
      await page.mouse.move(x, y);
      const steps = Math.max(1, Math.round(Math.abs(dy) / 40));
      for (let i = 0; i < steps; i += 1) {
        await page.mouse.wheel(0, Math.sign(dy) * 40);
        await sleep(28);
      }
      await sleep(600);
    },
    async scrollTop() {
      if (mobile) await page.frame({ url: /5173/ })?.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      else await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await sleep(700);
    },
    /** The next window.prompt answers with this; the box is drawn first so viewers see what is typed. */
    async prompt(question, answer, trigger) {
      await s.point(trigger);
      await tv('modal', question, '');
      for (let i = 1; i <= answer.length; i += 1) {
        await tv('modal', question, answer.slice(0, i));
        await sleep(45);
      }
      await sleep(900);
      await tv('modal', null);
      answers.push(answer);
      await trigger.click();
      await sleep(1200);
    },
    /** Phone camera stand-in: the viewfinder, the shutter, then the picture goes to the app's file input. */
    async camera(trigger, file, label = 'Camera') {
      photo = file;
      await s.point(trigger);
      if (mobile) {
        await page.evaluate((l) => { const c = document.getElementById('cam'); c.style.display = 'flex'; c.querySelector('.lbl').textContent = l; }, label);
        await sleep(1500);
        await page.evaluate(() => { const f = document.querySelector('#cam .flash'); f.classList.remove('go'); f.offsetWidth; f.classList.add('go'); });
        await sleep(450);
      }
      await trigger.click();
      await sleep(300);
      if (mobile) await page.evaluate(() => { document.getElementById('cam').style.display = 'none'; });
      await sleep(900);
    },
    /** QR scanner stand-in: the scanning window, then the tag's content is handed to the app. */
    async scan(trigger, payload) {
      await s.point(trigger);
      await page.evaluate(() => { document.getElementById('qr').style.display = 'flex'; });
      await sleep(1700);
      answers.push(payload);
      await trigger.click();
      await sleep(250);
      await page.evaluate(() => { document.getElementById('qr').style.display = 'none'; });
      await sleep(900);
    },
    setPosition: (lat, lng) => context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 6 }),
    /** The picture handed over when the app asks for one without a visible camera step (patrol photo checkpoints). */
    setPhoto: (file) => { photo = file; },
    /** Closing card, then the recording is encoded to out/<name>.mp4. */
    async end(text) {
      await tv('caption', '', '');
      await tv('card', `<div class="logo">✅</div><div class="big">${title}</div><div class="small">${text}</div>`);
      await sleep(5000);
      const video = page.video();
      await context.close();
      await browser.close();
      if (QA) {
        console.log(`✔ ${name}: chạy hết các bước`);
        return null;
      }
      const raw = await video.path();
      fs.mkdirSync(OUT, { recursive: true });
      const out = path.join(OUT, `${name}.mp4`);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.6', '-i', raw, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '25', '-movflags', '+faststart', out]);
      const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim());
      console.log(`✔ ${out} · ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`);
      return out;
    },
    /** A step that depends on earlier videos' data: skipped (with a log line) rather than failing the video. */
    async maybe(label, fn) {
      try {
        await fn();
      } catch (e) {
        console.warn(`  ↷ bỏ qua "${label}": ${String(e.message).split('\n')[0]}`);
        if (QA) issues.push({ where: `${name} › ${chapter}`, kind: 'bước bị bỏ qua', detail: `${label}: ${String(e.message).split('\n')[0]}` });
        await tv('modal', null);
        await tv('highlight', null);
      }
    },
  };
  return s;
}
