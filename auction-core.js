'use strict';

const SAFE_BANDS = [
  { row: 9, min: 33, max: 42 }, { row: 10, min: 57, max: 66 },
  { row: 8, min: 17, max: 26 }, { row: 11, min: 83, max: 92 },
  { row: 7, min: 1, max: 10 }, { row: 12, min: 109, max: 118 },
];

function deduplicate(rows) {
  const best = new Map();
  for (const row of rows) {
    const previous = best.get(row.bidder);
    if (!previous || row.price > previous.price ||
        (row.price === previous.price && row.timeMs < previous.timeMs)) best.set(row.bidder, row);
  }
  // Stable source order for timestamps tied to the same millisecond.
  return [...best.values()].sort((a, b) => b.price - a.price || a.timeMs - b.timeMs);
}

function distribution(rows) {
  const counts = new Map();
  for (const {price} of rows) counts.set(price, (counts.get(price) || 0) + 1);
  return [...counts].sort((a,b) => a[0]-b[0]).map(([price,count]) => ({price,count}));
}

function estimateRank(price, ranked, username) {
  return 1 + ranked.filter(r => r.bidder !== username && r.price >= price).length;
}

function buildSnapshot(rows, metadata) {
  const { username, ended, startingPrice = 98, minimumRaise = 5 } = metadata;
  const ranked = deduplicate(rows);
  const currentIndex = ranked.findIndex(r => r.bidder === username);
  const current = currentIndex >= 0 ? ranked[currentIndex] : null;
  const minimum = Math.ceil(current ? Math.max(startingPrice, current.price + minimumRaise) : startingPrice);
  // Rank changes only above existing prices. No unbounded loop over currency values.
  const starts = [...new Set([minimum, ...ranked.filter(r => r.bidder !== username)
    .map(r => Math.floor(r.price) + 1).filter(p => p >= minimum)])].sort((a,b) => a-b);
  const segments = starts.map((min, i) => ({ min, max: starts[i+1] == null ? null : starts[i+1]-1,
    rank: estimateRank(min, ranked, username) }));
  const targetBands = SAFE_BANDS.map((band, i) => {
    const candidates = segments.filter(s => s.rank >= band.min && s.rank <= band.max);
    const targetRank = band.min + Math.floor((band.max-band.min)/3);
    const chosen = candidates.find(s => s.rank <= targetRank) || candidates.slice().sort((a,b) =>
      Math.abs(a.rank-targetRank)-Math.abs(b.rank-targetRank) || a.min-b.min)[0];
    const holds = current && currentIndex+1 >= band.min && currentIndex+1 <= band.max;
    const intervals = [];
    for (const segment of candidates) {
      const last = intervals[intervals.length-1];
      if (last && last.max+1 === segment.min) last.max = segment.max;
      else intervals.push({min:segment.min,max:segment.max});
    }
    return { ...band, priority:i+1, label:`${band.row}排中间`,
      observed:distribution(ranked.slice(band.min-1,band.max)), intervals,
      recommendation: ended ? null : holds ? {price:current.price,rank:currentIndex+1,hold:true,buffer:band.max-currentIndex-1} :
        chosen ? {price:chosen.min,rank:chosen.rank,hold:false,buffer:band.max-chosen.rank} : null,
    };
  });
  const ownBand = SAFE_BANDS.find(b => currentIndex >= 0 && currentIndex+1 >= b.min && currentIndex+1 <= b.max);
  const recommended = ownBand ? targetBands.find(b => b.row === ownBand.row) : targetBands.find(b => b.recommendation);
  const advice = ended ? '竞价已结束 · 展示最终记录，不再提供出价建议。' : recommended ?
    recommended.recommendation.hold ? `当前第 ${currentIndex+1} 名，位于${recommended.label}；建议暂不加价。` :
      `参考建议 ¥${recommended.recommendation.price} · 预计第 ${recommended.recommendation.rank} 名 · ${recommended.label}` :
      '当前没有可进入目标中间区间的价格，继续观察。';
  const rangeLimits = [[98,98,'≤98'],[99,110,'99–110'],[111,120,'111–120'],[121,130,'121–130'],
    [131,140,'131–140'],[141,150,'141–150'],[151,175,'151–175'],[176,200,'176–200'],[201,Infinity,'>200']];
  return { ...metadata, username:undefined, updatedAtMs:Date.now(),
    bidderCount:ranked.length, highestPrice:ranked[0]?.price ?? null, advice,
    current:{price:current?.price ?? null,rank:current ? currentIndex+1 : null,band:ownBand ? `${ownBand.row}排中间` : null},
    targetBands, exactDistribution:distribution(ranked),
    rangeDistribution:rangeLimits.map(([min,max,label],i) => ({label,count:ranked.filter(r =>
      i===0 ? r.price<=98 : i===8 ? r.price>200 : r.price>=min&&r.price<=max).length})),
    ranking:ranked.map((r,i) => ({rank:i+1,bidder:r.bidder,price:r.price,
      time:new Date(r.timeMs).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}),
      mine:r.bidder===username ? '我' : '', location:SAFE_BANDS.find(b => i+1>=b.min&&i+1<=b.max)?.row ?? ''})),
  };
}

module.exports = { SAFE_BANDS, deduplicate, distribution, estimateRank, buildSnapshot };
