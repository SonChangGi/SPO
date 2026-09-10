import {calculate, bootstrap, mean, orderSizing} from './analytics.mjs';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=(v,d=1)=>Number.isFinite(v)?`${v>0?'+':''}${(v*100).toFixed(d)}%`:'—';
const plainpct=(v,d=1)=>Number.isFinite(v)?`${(v*100).toFixed(d)}%`:'—';
const money=v=>Math.abs(v)>=1e8?`${(v/1e8).toFixed(2)}억 원`:Math.abs(v)>=1e4?`${(v/1e4).toLocaleString('ko-KR',{maximumFractionDigits:0})}만 원`:`${Math.round(v).toLocaleString('ko-KR')}원`;
let data,stats=[],chartMode='wealth',chartData=[];
function options(id,selected){$(id).innerHTML=data.models.map(m=>`<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');$(id).value=selected;}
function changeModel(id){$('model').value=id;render();}
function inference(selected,reference){
  if(!reference||selected.id===reference.id){$('effect').textContent='—';$('effect-status').textContent='다른 전략을 비교 기준으로 선택하세요.';$('intervals').innerHTML='';return;}
  const other=new Map(reference.rows.map((r,i)=>[r.entry,reference.weekly[i]]));
  const diff=selected.rows.flatMap((r,i)=>other.has(r.entry)?[selected.weekly[i]-other.get(r.entry)]:[]);
  if(diff.length<20){$('effect').textContent='—';$('effect-status').textContent='구간 추정에는 최소 20개 보유구간이 필요합니다.';$('intervals').innerHTML='';return;}
  const effect=mean(diff),bands=[4,8,13].map(l=>bootstrap(diff,l)).filter(Boolean);
  $('effect').textContent=`${effect>0?'+':''}${(effect*10000).toFixed(1)} bp`;
  const robust=bands.every(b=>b.low>0)?'선택 전략의 관측 수익이 더 높습니다.':bands.every(b=>b.high<0)?'비교 전략의 관측 수익이 더 높습니다.':'표본의 변동을 고려하면 차이가 뚜렷하지 않습니다.';
  $('effect-status').textContent=`${reference.label} 대비 · ${robust}`;
  const max=Math.max(...bands.flatMap(b=>[Math.abs(b.low),Math.abs(b.high)]),Math.abs(effect),.0001);
  const x=v=>100+v/max*95;
  $('intervals').innerHTML=bands.map(b=>`<div class="interval-row"><span>${b.length}주 묶음</span><svg viewBox="0 0 200 20" role="img" aria-label="${b.length}주 블록 95% 구간"><line x1="100" x2="100" y1="0" y2="20" stroke="var(--line)"/><line x1="${x(b.low)}" x2="${x(b.high)}" y1="10" y2="10" stroke="var(--brand)" stroke-width="3"/><circle cx="${x(effect)}" cy="10" r="4" fill="var(--brand)"/></svg><span>${(b.low*10000).toFixed(1)} ~ ${(b.high*10000).toFixed(1)} bp</span></div>`).join('');
}
function renderChart(selected,reference,baseline){
  chartData=[...new Map([selected,reference,baseline].filter(Boolean).map(s=>[s.id,s])).values()];
  const palette=['var(--brand)','#008768','#9ca9b7'];
  $('chart-legend').innerHTML=chartData.map((s,i)=>`<span><i style="background:${palette[i]}"></i>${esc(s.label)}</span>`).join('');
  const width=Math.max(320,Math.round($('equity').clientWidth)),height=width<600?270:340,left=width<600?44:60,right=width-18,bottom=height-48;
  $('equity').setAttribute('viewBox',`0 0 ${width} ${height}`);
  const xmin=Date.parse(selected.path[0].date),xmax=Date.parse(selected.path.at(-1).date);
  const values=chartData.flatMap(s=>s.path.map(p=>chartMode==='wealth'?p.value-1:p.dd));
  let min=Math.min(0,...values),max=Math.max(0,...values);if(max-min<.01)max=min+.01;
  const pad=(max-min)*.10;min-=pad;max+=pad;
  const X=v=>left+(Date.parse(v)-xmin)/Math.max(1,xmax-xmin)*(right-left);
  const Y=v=>bottom-(v-min)/(max-min)*(bottom-20);
  let svg='';
  for(let i=0;i<=4;i++){const v=min+(max-min)*i/4,yy=Y(v);svg+=`<line x1="${left}" x2="${right}" y1="${yy}" y2="${yy}" stroke="var(--grid)"/><text x="${left-9}" y="${yy+4}" text-anchor="end">${plainpct(v,0)}</text>`;}
  const points=selected.path.filter((p,i,a)=>i===0||i===a.length-1||i%Math.max(1,Math.floor(a.length/(width<600?3:5)))===0);
  points.forEach((p,i)=>{if(i&&X(p.date)-X(points[i-1].date)<60)return;svg+=`<text x="${X(p.date)}" y="${height-17}" text-anchor="middle">${p.date.slice(2,7)}</text>`;});
  chartData.forEach((s,i)=>{
    const pts=s.path.map(p=>[X(p.date),Y(chartMode==='wealth'?p.value-1:p.dd)]);
    if(!i){svg+=`<path d="M ${pts[0][0]} ${Y(0)} L ${pts.map(p=>p.join(' ')).join(' L ')} L ${pts.at(-1)[0]} ${Y(0)} Z" fill="var(--brand)" opacity="0.055"/>`;}
    svg+=`<polyline points="${pts.map(p=>p.join(',')).join(' ')}" stroke="${palette[i]}" stroke-width="${i?1.6:2.8}" fill="none"${i===2?' stroke-dasharray="5 4"':''}/>`;
  });
  svg+=`<line id="crosshair" x1="0" x2="0" y1="15" y2="${bottom}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/>`;
  $('equity').innerHTML=svg;
  $('chart-count').textContent=`${selected.path.length}개 일별 평가`;
}
function allocation(selected,cost,capital){
  const row=selected.rows.at(-1);$('allocation-date').textContent=`${row.signal} 신호 · ${row.entry} 시가 진입`;
  const positions=row.weights.map((w,i)=>({w,i,asset:data.assets[i]})).filter(v=>v.w>0.0001).sort((a,b)=>b.w-a.w);
  const visible=positions.slice(0,6);
  $('weights').innerHTML=visible.map(({w,asset})=>`<div class="weight-row"><div class="weight-header"><div>${esc(asset.name)}<small>${esc(asset.sector)} · ${esc(asset.id)}</small></div><b>${plainpct(w)}</b></div><div class="weight-track"><i style="width:${w*100}%"></i></div></div>`).join('')+(positions.length>6?`<p class="muted">그 외 ${positions.length-6}개 ETF · ${plainpct(positions.slice(6).reduce((s,p)=>s+p.w,0))}</p>`:'');
  const hhi=row.weights.reduce((s,w)=>s+w*w,0);
  $('concentration').innerHTML=`<div><span>보유 ETF</span><b>${positions.length}개</b></div><div><span>최대 비중</span><b>${plainpct(positions[0].w)}</b></div><div><span>유효 분산 종목 수</span><b>${(1/hhi).toFixed(1)}개</b></div>`;
  const sizing=orderSizing(row,capital,cost);
  const capacity=data.assets.map((a,i)=>({asset:a,i,amount:sizing.amounts[i],trade:Math.abs(sizing.amounts[i]-capital*row.pretrade[i]),ratio:row.adv20[i]>0?Math.abs(sizing.amounts[i]-capital*row.pretrade[i])/row.adv20[i]:null,adv20:row.adv20[i]}));
  const max=capacity.reduce((best,c)=>c.ratio>best.ratio?c:best,capacity[0]);
  $('participation').textContent=plainpct(max.ratio,2);
  $('capacity-bar').style.width=`${Math.min(100,(max.ratio??0)*100)}%`;
  $('capacity-bar').style.background=max.ratio>.05?'var(--negative)':'var(--brand)';
  $('capacity-context').textContent=`${max.asset.name} · 투자금 ${money(capital)} · ${row.signal} 신호 전 20거래일 평균 대비`;
  $('turnover').textContent=plainpct(row.turnover);
  $('trade-cost').textContent=money(capital*cost*row.turnover);
  $('min-adv').textContent=capacity.some(c=>c.trade>0)?money(Math.min(...capacity.filter(c=>c.trade>0).map(c=>c.adv20))):'거래 없음';
  $('orders').querySelector('tbody').innerHTML=capacity.filter(c=>c.amount>0||c.trade>0).sort((a,b)=>b.amount-a.amount).map(c=>`<tr><td>${esc(c.asset.name)}</td><td>${money(c.amount)}</td><td>${sizing.quantities[c.i].toLocaleString('ko-KR')}주</td><td>${plainpct(c.ratio,2)}</td></tr>`).join('');
  $('orders').closest('details').querySelector('p').textContent=`조회 투자금의 비용 차감 후 규모 예시 · 정수 수량 잔액 ${money(sizing.cash)}`;
}
function render(){
  const start=$('start').value,end=$('end').value;
  let bps=Number($('cost').value);if(!Number.isFinite(bps))bps=10;bps=Math.round(Math.min(100,Math.max(0,bps)));$('cost').value=bps;
  const cost=bps/10000,capital=Number($('capital').value);
  stats=data.models.map(m=>calculate(m,start,end,cost)).filter(Boolean);
  const selected=stats.find(m=>m.id===$('model').value);
  $('empty').hidden=Boolean(selected);$('results').hidden=!selected;
  if(!selected){$('range-status').textContent='조회 기간에 완결된 보유구간 없음';return;}
  const reference=stats.find(m=>m.id===$('reference').value),baseline=stats.find(m=>m.id==='equal_weight');
  $('range-status').textContent=`${selected.rows[0].entry} — ${selected.rows.at(-1).exit} · ${selected.rows.length}회 보유구간 · ${data.assets.length}개 ETF · 구간 시작 투자금 기준`;
  $('k-return').textContent=pct(selected.cumulative);$('k-return').className=selected.cumulative>=0?'positive':'negative';
  $('k-relative').textContent=`동일가중 대비 ${((selected.cumulative-(baseline?.cumulative??0))*100).toFixed(1)}%p`;
  $('k-cagr').textContent=pct(selected.cagr);$('k-mdd').textContent=pct(selected.mdd);
  $('k-recovery').textContent=`최장 고점 미회복 ${selected.longest}거래일`;
  $('k-wealth').textContent=money(capital*selected.wealth);$('k-cost').textContent=`구간 내 비용 합계 ${money(capital*selected.totalCost)}`;
  $('cost-label').textContent=`비용 ${bps}bp`;
  $('comparison').querySelector('tbody').innerHTML=[...stats].sort((a,b)=>b.cumulative-a.cumulative).map(s=>`<tr data-model="${esc(s.id)}" class="${s.id===selected.id?'selected':''}"><td><button class="model-button" data-model="${esc(s.id)}">${esc(s.label)}</button><small>${esc(s.kind)}</small></td><td class="${s.cumulative>=0?'positive':'negative'}">${pct(s.cumulative)}</td><td>${pct(s.cagr)}</td><td>${pct(s.mdd)}</td><td>${s.sharpe===null?'—':s.sharpe.toFixed(2)}</td><td>${plainpct(s.turnover)}</td></tr>`).join('');
  renderChart(selected,reference,baseline);allocation(selected,cost,capital);inference(selected,reference);
}
function reset(){
  chartMode="wealth";
  for(const m of ["wealth","drawdown"]){$("view-"+m).classList.toggle("active",m==="wealth");$("view-"+m).setAttribute("aria-pressed",String(m==="wealth"));}
  const primary=data.models.find(m=>m.id===data.default_model);
  $('start').value=primary.rows[0].entry;$('end').value=primary.rows.at(-1).exit;
  $('model').value=data.default_model;$('reference').value='ridge_pto';$('cost').value=10;$('capital').value=10000000;render();
}
function mount(payload){
  if(payload.schema!=='spo_local_workspace_v1'||!payload.models?.length)throw Error('연구 데이터 형식이 맞지 않습니다.');
  data=payload;options('model',data.default_model);options('reference','ridge_pto');
  const first=data.models[0].rows[0].entry,last=data.models[0].rows.at(-1).exit;
  for(const id of ['start','end']){$(id).min=first;$(id).max=last;}
  $('asof').textContent=`데이터 ${data.data_as_of}`;$('basis').textContent=data.return_basis;
  const family=data.diagnostics?.family;
  const labels=Object.fromEntries(data.models.map(m=>[m.id,m.label]));
  $('statistical-detail').innerHTML=family?'<h3>미리 정한 비교 · 전체 OOS · 비용 10bp</h3><div class="table-scroll"><table><thead><tr><th>비교</th><th>평균 차이</th><th>Holm 보정 p</th><th>참고 최소 탐지효과</th></tr></thead><tbody>'+Object.entries(family.comparisons).map(([key,v])=>{const pair=key.split('__');return `<tr><td>${esc(labels[pair[0]])} − ${esc(labels[pair[1]])}</td><td>${v.estimate_bps.toFixed(1)}bp</td><td>${v.holm_adjusted_p_value.toFixed(3)}</td><td>${v.approximate_mde_bps.toFixed(1)}bp</td></tr>`;}).join('')+'</tbody></table></div><p class="muted">4개 고정 비교의 다중 검정 보정 · 경제적 차이 기준 5bp · 탐지효과는 검정력 80%의 정규 근사</p>':'';
  $('neural-note').textContent=data.neural?`TSMixer: ${data.neural.lookback}개 주간 시장 관측 · ${data.neural.seeds.length}개 고정 seed 평균 · 월별 재학습. 미래에 공개된 목표값은 각 학습에서 제외합니다.`:'TSMixer 실행 결과가 이 묶음에 없습니다.';
  const covariance=data.diagnostics?.covariance;
  if(covariance){
    const methods=[['expanding','전체 과거'],['rolling','최근 52개'],['ewma','EWMA'],['shrinkage','수축 추정']];
    $('statistical-detail').innerHTML+=`<h3>위험 추정 방식 비교 · ${esc(data.diagnostics.covariance_cutoff.slice(0,10))} 신호</h3><div class="table-scroll"><table><thead><tr><th>전략</th>${methods.map(([,label])=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${data.models.map(m=>`<tr><td>${esc(m.label)}</td>${methods.map(([key])=>`<td>${plainpct(covariance[key].volatility_by_model[m.id],2)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="muted">5거래일 가격수익의 추정 변동성 · 해당 신호 이전에 알려진 관측 사용</p>`;
  }
  $('provenance').textContent=`${data.source} · 현재 기준 고정 ETF 패널 · ${data.feature_count}개 입력 · ${data.training_samples}개 연구 신호 · ${data.code_version} · 무위험수익 0 · 비용 = half-L1 회전율 × bp, 차감 후 투자`;
  $('load-status').hidden=true;$('workspace').hidden=false;reset();
}
for(const id of ['model','start','end','cost','capital','reference'])$(id).addEventListener('change',render);
$('cost').addEventListener('input',()=>{if($('cost').value!=='')render();});
$('reset').addEventListener('click',reset);
$('comparison').addEventListener('click',e=>{const row=e.target.closest('[data-model]');if(row)changeModel(row.dataset.model);});
for(const mode of ['wealth','drawdown'])$(`view-${mode}`).addEventListener('click',()=>{chartMode=mode;for(const m of ['wealth','drawdown']){$(`view-${m}`).classList.toggle('active',m===mode);$(`view-${m}`).setAttribute('aria-pressed',String(m===mode));}render();});
$('theme').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';$('theme').setAttribute('aria-label',dark?'밝은 테마로 변경':'어두운 테마로 변경');});
$('equity').addEventListener('pointermove',event=>{
  if(!chartData.length)return;
  const rect=$('equity').getBoundingClientRect(),width=$('equity').viewBox.baseVal.width,left=width<600?44:60,right=width-18;
  const sx=(event.clientX-rect.left)/rect.width*width;
  const path=chartData[0].path,first=Date.parse(path[0].date),last=Date.parse(path.at(-1).date);
  const target=first+Math.min(1,Math.max(0,(sx-left)/(right-left)))*(last-first);
  const point=path.reduce((best,p)=>Math.abs(Date.parse(p.date)-target)<Math.abs(Date.parse(best.date)-target)?p:best,path[0]);
  const x=left+(Date.parse(point.date)-first)/(last-first)*(right-left);
  const line=$('crosshair');line.setAttribute('x1',x);line.setAttribute('x2',x);line.setAttribute('visibility','visible');
  $('tooltip').innerHTML=`<b>${point.date}</b>`+chartData.map(s=>{const p=s.path.find(p=>p.date===point.date);return p?`<p>${esc(s.label)} ${pct(chartMode==='wealth'?p.value-1:p.dd,2)}</p>`:'';}).join('');$('tooltip').hidden=false;
});
$('equity').addEventListener('pointerleave',()=>{$('tooltip').hidden=true;$('crosshair')?.setAttribute('visibility','hidden');});
fetch('research.json').then(r=>{if(!r.ok)throw Error(`연구 데이터 요청 실패 (${r.status})`);return r.json();}).then(mount).catch(error=>{$('load-status').textContent=error.message+' 페이지를 새로고침해 다시 확인해 주세요.';$('load-status').setAttribute('role','alert');});

let resizeTimer;window.addEventListener("resize",()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(data)render();},100);});
