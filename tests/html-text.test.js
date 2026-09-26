'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {decodeHtmlEntities}=require('../html-text');
const {parseCatalog}=require('../auction-catalog');
const {parseItem}=require('../http-monitor');

test('HTML text decodes decimal and hexadecimal numeric entities',()=>{
  assert.equal(decodeHtmlEntities('GNZ48&#183;普通座'), 'GNZ48·普通座');
  assert.equal(decodeHtmlEntities('&#xB7; &#X00b7; &#000183;'), '· · ·');
  assert.equal(decodeHtmlEntities('&#128512; &#x1F600;'), '😀 😀');
});

test('HTML text decodes the supported named entities',()=>{
  const entities={
    amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:'\u00a0',
    middot:'·',ndash:'–',mdash:'—',hellip:'…',
  };
  for(const [name,expected] of Object.entries(entities)){
    assert.equal(decodeHtmlEntities(`&${name};`),expected,name);
  }
});

test('HTML text preserves Chinese, ordinary text and unknown entities',()=>{
  const title='GNZ48《梦想的旗帜》·普通座 &unknown; A & B';
  assert.equal(decodeHtmlEntities(title),title);
  assert.equal(decodeHtmlEntities(''),'');
});

test('HTML text decodes exactly one layer of entities',()=>{
  assert.equal(decodeHtmlEntities('&amp;#183; &amp;middot; &amp;amp;'),
    '&#183; &middot; &amp;');
});

function catalogPage(title){
  return `<script>$("#pagination").pagination(1,{current_page:0});</script>
    <div class="gs_xx"><ul>
      <li class="gs_2"><a href="/pai/item/33355">${title}</a></li>
      <li>当前现金：￥118.00</li><li>12人出价 竞价状态：已结束</li>
    </ul></div>`;
}

function itemPage(title){
  return `<title>${title}</title>你好 退出
    <input id="hid_user" value="test-user"><input id="hid_isp" value="False">
    <b id="sp_start_price">98</b>
    <script>var markupPrice=5.00;var Coudown=2;</script>`;
}

test('catalog displays an entity-encoded Chinese auction title as readable text',()=>{
  const title='GNZ48&#183;2026年9月26日&nbsp;<span>《梦想的旗帜》</span>&middot;普通座';
  const item=parseCatalog(catalogPage(title)).items[0];
  assert.equal(item.title,'GNZ48·2026年9月26日 《梦想的旗帜》 ·普通座');
  assert.equal(item.id,33355);
  assert.equal(item.category,'普通座');
});

test('item details display decimal, hexadecimal and named middle dots in the title',()=>{
  const title='GNZ48&#183;《梦想的旗帜》&#xB7;普通座&middot;竞价';
  const item=parseItem(itemPage(title),33355);
  assert.equal(item.title,'GNZ48·《梦想的旗帜》·普通座·竞价');
  assert.equal(item.itemId,33355);
});

test('catalog and item title parsing each decode only one entity layer',()=>{
  const title='普通座 &amp;#183; &amp;middot;';
  const expected='普通座 &#183; &middot;';
  assert.equal(parseCatalog(catalogPage(title)).items[0].title,expected);
  assert.equal(parseItem(itemPage(title)).title,expected);
});
