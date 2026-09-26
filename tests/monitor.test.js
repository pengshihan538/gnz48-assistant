'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {deduplicate,buildSnapshot,estimateRank}=require('../auction-core');
const {parseBidPage,parseItem,collectPages}=require('../http-monitor');
const {parseCatalog}=require('../auction-catalog');
const row=(bidder,price,timeMs=1000)=>({bidder,price,timeMs});
const meta={username:'me',ended:false,startingPrice:98,minimumRaise:5};

test('one bidder occupies one rank: maximum price and first matching timestamp',()=>{
  assert.deepEqual(deduplicate([row('a',100,2),row('b',110,3),row('a',120,4),row('a',120,1)]),[row('a',120,1),row('b',110,3)]);
});
test('same price conservative rank excludes my old bid',()=>{
  assert.equal(estimateRank(100,[row('a',100),row('b',101),row('me',105)],'me'),3);
});
test('seat priority, all prices, and current rank preserved',()=>{
  const data=buildSnapshot([row('a',5000000),row('me',150),row('me',100),row('b',98)],meta);
  assert.deepEqual(data.targetBands.map(b=>b.row),[9,10,8,11,7,12]);
  assert.equal(data.current.rank,2);assert.equal(data.current.price,150);
  assert.equal(data.exactDistribution.at(-1).price,5000000);
  assert.equal(data.exactDistribution.reduce((s,r)=>s+r.count,0),3);
  assert.equal(data.targetBands.find(b=>b.row===7).recommendation.hold,true);
});
test('ended auction has no bid recommendations',()=>{
  const data=buildSnapshot([row('a',98)],{...meta,ended:true});
  assert.ok(data.targetBands.every(b=>b.recommendation===null));assert.match(data.advice,/已结束/);
});
test('candidate intervals match brute-force rank for every price in a sample',()=>{
  const rows=Array.from({length:120},(_,i)=>row('u'+i,98+Math.floor(i/2),i));
  const data=buildSnapshot(rows,meta);
  for(const b of data.targetBands)for(let price=98;price<180;price++){
    const rank=estimateRank(price,rows,'me');
    assert.equal(b.intervals.some(r=>price>=r.min&&(r.max===null||price<=r.max)),rank>=b.min&&rank<=b.max);
  }
});
test('parse valid empty and normal bid page, reject partial or malformed pages',()=>{
  assert.equal(parseBidPage({list:[],pageNum:0,PageCount:0,viewPrice:0},1).rows.length,0);
  const valid={list:[{user_name:'a',bid_amt:98,bid_time:'/Date(1790163063000)/'}],pageNum:1,PageCount:1,viewPrice:98};
  assert.equal(parseBidPage(valid,1).rows[0].timeMs,1790163063000);
  for(const value of [{...valid,PageCount:2},{...valid,pageNum:2},{...valid,list:[]},{}, {...valid,list:[{user_name:'***',bid_amt:98,bid_time:'/Date(1)/'}]}])assert.throws(()=>parseBidPage(value,1));
});
test('all pages plus head recheck; duplicate bidders retained until dedup',async()=>{
  const pages=[{rows:[row('a',110)],totalPages:2,page:1,viewPrice:110},{rows:[row('a',100),row('b',98)],totalPages:2,page:2,viewPrice:110}];
  const calls=[];const result=await collectPages(async p=>{calls.push(p);return pages[p-1];});
  assert.deepEqual(calls,[1,2,1]);assert.equal(result.rows.length,3);assert.equal(deduplicate(result.rows).length,2);
});
test('changed, duplicated or failed pagination never yields a partial snapshot',async()=>{
  let n=0;
  await assert.rejects(collectPages(async()=>({rows:[row('a',++n)],totalPages:1,page:1})),/变化/);
  await assert.rejects(collectPages(async p=>({rows:[row('a',100)],totalPages:p===1?2:3,page:p})),/页数/);
  await assert.rejects(collectPages(async p=>({rows:[row('a',100)],totalPages:2,page:p})),/重复/);
  await assert.rejects(collectPages(async p=>{if(p===2)throw Error('offline');return{rows:[row('a',100)],totalPages:2,page:1};}),/offline/);
});
test('item parsing requires authenticated visible identity and site rules',()=>{
  const html='<title>sample</title>你好 退出<input id="hid_user" value="me"><input id="hid_isp" value="False"><b id="sp_start_price">98</b><script>var markupPrice=5.00;var Coudown=2;</script>';
  assert.equal(parseItem(html).ended,true);assert.equal(parseItem(html).minimumRaise,5);
  assert.throws(()=>parseItem(html.replace('False','True')),/隐藏/);
  assert.throws(()=>parseItem('<title>Login</title>'),/登录/);
});
test('catalog parses discovered IDs, title, state, cash and point units',()=>{
  const prefix='<script>$("#pagination").pagination(2,{current_page:0});</script>';
  const block=(id,title,currency)=>`<div class="gs_xx"><ul><li class="gs_2"><a href="/pai/item/${id}">${title}</a></li><li>当前${currency}：￥118.00</li><li>12人出价 竞价状态：已结束</li></ul></div>`;
  const result=parseCatalog(prefix+block(42,'测试普通座票','现金')+block(43,'测试广告屏','积分'));
  assert.equal(result.total,2);assert.equal(result.items[0].id,42);assert.equal(result.items[0].category,'普通座');
  assert.equal(result.items[0].currency,'元');assert.equal(result.items[1].currency,'积分');
  assert.equal(result.items[0].status,'已结束');assert.equal(result.items[0].count,12);
  assert.throws(()=>parseCatalog(prefix,1),/分页/);
  assert.throws(()=>parseCatalog(prefix),/完整/);
});
test('item ID is taken from the selected catalog entry, not the old fixed auction',()=>{
  const html='<title>sample</title>你好 退出<input id="hid_user" value="me"><b id="sp_start_price">98</b><script>var markupPrice=5;var Coudown=2;</script>';
  assert.equal(parseItem(html,33355).itemId,33355);
});
