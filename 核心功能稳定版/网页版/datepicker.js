/* ====== iOS 日期选择器 — 公历+农历滚轮 ====== */
(function(){
// 农历数据 1900-2100
const LD=[0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0,0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b6a0,0x195a6,0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x05ac0,0x0ab60,0x096d5,0x092e0,0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0,0x14b63,0x09370,0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06b20,0x1a6c4,0x0aae0,0x0a2e0,0x0d2e3,0x0c960,0x0d557,0x0d4a0,0x0da50,0x05d55,0x056a0,0x0a6d0,0x055d4,0x052d0,0x0a9b8,0x0a950,0x0b4a0,0x0b6a6,0x0ad50,0x055a0,0x0aba4,0x0a5b0,0x052b0,0x0b273,0x06930,0x07337,0x06aa0,0x0ad50,0x14b55,0x04b60,0x0a570,0x054e4,0x0d160,0x0e968,0x0d520,0x0daa0,0x16aa6,0x056d0,0x04ae0,0x0a9d4,0x0a4d0,0x0d150,0x0f252,0x0d520];
const LMN=['','正月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
const LDN=['','初一','初二','初三','初四','初五','初六','初七','初八','初九','初十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十','廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'];

// 农历位编码（标准 1900-2100 表）：低4位=闰月号，bit16=闰月30天，bit(16-m)=第m月30天
function li(y){return(y>=1900&&y<1900+LD.length)?LD[y-1900]||0:0;}
function lmLeap(y){return li(y)&0xf;}
function lmDays(y,m){const d=li(y);let il=false;if(m>12){m-=12;il=true;}if(il&&m===lmLeap(y))return(d&0x10000)?30:29;return(d&(0x10000>>m))?30:29;}
function lyDays(y){let ds=0;for(let m=1;m<=12;m++)ds+=lmDays(y,m);const l=lmLeap(y);if(l)ds+=lmDays(y,l+12);return ds;}
function s2l(y,m,d){
  const b=new Date(1900,0,31),t=new Date(y,m-1,d);
  let o=Math.round((t-b)/86400000);
  if(o<0)return{y:1900,m:1,d:1,leap:false};
  let ly=1900;
  while(ly<2100&&o>0){const yd=lyDays(ly);if(o<yd)break;o-=yd;ly++;}
  const leap=lmLeap(ly);
  for(let i=1;i<=12;i++){
    let md=lmDays(ly,i);
    if(o<md)return{y:ly,m:i,d:o+1,leap:false};
    o-=md;
    if(leap===i){
      md=lmDays(ly,i+12);
      if(o<md)return{y:ly,m:i,d:o+1,leap:true};
      o-=md;
    }
  }
  return{y:ly,m:12,d:30,leap:false};
}
function l2s(ly,lm,ld,il=false){
  let o=0;
  for(let y=1900;y<ly;y++)o+=lyDays(y);
  const leap=lmLeap(ly);
  for(let m=1;m<lm;m++){o+=lmDays(ly,m);if(leap===m)o+=lmDays(ly,m+12);}
  if(il&&leap===lm)o+=lmDays(ly,lm); // 闰月内的日期：先走完该正则月的天数（闰月排在正闰月之后）
  o+=(ld-1);
  const r=new Date(1900,0,31+o);
  return{y:r.getFullYear(),m:r.getMonth()+1,d:r.getDate()};
}

// 状态
let mode='solar',sY,sM,sD,upd=false,timer=null;
let onConfirm=null; // 确定回调

// DOM
function $(id){return document.getElementById(id);}
function buildOpts(el,vals,labels){
  el.innerHTML='';
  const f=document.createDocumentFragment();
  vals.forEach((v,i)=>{const d=document.createElement('div');d.className='dp-opt';d.textContent=labels?labels[i]:v;d.dataset.v=v;f.appendChild(d);});
  el.appendChild(f);
}
function scrollTo(el,v){
  const os=el.querySelectorAll('.dp-opt');
  for(const o of os){if(+o.dataset.v===v){el.scrollTo({top:o.offsetTop-90,behavior:'instant'});break;}}
}
function markSel(el){
  const r=el.getBoundingClientRect(),cy=r.top+r.height/2;let b=null,bd=Infinity;
  el.querySelectorAll('.dp-opt').forEach(o=>{o.classList.remove('sel');const oc=o.getBoundingClientRect().top+o.offsetHeight/2,d=Math.abs(oc-cy);if(d<bd){bd=d;b=o;}});
  if(b)b.classList.add('sel');
}
function getV(el){
  const r=el.getBoundingClientRect(),cy=r.top+r.height/2;let b=null,bd=Infinity;
  el.querySelectorAll('.dp-opt').forEach(o=>{const oc=o.getBoundingClientRect().top+o.offsetHeight/2,d=Math.abs(oc-cy);if(d<bd){bd=d;b=o;}});
  return b?{v:+b.dataset.v}:{v:1};
}
function getDate(){return{y:getV($('dpYear')).v,m:getV($('dpMonth')).v,d:getV($('dpDay')).v};}

function updPreview(){
  const sel=getDate();let sy,sm,sd,lu;
  if(mode==='solar'){sy=sel.y;sm=sel.m;sd=sel.d;lu=s2l(sy,sm,sd);}
  else{
    // 农历模式：月值 >12 表示闰月（m+12 编码，与 lmDays/l2s 约定一致）
    const leapM=sel.m>12;
    const s=l2s(sel.y,leapM?sel.m-12:sel.m,sel.d,leapM);
    sy=s.y;sm=s.m;sd=s.d;
    lu={y:sel.y,m:leapM?sel.m-12:sel.m,d:sel.d,leap:leapM};
  }
  sY=sy;sM=sm;sD=sd;
  $('dpPreview').innerHTML='<div class="dp-prev-s">公历：'+sy+'年'+sm+'月'+sd+'日</div><div class="dp-prev-l">农历：'+(lu.leap?'闰':'')+LMN[lu.m]+LDN[lu.d]+'</div>';
}
function updDayCol(){
  const sel=getDate();let y=sel.y,m=sel.m;const maxD=mode==='solar'?new Date(y,m,0).getDate():lmDays(y,m);
  const dS=$('dpDay');if(dS.querySelectorAll('.dp-opt').length!==maxD){const cd=Math.min(getV(dS).v,maxD);upd=true;buildDay();scrollTo(dS,cd);markSel(dS);upd=false;}
}
function buildYear(){const vs=[];for(let i=sY-50;i<=sY+50;i++)vs.push(i);buildOpts($('dpYear'),vs,vs.map(v=>v+'年'));}
function buildMonth(){
  const vs=[],ls=[],lu=s2l(sY,sM,sD),ly=lu?lu.y:sY,leap=lmLeap(ly);
  for(let m=1;m<=12;m++){vs.push(m);ls.push(mode==='lunar'?LMN[m]:m+'月');if(leap===m){vs.push(m+12);ls.push('闰'+LMN[m]);}} // 闰月用 m+12 编码，与 lmDays/l2s 一致
  buildOpts($('dpMonth'),vs,ls);
}
function buildDay(){
  const vs=[],ls=[],maxD=mode==='solar'?new Date(sY,sM,0).getDate():lmDays(sY,sM);
  for(let d=1;d<=maxD;d++){vs.push(d);ls.push(mode==='lunar'?LDN[d]:d+'日');}
  buildOpts($('dpDay'),vs,ls);
}

function onScroll(){
  if(upd)return;const yS=$('dpYear'),mS=$('dpMonth'),dS=$('dpDay');markSel(yS);markSel(mS);markSel(dS);updPreview();
  clearTimeout(timer);timer=setTimeout(()=>{updDayCol();markSel(yS);markSel(mS);markSel(dS);updPreview();},200);
}
function swMode(m){
  if(mode===m)return;const sel=getDate();let ty,tm,td;
  if(m==='solar'){const leapM=sel.m>12;const s=l2s(sel.y,leapM?sel.m-12:sel.m,sel.d,leapM);ty=s.y;tm=s.m;td=s.d;}
  else{const l=s2l(sel.y,sel.m,sel.d);ty=l.y;tm=l.leap?l.m+12:l.m;td=l.d;}
  mode=m;upd=true;buildYear();buildMonth();buildDay();
  requestAnimationFrame(()=>{scrollTo($('dpYear'),ty);scrollTo($('dpMonth'),tm);scrollTo($('dpDay'),td);markSel($('dpYear'));markSel($('dpMonth'));markSel($('dpDay'));updPreview();upd=false;});
  document.querySelectorAll('.dp-tab').forEach(t=>t.classList.toggle('active',t.dataset.mode===m));
}

// 公开API
// 获取某公历日期的农历文本（如"七月十八" / "闰六月初一"），供顶部日期等展示
window.getLunarText=function(y,m,d){
  const lu=s2l(y,m,d);
  return (lu.leap?'闰':'')+LMN[lu.m]+LDN[lu.d];
};
window.openDatePicker=function(initialDate,callback){
  const d=initialDate?new Date(initialDate+'T00:00:00'):new Date();
  sY=d.getFullYear();sM=d.getMonth()+1;sD=d.getDate();mode='solar';onConfirm=callback||null;
  document.querySelectorAll('.dp-tab').forEach(t=>t.classList.toggle('active',t.dataset.mode==='solar'));
  $('dpOverlay').style.display='flex'; // 先显示才能计算 offsetTop
  upd=true;buildYear();buildMonth();buildDay();
  requestAnimationFrame(()=>{scrollTo($('dpYear'),sY);scrollTo($('dpMonth'),sM);scrollTo($('dpDay'),sD);markSel($('dpYear'));markSel($('dpMonth'));markSel($('dpDay'));updPreview();upd=false;});
};
window.closeDatePicker=function(confirm){
  if(confirm&&onConfirm){const ds=sY+'-'+String(sM).padStart(2,'0')+'-'+String(sD).padStart(2,'0');onConfirm(ds);}
  $('dpOverlay').style.display='none';
};

// 事件绑定（延迟到DOM就绪）
function initDP(){
  const yS=$('dpYear'),mS=$('dpMonth'),dS=$('dpDay');if(!yS)return;
  [yS,mS,dS].forEach(s=>{s.addEventListener('scroll',onScroll,{passive:true});s.addEventListener('scrollend',()=>{markSel(s);updDayCol();updPreview();});});
  $('dpTabs').onclick=e=>{const t=e.target.closest('.dp-tab');if(t)swMode(t.dataset.mode);};
  $('dpHandle').onclick=()=>closeDatePicker(false);
  $('dpCancel').onclick=()=>closeDatePicker(false);
  $('dpConfirm').onclick=()=>closeDatePicker(true);
  $('dpOverlay').onclick=e=>{if(e.target===$('dpOverlay'))closeDatePicker(false);};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initDP);else initDP();
})();