'use strict';
const { request }=require('playwright-core');
const {getPage,fail}=require('./http-login');
const {decodeHtmlEntities}=require('./html-text');

function plain(value) {
  return decodeHtmlEntities(String(value).replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
}
function parseCatalog(html,expectedPage=0) {
  const total=Number(html.match(/\.pagination\(\s*(\d+)/)?.[1]);
  const page=Number(html.match(/current_page\s*:\s*(\d+)/)?.[1]);
  if(!Number.isInteger(total)||total<0||total>20000||page!==expectedPage)fail('无法识别官网竞价列表分页，未覆盖上次列表。');
  const items=[];
  for(const block of html.split(/<div\b[^>]*class=["']gs_xx["'][^>]*>/i).slice(1)) {
    const titleBlock=block.match(/<li\b[^>]*class=["']gs_2["'][^>]*>([\s\S]*?)<\/li>/i)?.[1]||'';
    const link=titleBlock.match(/<a\b[^>]*href=["']\/pai\/item\/(\d+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if(!link)fail('竞价列表中有无法识别的场次，未覆盖上次列表。');
    const text=plain(block.split('</ul>')[0]);
    const status= /已结束/.test(text)?'已结束':/未开始|即将开始|开始还有/.test(text)?'未开始':/进行中|正在竞价|结束还有/.test(text)?'进行中':'待确认';
    const endText=block.match(/data-enddate=["']([^"']*)["']/)?.[1]||'';
    const nextText=block.match(/data-two=["']([^"']*)["']/)?.[1]||'';
    const amount=text.match(/当前(?:现金|积分)[：:]\s*[￥¥]?\s*([\d.]+)/);
    const title=plain(link[2]);
    items.push({id:Number(link[1]),title,status,price:amount?Number(amount[1]):null,
      currency:/当前积分/.test(text)?'积分':'元',count:Number(text.match(/(\d+)人出价/)?.[1]||0),
      category:/普通座/.test(title)?'普通座':/站票/.test(title)?'站票':/VIP|贵宾|尊享/i.test(title)?'VIP/尊享':'其他',
      endTime:nextText||endText||'—'});
  }
  if(items.length>20|| (expectedPage<Math.ceil(total/20)-1&&items.length!==20)|| (total>0&&items.length===0))fail('竞价列表没有加载完整，请稍后刷新。');
  return {total,page,items,pages:Math.max(1,Math.ceil(total/20))};
}
async function fetchCatalog(progress=()=>{}) {
  const context=await request.newContext({timeout:8000});
  try {
    const first=parseCatalog((await getPage(context,'https://48.gnz48.com/pai?brand_id=3')).html);
    const map=new Map(first.items.map(i=>[i.id,i]));progress(1,first.pages,map.size);
    for(let page=1;page<first.pages;page++) {
      await new Promise(resolve=>setTimeout(resolve,150));
      const url=`https://48.gnz48.com/pai?totalCount=${first.total}&pageNum=${page}&brand_id=3`;
      const data=parseCatalog((await getPage(context,url)).html,page);
      for(const item of data.items)map.set(item.id,item);
      progress(page+1,first.pages,map.size);
    }
    if(map.size!==first.total)fail('竞价目录在抓取中发生变化，请刷新列表重试。');
    return {items:[...map.values()],total:first.total,updatedAtMs:Date.now()};
  } finally {await context.dispose();}
}
module.exports={parseCatalog,fetchCatalog};
