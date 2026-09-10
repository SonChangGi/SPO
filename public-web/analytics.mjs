export const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
export function orderSizing(row,capital,cost){
  const fee=capital*cost*row.turnover,budget=capital-fee;
  if(!Number.isFinite(budget)||budget<0||capital<=0)throw new Error('Invalid order budget');
  const amounts=row.weights.map(w=>budget*w);
  if(row.order_preview){
    const ci=[1000000,10000000,100000000,1000000000].indexOf(capital),bps=Math.round(cost*10000);
    if(ci<0||bps<0||bps>100||Math.abs(cost*10000-bps)>1e-8)throw new Error('Unsupported order preset');
    const index=ci*101+bps,quantities=Array(row.weights.length).fill(0),table=row.order_preview;
    table.active_indices.forEach((asset,i)=>{quantities[asset]=table.quantities[index][i];});
    const cash=table.cash[index];
    if(!Number.isFinite(cash)||cash<0||cash>budget)throw new Error('Invalid derived order cash');
    return {fee,budget,amounts,quantities,invested:budget-cash,cash};
  }
  if(row.prices.some(p=>!Number.isFinite(p)||p<=0))throw new Error('Invalid order prices');
  const quantities=amounts.map((a,i)=>Math.floor(a/row.prices[i]));
  const invested=quantities.reduce((s,q,i)=>s+q*row.prices[i],0);
  return {fee,budget,amounts,quantities,invested,cash:Math.max(0,budget-invested)};
}
export function calculate(model,start,end,cost){
  const rows=model.rows.filter(r=>r.entry>=start&&r.exit<=end);
  if(!rows.length)return null;
  let wealth=1,peak=1,underwater=0,longest=0,totalCost=0;
  const marks=new Map(),weekly=[];
  for(const row of rows){
    const fee=wealth*cost*row.turnover;totalCost+=fee;
    const base=wealth-fee;
    row.dates.forEach((d,i)=>marks.set(d,base*row.marks[i]));
    wealth=base*(1+row.gross);
    weekly.push((1-cost*row.turnover)*(1+row.gross)-1);
  }
  const path=[...marks.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,value])=>{
    peak=Math.max(peak,value);const dd=value/peak-1;
    underwater=dd< -1e-12?underwater+1:0;longest=Math.max(longest,underwater);
    return {date,value,dd};
  });
  const returns=path.slice(1).map((p,i)=>p.value/path[i].value-1);
  const avg=mean(returns),sd=Math.sqrt(returns.reduce((s,v)=>s+(v-avg)**2,0)/Math.max(1,returns.length-1));
  const days=(Date.parse(rows.at(-1).exit)-Date.parse(rows[0].entry))/86400000;
  const sampleRate=returns.length/(days/365.2425);
  return {id:model.id,label:model.label,kind:model.kind,rows,path,wealth,totalCost,weekly,
    cumulative:wealth-1,cagr:wealth**(365.2425/days)-1,mdd:Math.min(0,...path.map(p=>p.dd)),
    sharpe:sd>0?avg/sd*Math.sqrt(sampleRate):null,turnover:mean(rows.map(r=>r.turnover)),longest,days};
}
export function bootstrap(diff,length){
  if(diff.length<Math.max(20,2*length))return null;
  let seed=20260910;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const means=[];const n=diff.length;
  for(let k=0;k<1000;k++){let sum=0,count=0;while(count<n){const p=Math.floor(random()*(n-length+1));for(let j=0;j<length&&count<n;j++,count++)sum+=diff[p+j];}means.push(sum/n);}
  means.sort((a,b)=>a-b);return {length,low:means[25],high:means[974]};
}
