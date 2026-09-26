'use strict';

// One normal password-login attempt; no browser, retries, or saved session file.
const fs = require('node:fs');
const path = require('node:path');
const { request } = require('playwright-core');

const LOGIN_ORIGIN = 'https://user.gnz48.com';
const ITEM_URL = 'https://48.gnz48.com/pai/item/33444';
const LOGIN_URL = `${LOGIN_ORIGIN}/Login/index.html?return_url=${ITEM_URL}`;
const ALLOWED_HOSTS = new Set(['user.gnz48.com', '48.gnz48.com']);

function fail(message) {
  const error = new Error(message);
  error.safeToShow = true;
  throw error;
}

function allowedUrl(value, base = LOGIN_URL) {
  const url = new URL(value.replace(/&amp;/g, '&'), base);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) ||
      url.username || url.password || (url.port && url.port !== '443')) {
    fail('登录流程要求其他地址，请在官网手动确认；脚本已停止。');
  }
  return url.href;
}

async function getPage(context, target) {
  let url = allowedUrl(target);
  for (let hop = 0; hop < 6; hop++) {
    const response = await context.get(url, { maxRedirects: 0 });
    try {
    if ([301, 302, 303, 307, 308].includes(response.status())) {
      const location = response.headers().location;
      if (!location) fail('网站跳转缺少地址，已停止。');
      url = allowedUrl(location, url);
      continue;
    }
    if (!response.ok()) fail(`页面请求失败（HTTP ${response.status()}），未自动重试。`);
    return { url, html: await response.text(), serverDate: response.headers().date };
    } finally { await response.dispose(); }
  }
  fail('网站跳转次数异常，已停止。');
}

function failureReason(data) {
  const status = String(data.status ?? '');
  if (status === '1011') return '网站要求改用短信验证，请在官网手动完成。';
  if (['101', '102', '103', '11', '22', '99', '10'].includes(status)) {
    return '网站要求处理账号提示或补充认证，请在官网查看；未自动继续。';
  }
  const description = typeof data.desc === 'string' ? data.desc : '';
  if (/验证码|滑块|人机|captcha/i.test(description)) return '网站要求验证，请在官网手动完成。';
  if (/密码|用户名|账号|帐号/.test(description)) return '账号密码登录未通过，请在官网核对账号状态和本地配置。';
  return '网站未确认登录成功；已停止，不会连续尝试。';
}

async function login({ log = () => {} } = {}) {
  // Never put account values, cookies, response bodies, or query tokens in logs.
  let account;
  try {
    account = JSON.parse(fs.readFileSync(path.join(__dirname, 'account.local.json'), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    fail('无法读取 account.local.json，请确认文件存在且 JSON 格式正确。');
  }
  if (typeof account.username !== 'string' || !account.username.trim() ||
      typeof account.password !== 'string' || !account.password) {
    fail('请先在 account.local.json 中填写 username 和 password。');
  }

  const context = await request.newContext({ timeout: 15000 });
  try {
    const page = await getPage(context, LOGIN_URL);
    if (!/id=["']regForm["']/.test(page.html) || !/doLogin\(\)/.test(page.html)) {
      fail('未找到预期的密码登录表单，未提交账号密码。');
    }
    const script = await getPage(context, `${LOGIN_ORIGIN}/Public/js/login.js`);
    const handler = script.html.slice(script.html.indexOf('function doLogin('));
    if (!handler.includes('/QuickLogin/login/')) fail('网站登录流程已变化，未提交账号密码。');

    log('正在通过账号密码入口登录（仅尝试一次）……');
    const started = performance.now();
    const response = await context.post(`${LOGIN_ORIGIN}/QuickLogin/login/`, {
      maxRedirects: 0,
      headers: { Origin: LOGIN_ORIGIN, Referer: LOGIN_URL, 'X-Requested-With': 'XMLHttpRequest' },
      // The website serializes both forms; unused SMS fields are empty.
      form: { phone: '', phonecode: '', login_type: '', area: '', preg: '',
        username: account.username, password: account.password },
    });
    account = null;
    if (!response.ok()) fail(`登录请求未成功（HTTP ${response.status()}），未自动重试。`);
    let data;
    try { data = await response.json(); } catch { fail('登录返回格式异常；未输出响应内容，未重试。'); }
    finally { await response.dispose(); }
    if (!data || String(data.status) !== '1') fail(failureReason(data || {}));
    log(`密码登录接口已确认成功，耗时 ${Math.round(performance.now() - started)} 毫秒。`);

    // The official success handler loads SSO script URLs. Request only the two
    // relevant GNZ48 hosts over HTTPS, and never evaluate returned JavaScript.
    const sources = [...String(data.desc || '').matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)];
    let synced = 0;
    for (const match of sources) {
      let url;
      try { url = new URL(match[1].replace(/&amp;/g, '&'), LOGIN_URL); } catch { continue; }
      if (!ALLOWED_HOSTS.has(url.hostname)) continue;
      await getPage(context, allowedUrl(url.href));
      synced++;
    }
    data = null;

    const item = await getPage(context, ITEM_URL);
    const isLoginPage = /\/Login(?:\/|$)/i.test(new URL(item.url).pathname) || /id=["']regForm["']/.test(item.html);
    const authenticated = !isLoginPage && /你好/.test(item.html) && /退出/.test(item.html);
    const verification = {
      passwordLoginAccepted: true,
      auctionSessionVerified: authenticated,
      returnedToLoginPage: isLoginPage,
      loginSyncRequests: synced,
      auctionContentPresent: /出价记录/.test(item.html),
      totalLoginAndVerificationMs: Math.round(performance.now() - started),
      browserStarted: false,
      sessionSavedToDisk: false,
    };
    if (!authenticated) fail('密码已被接受，但尚未确认竞价站点的登录状态；不能据此宣称爬虫已可用。');
    return { context, item, verification };
  } catch (error) {
    await context.dispose();
    throw error;
  } finally {
    account = null;
  }
}

async function main() {
  const session = await login({ log: console.log });
  try {
    console.log(JSON.stringify(session.verification, null, 2));
    console.log('验证成功：纯 HTTP 登录后已读取到竞价页的登录状态。未提交出价；测试会话仅存在于本进程。');
  } finally { await session.context.dispose(); }
}

if (require.main === module) {
  main().catch(error => {
    // HTTP client errors may contain request details: do not print raw errors.
    console.error(error.safeToShow ? error.message : '请求超时或连接失败，未输出请求详情；未自动重试。');
    process.exitCode = 1;
  });
}

module.exports = { allowedUrl, failureReason, login, getPage, fail, ITEM_URL };
