'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const CONFIG = {
  itemUrl: 'https://48.gnz48.com/pai/item/33444',
  auctionEnd: '2026-09-23T19:30:00+08:00',
  displaySeconds: 1,
  dataPollSeconds: 30,
  fullScanSecondsBeforeWindow: 60,
  recommendationWindowMinutes: 15,
  startingPrice: 98,
  minimumRaise: 5,
  // 用户指定排位偏好：9排、10排、8排、11排、7排、12排；每排只取中间区域。
  safeBands: [
    { min: 33, max: 42, label: '9排中间（排名33–42，首选）' },
    { min: 57, max: 66, label: '10排中间（排名57–66）' },
    { min: 17, max: 26, label: '8排中间（排名17–26）' },
    { min: 83, max: 92, label: '11排中间（排名83–92）' },
    { min: 1, max: 10, label: '7排中间（排名1–10）' },
    { min: 109, max: 118, label: '12排中间（排名109–118）' },
  ],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForTimerOrManual(controls, ms) {
  return new Promise((resolve) => {
    let timer;
    const finish = (reason) => {
      if (timer) clearTimeout(timer);
      if (controls.manualWake === wake) controls.manualWake = null;
      resolve(reason);
    };
    const wake = () => finish('manual');
    controls.manualWake = wake;
    timer = setTimeout(() => finish('timer'), ms);
    if (controls.manualRefreshRequested) wake();
  });
}

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireSingleInstanceLock() {
  const lockPath = path.join(os.tmpdir(), 'gnz48-auction-monitor.lock');
  if (fs.existsSync(lockPath)) {
    const existingPid = Number(fs.readFileSync(lockPath, 'utf8').trim());
    if (processIsRunning(existingPid)) {
      throw new Error(`已有监控实例正在运行（PID ${existingPid}）。请使用现有窗口，不要重复启动。`);
    }
    fs.rmSync(lockPath, { force: true });
  }

  fs.writeFileSync(lockPath, String(process.pid), 'utf8');
  const cleanup = () => {
    try {
      if (fs.readFileSync(lockPath, 'utf8').trim() === String(process.pid)) {
        fs.rmSync(lockPath, { force: true });
      }
    } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => process.exit(130));
  process.on('SIGTERM', () => process.exit(143));
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

function normalizeTime(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function deduplicateBids(rows) {
  const best = new Map();
  for (const row of rows) {
    if (!row.bidder || !Number.isFinite(row.price)) continue;
    const prior = best.get(row.bidder);
    if (
      !prior ||
      row.price > prior.price ||
      (row.price === prior.price && normalizeTime(row.time) < normalizeTime(prior.time))
    ) {
      best.set(row.bidder, { ...row, time: normalizeTime(row.time) });
    }
  }
  return [...best.values()].sort((a, b) => {
    if (b.price !== a.price) return b.price - a.price;
    return normalizeTime(a.time).localeCompare(normalizeTime(b.time));
  });
}

function priceDistribution(ranked) {
  const exact = new Map();
  for (const row of ranked) {
    exact.set(row.price, (exact.get(row.price) || 0) + 1);
  }

  const exactEntries = [...exact.entries()].sort((a, b) => b[0] - a[0]);
  const exactText = exactEntries
    .map(([price, count]) => `¥${price}×${count}`)
    .join(' | ') || '暂无出价';

  const ranges = [
    { label: '≤98', min: -Infinity, max: 98 },
    { label: '99–110', min: 99, max: 110 },
    { label: '111–120', min: 111, max: 120 },
    { label: '121–130', min: 121, max: 130 },
    { label: '131–140', min: 131, max: 140 },
    { label: '141–150', min: 141, max: 150 },
    { label: '151–175', min: 151, max: 175 },
    { label: '176–200', min: 176, max: 200 },
    { label: '>200', min: 200, max: Infinity, exclusiveMin: true },
  ];
  const rangeText = ranges.map((range) => {
    const count = ranked.filter((row) => {
      const aboveMin = range.exclusiveMin ? row.price > range.min : row.price >= range.min;
      return aboveMin && row.price <= range.max;
    }).length;
    return `${range.label}:${count}人`;
  }).join(' | ');

  return {
    exactText,
    rangeText,
    exact: exactEntries.map(([price, count]) => ({ price, count })),
  };
}

function currentUserSummary(ranked, username) {
  const index = ranked.findIndex((row) => row.bidder === username);
  if (index < 0) return '你的出价：尚未出价或账号名未匹配；当前排名：—';
  const rank = index + 1;
  const row = ranked[index];
  const band = bandForRank(rank);
  return `你的最高出价：¥${row.price}；当前排名：第${rank}名；位置：${band ? band.label : '不在目标中间区间'}`;
}

function compressPrices(prices) {
  if (!prices.length) return [];
  const intervals = [];
  let start = prices[0];
  let end = prices[0];
  for (const price of prices.slice(1)) {
    if (price === end + 1) {
      end = price;
    } else {
      intervals.push({ min: start, max: end });
      start = price;
      end = price;
    }
  }
  intervals.push({ min: start, max: end });
  return intervals;
}

function targetPriceBands(ranked, username) {
  const current = ranked.find((row) => row.bidder === username);
  const currentIndex = ranked.findIndex((row) => row.bidder === username);
  const currentRank = currentIndex >= 0 ? currentIndex + 1 : null;
  const actionableMin = current
    ? Math.max(CONFIG.startingPrice, current.price + CONFIG.minimumRaise)
    : CONFIG.startingPrice;
  const highest = ranked[0]?.price ?? CONFIG.startingPrice;
  const dynamicCeiling = Math.max(actionableMin, highest + CONFIG.minimumRaise);

  return CONFIG.safeBands.map((band, index) => {
    const candidates = [];
    for (let price = actionableMin; price <= dynamicCeiling; price += 1) {
      const rank = estimatedRankForPrice(price, ranked, username);
      if (rank >= band.min && rank <= band.max) candidates.push({ price, rank });
    }

    const prices = candidates.map((item) => item.price);
    const bufferedTargetRank = band.min + Math.floor((band.max - band.min) / 3);
    const bufferedCandidates = candidates.filter((item) => item.rank <= bufferedTargetRank);
    const stable = bufferedCandidates[0] || candidates
      .slice()
      .sort((a, b) => Math.abs(a.rank - bufferedTargetRank) - Math.abs(b.rank - bufferedTargetRank) || a.price - b.price)[0] || null;
    const holding = current && currentRank >= band.min && currentRank <= band.max
      ? { price: current.price, rank: currentRank, buffer: band.max - currentRank, hold: true }
      : null;

    const observed = ranked.slice(band.min - 1, band.max);
    const observedCounts = new Map();
    for (const row of observed) {
      observedCounts.set(row.price, (observedCounts.get(row.price) || 0) + 1);
    }
    const observedDistribution = [...observedCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([price, count]) => ({ price, count }));

    return {
      label: band.label,
      minRank: band.min,
      maxRank: band.max,
      priority: index + 1,
      intervals: compressPrices(prices),
      observedDistribution,
      observedCount: observed.length,
      stableRecommendation: holding || (stable ? {
        price: stable.price,
        rank: stable.rank,
        buffer: band.max - stable.rank,
        hold: false,
      } : null),
    };
  });
}

function dashboardData(ranked, username, scanMeta = null, ended = false) {
  const currentIndex = ranked.findIndex((row) => row.bidder === username);
  const current = currentIndex >= 0 ? ranked[currentIndex] : null;
  const currentRank = currentIndex >= 0 ? currentIndex + 1 : null;
  const currentBand = currentRank ? bandForRank(currentRank) : null;
  const recommendation = ended
    ? { action: 'ended', message: '竞价已结束；以下是按最终出价记录估算的排名。' }
    : recommendBid(ranked, username);
  const distribution = priceDistribution(ranked);
  return {
    updatedAt: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    scanMeta,
    ended,
    bidderCount: ranked.length,
    highestPrice: ranked[0]?.price ?? CONFIG.startingPrice,
    current: {
      price: current?.price ?? null,
      rank: currentRank,
      band: currentBand?.label ?? null,
    },
    recommendation: {
      action: recommendation.action,
      price: recommendation.price ?? null,
      rank: recommendation.rank ?? recommendation.currentRank ?? null,
      message: recommendation.message,
    },
    priceMin: CONFIG.startingPrice,
    priceMax: ranked[0]?.price ?? CONFIG.startingPrice,
    targetBands: targetPriceBands(ranked, username),
    exactDistribution: distribution.exact,
  };
}

async function updateDashboard(page, ranked, username, scanMeta, ended = false) {
  if (!page || page.isClosed()) return;
  const data = dashboardData(ranked, username, scanMeta, ended);
  await page.evaluate((payload) => {
    if (typeof window.updateAuctionDashboard === 'function') {
      window.updateAuctionDashboard(payload);
    }
  }, data);
}

async function setDashboardRefreshStatus(page, text, done = false) {
  if (!page || page.isClosed()) return;
  await page.evaluate(({ statusText, isDone }) => {
    if (typeof window.setManualRefreshStatus === 'function') {
      window.setManualRefreshStatus(statusText, isDone);
    }
  }, { statusText: text, isDone: done }).catch(() => {});
}

function bandForRank(rank) {
  return CONFIG.safeBands.find((band) => rank >= band.min && rank <= band.max) || null;
}

function estimatedRankForPrice(price, ranked, username) {
  // 保守估算：新出同价时排在已有同价者之后。
  const others = ranked.filter((row) => row.bidder !== username);
  return 1 + others.filter((row) => row.price >= price).length;
}

function recommendBid(ranked, username) {
  const currentIndex = ranked.findIndex((row) => row.bidder === username);
  const current = currentIndex >= 0 ? ranked[currentIndex] : null;
  const currentRank = current ? currentIndex + 1 : null;
  const currentBand = currentRank ? bandForRank(currentRank) : null;

  if (current && currentBand) {
    return {
      action: 'hold',
      current,
      currentRank,
      band: currentBand,
      message: `当前第 ${currentRank} 名，位于 ${currentBand.label}；建议暂不加价。`,
    };
  }

  const minimum = current
    ? Math.max(CONFIG.startingPrice, current.price + CONFIG.minimumRaise)
    : CONFIG.startingPrice;

  const ceiling = Math.max(minimum, (ranked[0]?.price ?? CONFIG.startingPrice) + CONFIG.minimumRaise);
  const search = () => {
    for (const band of CONFIG.safeBands) {
      const candidates = [];
      for (let price = minimum; price <= ceiling; price += 1) {
        const rank = estimatedRankForPrice(price, ranked, username);
        if (rank >= band.min && rank <= band.max) {
          candidates.push({ price, rank });
        }
      }
      if (candidates.length) {
        const bufferedTargetRank = band.min + Math.floor((band.max - band.min) / 3);
        const stable = candidates.find((item) => item.rank <= bufferedTargetRank) || candidates
          .slice()
          .sort((a, b) => Math.abs(a.rank - bufferedTargetRank) - Math.abs(b.rank - bufferedTargetRank) || a.price - b.price)[0];
        return { price: stable.price, rank: stable.rank, band };
      }
    }
    return null;
  };

  const recommendation = search();
  if (recommendation) {
    return {
      action: 'recommend',
      current,
      currentRank,
      ...recommendation,
      message: `稳健建议价 ¥${recommendation.price}，保守估算第 ${recommendation.rank} 名，目标 ${recommendation.band.label}。`,
    };
  }

  return {
    action: 'stop',
    current,
    currentRank,
    message: '当前数据下未找到可进入目标区间的有效价格，建议继续观察。',
  };
}

async function readPager(page) {
  const pager = page.locator('.pageShowB, .jl_page').filter({ has: page.locator('#a_b_n') }).first();
  if ((await pager.count()) === 0) return { current: 1, total: 1, text: '1 / 1' };
  return pager.evaluate((el) => {
    const text = el.innerText || '';
    const currentNode = el.querySelector('.b_n');
    const totalNode = el.querySelector('.b_c');
    const match = text.match(/(\d+)\s*\/\s*(\d+)/);
    const current = Number(currentNode?.textContent?.trim() || match?.[1] || 1);
    const total = Number(totalNode?.textContent?.trim() || match?.[2] || 1);
    return { current, total, text };
  });
}

async function waitForPagerChange(page, previousPage) {
  await page.waitForFunction(
    (oldPage) => {
      const current = Number(document.querySelector('.pageShowB .b_n, .jl_page .b_n')?.textContent?.trim() || 1);
      return current !== oldPage;
    },
    previousPage,
    { timeout: 10000 },
  ).catch(() => {});
  await sleep(100);
}

async function goToFirstBidPage(page) {
  for (let i = 0; i < 40; i += 1) {
    const pager = await readPager(page);
    if (pager.current <= 1) return;
    const prev = page.locator('#a_b_u');
    if ((await prev.count()) === 0) return;
    await prev.click();
    await waitForPagerChange(page, pager.current);
  }
}

async function readCurrentBidRows(page) {
  return page.locator('#u_blist li, #u_blistM li').evaluateAll((nodes) => nodes.map((node) => {
    const values = [...node.querySelectorAll('span')].map((span) => (span.innerText || '').trim());
    if (values.length < 4 || values[0] === '状态') return null;
    const price = Number(String(values[3]).replace(/[^0-9.]/g, ''));
    return {
      status: values[0],
      bidder: values[1],
      time: values[2],
      price,
    };
  }).filter(Boolean));
}

async function collectAllBidRows(page, onProgress = null) {
  await page.waitForFunction(
    () => document.querySelectorAll('#u_blist li, #u_blistM li').length > 0,
    null,
    { timeout: 10000 },
  );
  await goToFirstBidPage(page);
  const rows = [];
  let pager = await readPager(page);
  const total = Math.max(1, Math.min(pager.total, 50));
  let pagesRead = 0;

  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    rows.push(...await readCurrentBidRows(page));
    pagesRead += 1;
    if (onProgress) await onProgress({ page: pagesRead, total, rawRows: rows.length });
    pager = await readPager(page);
    if (pager.current >= total || pageNumber >= total) break;
    const next = page.locator('#a_b_n');
    if ((await next.count()) === 0) {
      throw new Error(`出价记录显示共${total}页，但未找到第${pager.current + 1}页按钮。`);
    }
    const previousPage = pager.current;
    await next.click();
    await waitForPagerChange(page, previousPage);
    const advanced = await readPager(page);
    if (advanced.current <= previousPage) {
      throw new Error(`出价记录翻页失败：仍停留在第${previousPage}/${total}页，已停止本轮排名计算以避免误导。`);
    }
  }

  await goToFirstBidPage(page);
  if (rows.length === 0) throw new Error('出价记录尚未加载，拒绝使用空列表计算排名。');
  rows.scanMeta = { pagesRead, totalPages: total, rawRows: rows.length };
  return rows;
}

async function accountName(page) {
  const body = await page.locator('body').innerText();
  const match = body.match(/你好\s*([^\s退出]+)/);
  return match ? match[1].trim() : '';
}

async function pageStatus(page) {
  const body = await page.locator('body').innerText();
  const captcha = await page.locator('.tCaptchaDyMainWrap').isVisible().catch(() => false);
  return {
    body,
    captcha,
    loggedOut: page.url().includes('/Login/') || !body.includes('你好'),
    ended: body.includes('竞价状态：') && body.includes('已结束'),
  };
}

function summaryFromText(body) {
  const highest = Number(body.match(/当前最高价格：￥\s*(\d+(?:\.\d+)?)/)?.[1] || 0);
  const participants = Number(body.match(/(\d+)\s*人参与竞价/)?.[1] || 0);
  return { highest, participants };
}

async function localPageSignature(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    const price = text.match(/当前最高价格：￥\s*(\d+(?:\.\d+)?)/)?.[1] || '';
    const people = text.match(/(\d+)\s*人参与竞价/)?.[1] || '';
    const records = [...document.querySelectorAll('#u_blist li, #u_blistM li')]
      .map((row) => (row.innerText || '').trim().replace(/\s+/g, ' '))
      .join('|');
    return `${price}::${people}::${records}`;
  });
}

function timeRemaining() {
  return new Date(CONFIG.auctionEnd).getTime() - Date.now();
}

function formatRemaining(ms) {
  if (ms <= 0) return '已到结束时间';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
}

async function waitForPageChange(page, previousSignature, controls) {
  for (let elapsed = 0; elapsed < CONFIG.dataPollSeconds; elapsed += CONFIG.displaySeconds) {
    const signal = await waitForTimerOrManual(controls, CONFIG.displaySeconds * 1000);
    if (signal === 'manual' || controls.manualRefreshRequested) {
      controls.manualRefreshRequested = false;
      controls.manualRefreshInProgress = true;
      process.stdout.write('\n[手动刷新] 正在刷新主页面并重新读取全部分页...\n');
      await setDashboardRefreshStatus(controls.dashboardPage, '正在加载主页面…');
      await page.goto(CONFIG.itemUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await setDashboardRefreshStatus(controls.dashboardPage, '准备读取全部分页…');
      return 'manual-refresh';
    }
    const untilScan = Math.max(0, CONFIG.dataPollSeconds - elapsed - CONFIG.displaySeconds);
    const nextSignature = await localPageSignature(page).catch(() => previousSignature);
    const changed = nextSignature !== previousSignature;
    const line = changed
      ? `[每秒状态] 检测到网站数据变化，准备重新计算排名...`
      : `[每秒状态] 距结束：${formatRemaining(timeRemaining())}；最长等待：${untilScan}秒`;
    process.stdout.write(`\r${line.padEnd(90, ' ')}`);
    if (changed) {
      process.stdout.write('\n');
      return 'changed';
    }
  }
  process.stdout.write('\n[定时同步] 30秒内未检测到本地变化，刷新主页面获取服务器最新数据...\n');
  await page.goto(CONFIG.itemUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const refreshedSignature = await localPageSignature(page).catch(() => '');
  if (refreshedSignature !== previousSignature) {
    console.log('[定时同步] 服务器数据有变化，准备更新完整排名。');
    return 'refreshed-changed';
  }
  console.log('[定时同步] 主页面数据未变化。');
  return 'refreshed-same';
}

async function monitor(context, page, username, dashboardPage, controls) {
  console.log('\n开始只读监控。按 Ctrl+C 可随时停止；脚本不会自动出价。\n');
  let ranked = [];
  let lastScanMeta = null;
  let lastFullScanAt = 0;
  let forceFullScan = true;
  while (true) {
    try {
    const now = new Date();
    const status = await pageStatus(page);
    const remaining = timeRemaining();

    console.log(`\n[${now.toLocaleTimeString('zh-CN', { hour12: false })}] 距结束：${formatRemaining(remaining)}`);

    if (status.loggedOut) {
      console.log('需要登录：请在 Edge 中手动登录，然后回到这里等待下一轮。');
    } else if (status.captcha) {
      console.log('检测到滑块验证：请你在 Edge 中手动完成，脚本不会代做。');
    } else {
      if (status.ended || remaining <= 0) {
        console.log('竞价已结束，读取最终出价记录。');
        const finalRows = await collectAllBidRows(page);
        ranked = deduplicateBids(finalRows);
        lastScanMeta = finalRows.scanMeta;
        await updateDashboard(dashboardPage, ranked, username, lastScanMeta, true);
        await setDashboardRefreshStatus(dashboardPage, '竞价已结束', false);
        console.log(`[最终记录] 已读取 ${lastScanMeta.pagesRead}/${lastScanMeta.totalPages} 页；原始 ${lastScanMeta.rawRows} 条；去重 ${ranked.length} 人。`);
        break;
      }

      const inRecommendationWindow = remaining <= CONFIG.recommendationWindowMinutes * 60 * 1000;
      const fullScanInterval = inRecommendationWindow
        ? CONFIG.dataPollSeconds * 1000
        : CONFIG.fullScanSecondsBeforeWindow * 1000;
      const shouldFullScan = forceFullScan || Date.now() - lastFullScanAt >= fullScanInterval;

      if (shouldFullScan) {
        const onProgress = controls.manualRefreshInProgress
          ? async (progress) => setDashboardRefreshStatus(
            controls.dashboardPage,
            `正在读取第 ${progress.page}/${progress.total} 页…`,
          )
          : null;
        const rows = await collectAllBidRows(page, onProgress);
        ranked = deduplicateBids(rows);
        lastScanMeta = rows.scanMeta;
        lastFullScanAt = Date.now();
        forceFullScan = false;
        console.log(`[分页校验] 已读取 ${lastScanMeta.pagesRead}/${lastScanMeta.totalPages} 页；原始记录 ${lastScanMeta.rawRows} 条；去重后 ${ranked.length} 人。`);
      }

      const pageSummary = summaryFromText(status.body);
      const top = ranked[0]?.price ?? pageSummary.highest ?? CONFIG.startingPrice;
      const distribution = priceDistribution(ranked);
      console.log(`去重竞拍者：${ranked.length}人；当前最高价：¥${top || 0}${shouldFullScan ? '（完整排名已同步）' : '（沿用最近完整排名）'}`);
      console.log(currentUserSummary(ranked, username));
      console.log(`价格区间：${distribution.rangeText}`);
      console.log(`具体价位：${distribution.exactText}`);
      await updateDashboard(dashboardPage, ranked, username, lastScanMeta);
      if (controls.manualRefreshInProgress && !controls.manualRefreshRequested) {
        controls.manualRefreshInProgress = false;
        await setDashboardRefreshStatus(dashboardPage, '立即刷新', true);
      }

      if (inRecommendationWindow) {
        const recommendation = recommendBid(ranked, username);
        console.log(recommendation.message);
        console.log('提示：这是按当前记录和同价后出者靠后计算的估算，不保证最终座位。');
      } else {
        console.log(`距离结束超过${CONFIG.recommendationWindowMinutes}分钟：继续观察，暂不建议出价。`);
      }
    }

    const signature = await localPageSignature(page).catch(() => '');
    const change = await waitForPageChange(page, signature, controls);
    forceFullScan = change !== 'refreshed-same';
    } catch (error) {
      console.error(`[监控恢复] ${error.message}；正在重新打开竞价页面。`);
      await setDashboardRefreshStatus(dashboardPage, '页面连接中断，正在重连…');
      page = await context.newPage();
      await page.goto(CONFIG.itemUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      forceFullScan = true;
      await sleep(500);
    }
  }
}

function selfTest() {
  const synthetic = [];
  for (let i = 0; i < 82; i += 1) {
    synthetic.push({ bidder: `user-${i + 1}`, price: 200 - i, time: `2026/09/23 19:00:${String(i % 60).padStart(2, '0')}` });
  }
  const ranked = deduplicateBids(synthetic);
  const rec = recommendBid(ranked, 'me');
  const distribution = priceDistribution(ranked);
  if (!ranked.length || !rec || !rec.message || !distribution.exactText || !distribution.rangeText) {
    throw new Error('自检失败');
  }
  console.log('自检通过：排名去重与建议逻辑可运行。');
}

async function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  acquireSingleInstanceLock();

  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  if (!fs.existsSync(edgePath)) {
    throw new Error(`找不到 Microsoft Edge：${edgePath}`);
  }

  const base = process.env.LOCALAPPDATA || __dirname;
  const profileDir = path.join(base, 'GNZ48AuctionMonitor', 'edge-profile');
  fs.mkdirSync(profileDir, { recursive: true });

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: edgePath,
      headless: false,
      viewport: null,
      args: ['--start-maximized'],
    });
  } catch (error) {
    const detail = String(error?.message || error);
    if (/existing browser|ProcessSingleton|Target page, context or browser has been closed/i.test(detail)) {
      throw new Error('专用 Edge 登录配置正被另一个监控窗口占用。请关闭旧的监控 Edge 和命令窗口，然后只启动一次 start.cmd。');
    }
    throw error;
  }

  let page = context.pages()[0] || await context.newPage();
  const itemPage = context.pages().find((candidate) => /48\.gnz48\.com\/pai\/item\//i.test(candidate.url()));
  if (itemPage) page = itemPage;
  await page.goto(CONFIG.itemUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const dashboardPath = path.join(__dirname, 'dashboard.html');
  let dashboardPage = context.pages().find((candidate) => candidate.url() === pathToFileURL(dashboardPath).href);
  if (!dashboardPage) dashboardPage = await context.newPage();
  await dashboardPage.goto(pathToFileURL(dashboardPath).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const controls = {
    manualRefreshRequested: false,
    manualRefreshInProgress: false,
    manualWake: null,
    dashboardPage,
  };
  await dashboardPage.exposeFunction('requestAuctionRefresh', () => {
    controls.manualRefreshRequested = true;
    if (controls.manualWake) controls.manualWake();
    return { accepted: true };
  });

  console.log('Edge 已打开竞价页面。');
  let username = await accountName(page);
  if (username) {
    console.log('检测到已保存的登录状态，自动开始监控。');
  } else {
    console.log('请手动完成登录和滑块验证；脚本不会读取或保存你的密码。');
    await ask('完成后按 Enter 继续：');
    username = await accountName(page);
  }
  if (!username) username = await ask('未能自动识别账号名，请输入页面“你好”后显示的账号名：');
  console.log(`已识别监控账号：${username}`);

  await monitor(context, page, username, dashboardPage, controls);
  await ask('监控结束。按 Enter 关闭此窗口（Edge 会保留登录配置）：');
  await context.close();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('\n运行失败：', error.message);
    console.error('请保留此窗口并根据 README.md 排查。');
    process.exitCode = 1;
  });
}

module.exports = {
  deduplicateBids,
  priceDistribution,
  currentUserSummary,
  estimatedRankForPrice,
  recommendBid,
  targetPriceBands,
  dashboardData,
  collectAllBidRows,
};
