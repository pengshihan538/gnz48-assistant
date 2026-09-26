'use strict';

const readline = require('node:readline');
const { login, getPage, fail, ITEM_URL } = require('./http-login');
const { buildSnapshot } = require('./auction-core');
const { fetchCatalog } = require('./auction-catalog');
const { decodeHtmlEntities } = require('./html-text');
const ORIGIN = 'https://48.gnz48.com';
const ITEM_ID = 33444;

function decode(s) {
  return decodeHtmlEntities(s);
}

function hidden(html,id) {
  const input = [...html.matchAll(/<input\b[^>]*>/gi)].map(m=>m[0]).find(tag=>
    new RegExp(`\\bid=["']${id}["']`,'i').test(tag));
  return decode(input?.match(/\bvalue=["']([^"']*)["']/i)?.[1] || '');
}

function parseItem(html, itemId=ITEM_ID) {
  const username = hidden(html,'hid_user');
  if (!username || !/你好/.test(html) || !/退出/.test(html)) fail('登录状态已失效，请关闭后重新打开程序；未自动重试密码。');
  if (hidden(html,'hid_isp').toLowerCase()==='true') fail('网站隐藏了竞拍者身份，无法可靠去重排名，已停止计算。');
  const state = Number(html.match(/var\s+Coudown\s*=\s*(\d+)/)?.[1]);
  if (![0,1,2].includes(state)) fail('无法确认竞价状态，保留上次完整数据。');
  const startingPrice = Number(html.match(/id=["']sp_start_price["'][^>]*>\s*([\d.]+)/)?.[1]);
  const minimumRaise = Number(html.match(/var\s+markupPrice\s*=\s*([\d.]+)/)?.[1]);
  if (!Number.isFinite(startingPrice) || startingPrice<0 || !(minimumRaise>0)) fail('无法确认起拍价或加价规则，停止计算建议。');
  return {username,ended:state===2,notStarted:state===0,startingPrice,minimumRaise,
    title:decode(html.match(/<title>([^<]*)<\/title>/i)?.[1] || 'GNZ48 竞价'),itemId};
}

function parseBidPage(data, expectedPage) {
  if (!data || !Object.hasOwn(data,'list')) fail('分页响应不是预期的记录数据，保留上次完整数据。');
  let list = data.list;
  if (list === '' || list === null) list = [];
  const page = Number(data.pageNum), rawPages = Number(data.PageCount);
  if (!Array.isArray(list) || !Number.isInteger(rawPages) || rawPages<0 || rawPages>500 ||
      (!list.length && rawPages>1) || (list.length && rawPages<1) ||
      (page!==expectedPage && !(expectedPage===1&&page===0&&list.length===0))) fail('分页编号或页数异常，未更新排名。');
  const rows = list.map(row=>{
    const bidder = String(row.user_name || '');
    const price = Number(row.bid_amt);
    const timeMs = Number(String(row.bid_time).match(/^\/Date\((\d+)(?:[+-]\d{4})?\)\/$/)?.[1]);
    if (!bidder || bidder==='***' || !Number.isFinite(price) || price<0 || !Number.isFinite(timeMs)) fail('记录包含无法识别的账号、价格或时间，未更新排名。');
    return {bidder,price,timeMs};
  });
  const totalPages = Math.max(1,rawPages);
  if (rows.length>20 || (expectedPage<totalPages && rows.length!==20)) fail('分页记录不完整，未更新排名。');
  if (!rows.length && Number(data.viewPrice)>0) fail('返回空记录但最高价不为空，拒绝据此推荐。');
  return {rows,totalPages,page:expectedPage,viewPrice:Number(data.viewPrice)||0};
}

async function readBidPage(context, page, itemId=ITEM_ID) {
  const response = await context.post(`${ORIGIN}/pai/GetShowBids`,{
    timeout:8000,maxRedirects:0,
    headers:{Origin:ORIGIN,Referer:`${ORIGIN}/pai/item/${itemId}`,'X-Requested-With':'XMLHttpRequest'},
    form:{id:itemId,numPerPage:20,pageNum:page===1?0:page,r:Math.random()},
  });
  try {
    if ([301,302,401,403].includes(response.status())) fail('登录状态失效或网站要求验证，请在官网查看；保留上次数据。');
    if (response.status()===429) fail('网站暂时限制请求，已延长等待时间；保留上次数据。');
    if (!response.ok()) fail(`读取分页失败（HTTP ${response.status()}），保留上次数据。`);
    let data;
    try {data=await response.json();} catch {fail('分页未返回 JSON，可能需要重新登录；保留上次数据。');}
    return parseBidPage(data,page);
  } finally {await response.dispose();}
}

async function collectPages(read, progress=()=>{}) {
  const started=performance.now();
  const first=await read(1);
  const rows=[...first.rows];
  progress(1,first.totalPages);
  for(let page=2;page<=first.totalPages;page++) {
    if(performance.now()-started>40000) fail('完整采集超过 40 秒，已停止本轮；保留上次完整数据。');
    const next=await read(page);
    if(next.totalPages!==first.totalPages) fail('采集中页数发生变化，等待下一次完整刷新。');
    rows.push(...next.rows);progress(page,first.totalPages);
  }
  // Sorted pagination is not an atomic server snapshot. Recheck the head and
  // refuse known page movement; never call a partial scan a complete ranking.
  const check=await read(1);
  if(JSON.stringify(first)!==JSON.stringify(check)) fail('采集中出价记录发生变化，本轮不覆盖旧数据；请稍后刷新。');
  const keys=new Set(rows.map(r=>JSON.stringify([r.bidder,r.price,r.timeMs])));
  if(keys.size!==rows.length) fail('分页之间出现重复记录，可能有新出价移动了分页；本轮不更新排名。');
  return {rows,scanMeta:{pagesRead:first.totalPages,totalPages:first.totalPages,rawRows:rows.length,
    requests:first.totalPages+1,headRechecked:true}};
}

async function readClock(context) {
  const start=performance.now();
  const response=await context.get(`${ORIGIN}/pai/GetTime?${Date.now()}`,{timeout:5000,maxRedirects:0});
  try {
    const raw=await response.text();
    const epoch=Number(raw.match(/Date\((\d+)\)/)?.[1]);
    if(!response.ok() || !Number.isFinite(epoch)) return null;
    const rtt=performance.now()-start;
    return {serverMs:epoch+rtt/2,uncertaintyMs:Math.ceil(rtt/2)+50,anchor:performance.now()};
  } finally {await response.dispose();}
}

async function scan(session, progress=()=>{}, useInitial=false, selected={id:ITEM_ID,currency:'元'}) {
  const start=performance.now();
  const item=useInitial&&selected.id===ITEM_ID?session.item:await getPage(session.context,`${ORIGIN}/pai/item/${selected.id}`);
  const metadata=parseItem(item.html,selected.id);
  metadata.currency=selected.currency||'元';
  const seatEligible=/普通座/.test(metadata.title)&&metadata.currency==='元';
  const {rows,scanMeta}=await collectPages(p=>readBidPage(session.context,p,selected.id),progress);
  const clock=await readClock(session.context).catch(()=>null);
  const result=buildSnapshot(rows,{...metadata,scanMeta});
  if(metadata.notStarted) {
    result.advice='竞价尚未开始 · 仅显示记录，不提供实时出价建议。';
    for(const b of result.targetBands)b.recommendation=null;
  }
  if(!seatEligible) {
    result.targetBands=[];
    result.current.band=null;
    for(const r of result.ranking)r.location='';
    result.advice=metadata.ended?'竞价已结束 · 本场不是现金普通座，仅展示记录与价格分布。':'本场不是现金普通座 · 可查看排名和价格分布，不套用中间座位推荐。';
  }
  result.seatEligible=seatEligible;
  result.durationMs=Math.round(performance.now()-start);
  result.clock=clock?{serverNowMs:clock.serverMs+performance.now()-clock.anchor,uncertaintyMs:clock.uncertaintyMs}:null;
  return result;
}

async function main() {
  const once=process.argv.includes('--once');
  const summaryOnly=process.argv.includes('--summary');
  const send=(type,payload={})=>process.stdout.write(JSON.stringify({type,...payload})+'\n');
  let session, busy=false, paused=false, ended=false, closed=false, timer=null, failures=0, lastStart=0, first=true;
  let selected=once?{id:ITEM_ID,currency:'元'}:null, pending=null, catalogBusy=false, catalog=new Map(),catalogLast=0;
  const rl=readline.createInterface({input:process.stdin});
  const shutdown=async()=>{if(closed)return;closed=true;clearTimeout(timer);await session?.context.dispose();rl.close();process.exit(0);};
  async function refresh() {
    if(busy||closed||!selected)return;
    if(Date.now()-lastStart<3000){send('status',{message:'请稍候几秒再刷新。'});return;}
    busy=true;lastStart=Date.now();clearTimeout(timer);send('busy',{value:true});
    try {
      if(!session) {send('status',{message:'正在通过账号密码登录……'});session=await login();}
      const result=await scan(session,(page,total)=>send('status',{message:`读取记录 ${page}/${total} 页……`}),first,selected);
      first=false;ended=result.ended;failures=0;
      if(summaryOnly) send('summary',{pages:result.scanMeta.totalPages,records:result.scanMeta.rawRows,
        bidders:result.bidderCount,highest:result.highestPrice,durationMs:result.durationMs,ended,
        accountMatched:result.current.rank!==null,clockCalibrated:!!result.clock});
      else if(!pending)send('snapshot',{data:result});
    } catch(error) {
      failures++;
      const message=error.safeToShow?error.message:'网络连接失败或请求超时；保留上次完整数据。';
      if(!session || /登录|验证|限制|身份/.test(message)) paused=true;
      send('error',{message,paused});
    } finally {
      busy=false;send('busy',{value:false});
      if(once) {await session?.context.dispose();rl.close();process.exitCode=failures?1:0;return;}
      if(pending&&!closed){selected=pending;pending=null;paused=false;ended=false;lastStart=0;failures=0;send('selected',{item:selected});void refresh();return;}
      const delay=failures?Math.min(300000,30000*2**failures):30000;
      if(!closed&&!paused&&!ended) {timer=setTimeout(refresh,delay);send('schedule',{nextAtMs:Date.now()+delay});}
      else send('schedule',{nextAtMs:null});
    }
  }
  async function loadCatalog() {
    if(catalogBusy||closed)return;
    if(Date.now()-catalogLast<10000){send('catalogStatus',{message:'请稍候再刷新列表。'});return;}
    catalogBusy=true;catalogLast=Date.now();send('catalogBusy',{value:true});
    try {
      const result=await fetchCatalog((page,total,count)=>send('catalogStatus',{message:`抓取竞价目录 ${page}/${total} 页 · 已读取 ${count} 场……`}));
      catalog=new Map(result.items.map(i=>[i.id,i]));send('catalog',{data:result});
    } catch(error){send('catalogStatus',{message:error.safeToShow?error.message:'读取竞价列表失败，请稍后重试。',failed:true});}
    finally{catalogBusy=false;send('catalogBusy',{value:false});}
  }
  rl.on('line',line=>{
    let msg;try{msg=JSON.parse(line);}catch{return;}
    if(msg.command==='stop')void shutdown();
    if(msg.command==='refresh')void refresh();
    if(msg.command==='catalog')void loadCatalog();
    if(msg.command==='select') {
      const item=catalog.get(Number(msg.itemId));
      if(!item)return;
      clearTimeout(timer);
      if(busy){pending=item;send('status',{message:'等待本轮完成后切换场次……'});}
      else{selected=item;paused=false;ended=false;failures=0;lastStart=0;send('selected',{item});void refresh();}
    }
    if(msg.command==='pause') {paused=!!msg.value;clearTimeout(timer);send('paused',{value:paused});if(!paused&&!busy&&!ended)void refresh();}
  });
  if(!once)rl.on('close',()=>{void shutdown();});
  process.on('SIGINT',()=>{void shutdown();});
  if(once)await refresh();else await loadCatalog();
}

if(require.main===module)main().catch(()=>{process.stderr.write('监控进程异常退出，请重新打开程序。\n');process.exitCode=1;});
module.exports={parseItem,parseBidPage,readBidPage,collectPages,scan};
