'use strict';
// ================= 保存 =================
const KEY='ps_v1';
const DEF={streak:0,lastDay:null,best:0,daily:{},seen:{},tut:false,sound:true,notif:true,notifTime:'08:00',firstDay:null,
  badges:{},stats:{perfect:0,practiceBest:0,archive:0,hints:0,correct:0},protectUsed:null};
let S=JSON.parse(JSON.stringify(DEF));
try{const s=localStorage.getItem(KEY);if(s){const o=JSON.parse(s);S=Object.assign(S,o);S.stats=Object.assign({},DEF.stats,o.stats||{});S.seen=o.seen||{};}}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify(S));}catch(e){}}

// ================= 日付 =================
const EPOCH=new Date(2026,9,19); // 2026-10-19 = #1(ローカル日付)。公開日に合わせて変える
const DAY=86400000;
const mid=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate());
function dayIndex(d=new Date()){return Math.round((mid(d)-mid(EPOCH))/DAY)+1;}
function dateFromN(n){const d=new Date(EPOCH);d.setDate(d.getDate()+n-1);return d;}
function dayKey(d=new Date()){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function keyFromN(n){return dayKey(dateFromN(n));}
const todayN=()=>dayIndex(new Date());
const yKey=()=>dayKey(new Date(Date.now()-DAY)),y2Key=()=>dayKey(new Date(Date.now()-2*DAY));

// ================= 乱数(決定的) =================
function rng(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
function shuffle(a,r=Math.random){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

// ================= 問題の組み立て =================
// 出題タイプ: flag=国旗 / map=地図で光る国 / cap=首都から
// 1日の5問: [国旗4択, 地図4択, 首都4択, 国旗6択, 地図6択]  (level 1=4択(有名な国) 2=6択(すべての国))
const DAILY_SLOTS=[{t:'flag',lv:1},{t:'map',lv:1},{t:'cap',lv:1},{t:'flag',lv:2},{t:'map',lv:2}];
const TYPE_NAME={flag:'この国旗の国は？',map:'地図のどこ？',cap:'首都から当てよう'};
const LV=['','4択','6択'];
// タイプ・レベルごとに出題できる国
function pool(t,lv){
  return PREF.filter(p=>(t!=='map'||p.onMap)&&(t!=='cap'||p.capQ)&&(lv!==1||p.easy));
}
// ダミーの候補: 6択は同じ小地域・隣国から(似た国が並ぶので難しい)、4択は有名な国を中心に1つだけ近い国
function dummies(p,n,r,t){
  const ok=x=>x.id!==p.id&&(t!=='map'||x.onMap);
  const near=PREF.filter(x=>ok(x)&&(x.sub===p.sub||p.adj.includes(x.id)));
  const far=PREF.filter(x=>ok(x)&&x.sub!==p.sub&&!p.adj.includes(x.id)&&(n===6||x.easy));
  const pick=n===6?[...shuffle(near,r),...shuffle(far,r)]:[...shuffle(near.filter(x=>x.easy),r).slice(0,1),...shuffle(far,r)];
  const out=[];for(const x of pick){if(!out.includes(x.id))out.push(x.id);if(out.length>=n-1)break;}
  return out;
}
function makeQ(p,type,lv,r){
  const n=lv===1?4:6;
  const choices=shuffle([p.id,...dummies(p,n,r,type)],r);
  return {id:p.id,type,lv,choices};
}
// 各スロットごとに出題候補を決定的に並べ替え、1周するまで同じ国を出さない。同じ日に同じ国は出さない
function dailySet(n){
  const used=new Set();
  return DAILY_SLOTS.map((s,slot)=>{
    const pl=pool(s.t,s.lv);
    const order=shuffle(pl,rng(20261019+slot*1000+Math.max(0,Math.floor((n-1)/pl.length))));
    let idx=((n-1)%pl.length+pl.length)%pl.length,p=order[idx];
    while(used.has(p.id)){idx=(idx+1)%pl.length;p=order[idx];}
    used.add(p.id);
    return makeQ(p,s.t,s.lv,rng(n*97+slot*13+p.id));
  });
}

// ================= 地図・国旗の描画 =================
function svgPath(p,cls){return `<path class="pf ${cls||''}" d="${MAP_PATHS[p.num]}"/>`;}
let BASE_PATHS=null;   // 出題しない地域(海外領土など)も含めた背景の陸地
function basePaths(){if(!BASE_PATHS){const mine=new Set(PREF.map(p=>p.num));BASE_PATHS=Object.keys(MAP_PATHS).filter(k=>!mine.has(k)).map(k=>`<path class="pf" d="${MAP_PATHS[k]}"/>`).join('');}return BASE_PATHS;}
// 地図で1か国を光らせる。小さな国でも見えるよう、その国のまわりをズームして表示(右下に世界全体の位置)
function mapHTML(id,state){
  const p=P(id),b=MAP_BBOX[p.num];
  const MIN=150;const w=Math.max(b[2]*2.6,MIN),h=Math.max(b[3]*2.6,MIN*0.8);
  let x=b[0]+b[2]/2-w/2,y=b[1]+b[3]/2-h/2;
  x=Math.max(-20,Math.min(MAP_W+20-w,x));y=Math.max(-20,Math.min(MAP_H+20-h,y));
  const all=basePaths()+PREF.filter(q=>MAP_PATHS[q.num]).map(q=>svgPath(q,q.id===id?'tgt '+(state||''):'')).join('');
  const dot=Math.max(b[2],b[3])<12?`<circle class="ring ${state||''}" cx="${(b[0]+b[2]/2).toFixed(1)}" cy="${(b[1]+b[3]/2).toFixed(1)}" r="${(Math.max(w,h)*0.06).toFixed(1)}"/>`:'';
  return `<svg viewBox="${x.toFixed(0)} ${y.toFixed(0)} ${w.toFixed(0)} ${h.toFixed(0)}" preserveAspectRatio="xMidYMid meet">${all}${dot}</svg>
  <div class="mini"><svg viewBox="0 0 ${MAP_W} ${MAP_H}">${basePaths()}${PREF.filter(q=>MAP_PATHS[q.num]).map(q=>svgPath(q,q.id===id?'tgt':'')).join('')}<rect class="box" x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}"/></svg></div>`;
}
function flagHTML(p,big){return `<span class="fl${big?' big':''}">${flagOf(p)}</span>`;}
function capHTML(p,more){
  return `<div class="hintcard"><div class="hq">首都が…</div><div class="h">${p.cap}</div><div class="hq">の国は？</div>${more?`<div class="h more">国旗は ${flagOf(p)}</div>`:''}</div>`;
}
function renderQ(q,state){
  const p=P(q.id),box=$('qbox');
  if(q.type==='map')box.innerHTML=mapHTML(q.id,state);
  else if(q.type==='flag')box.innerHTML=`<div class="flagcard ${state||''}">${flagHTML(p,true)}</div>`;
  else box.innerHTML=capHTML(p,G.mean);
}

// ================= 効果音(Web Audio) =================
let AC=null;
function ac(){if(!AC){try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}}if(AC&&AC.state==='suspended')AC.resume();return AC;}
function tone(f,t0,dur,type='sine',vol=.18){const c=ac();if(!c||!S.sound)return;const o=c.createOscillator(),g=c.createGain();
  o.type=type;o.frequency.value=f;g.gain.setValueAtTime(0,c.currentTime+t0);g.gain.linearRampToValueAtTime(vol,c.currentTime+t0+.01);
  g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+t0+dur);o.connect(g);g.connect(c.destination);o.start(c.currentTime+t0);o.stop(c.currentTime+t0+dur+.05);}
const sfx={
  tap(){tone(880,0,.05,'triangle',.08);},
  ok(){tone(660,0,.12,'sine');tone(990,.1,.2,'sine');},
  ng(){tone(180,0,.18,'square',.08);},
  perfect(){[523,659,784,1047].forEach((f,i)=>tone(f,i*.09,.25,'triangle',.15));},
  badge(){[784,1047,1319].forEach((f,i)=>tone(f,i*.08,.3,'sine',.12));},
  reveal(){tone(330,0,.3,'sine',.1);}
};

// ================= 画面ユーティリティ =================
const $=id=>document.getElementById(id);
let show=function(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('on'));$(id).classList.add('on');window.scrollTo(0,0);};
let toastT;function toast(t,ms=1600){const e=$('toast');e.textContent=t;e.classList.add('on');clearTimeout(toastT);toastT=setTimeout(()=>e.classList.remove('on'),ms);}
function modal(title,body,ok,cancel,okLabel='OK',silId){
  $('ovTitle').textContent=title;$('ovBody').textContent=body;$('ov').classList.add('on');
  const sil=$('ovSil');if(silId){sil.style.display='';sil.innerHTML=flagHTML(P(silId),true);}else{sil.style.display='none';sil.innerHTML='';}
  $('ovOk').textContent=okLabel;$('ovCancel').style.display=cancel?'block':'none';
  $('ovOk').onclick=()=>{$('ov').classList.remove('on');ok&&ok();};
  $('ovCancel').onclick=()=>{$('ov').classList.remove('on');cancel&&cancel();};
}
function prefInfo(p){
  const adj=p.adj.map(i=>P(i).n);
  return `首都: ${p.cap}${p.capNote?`\n（${p.capNote}）`:''}\n地域: ${REGIONS[p.reg]}・${p.sub}\n面積: ${p.area.toLocaleString()} km²\n${adj.length?'陸続きの隣国: '+adj.join('、'):'陸続きの隣国はない'}`;
}
function resHTML(p,mark,type){
  return `<div class="res"><span class="k">${flagOf(p)} ${p.n}</span><span class="w">${mark?mark+' ':''}${type?TYPE_NAME[type]+'<br>':''}${p.cap} · ${p.sub}</span></div>`;
}

// ================= バッジ =================
const seenN=()=>Object.keys(S.seen).length;
const regionDone=reg=>PREF.filter(p=>p.reg===reg).every(p=>S.seen[p.id]);
const BADGES=[
  {id:'first',ic:'🌱',name:'はじめの一歩',desc:'今日の5問を初めて解いた',test:()=>Object.keys(S.daily).length>=1},
  {id:'perfect1',ic:'💮',name:'満点!',desc:'5問すべて🟩',test:()=>S.stats.perfect>=1},
  {id:'perfect5',ic:'🎯',name:'百発百中',desc:'5問すべて🟩 を5回',test:()=>S.stats.perfect>=5},
  {id:'streak3',ic:'🔥',name:'三日坊主…じゃない',desc:'3日連続',test:()=>S.streak>=3},
  {id:'streak7',ic:'🧭',name:'一週間',desc:'7日連続',test:()=>S.streak>=7},
  {id:'streak30',ic:'🎖️',name:'皆勤賞',desc:'30日連続',test:()=>S.streak>=30},
  {id:'zukan10',ic:'🧳',name:'旅のはじまり',desc:'図鑑に10か国集めた',test:()=>seenN()>=10},
  {id:'zukan50',ic:'✈️',name:'世界旅行者',desc:'図鑑に50か国集めた',test:()=>seenN()>=50},
  {id:'zukan100',ic:'🗺️',name:'地球の半分',desc:'図鑑に100か国集めた',test:()=>seenN()>=100},
  {id:'samerica',ic:'🦙',name:'南アメリカ制覇',desc:`南アメリカの${PREF.filter(p=>p.reg===5).length}か国を図鑑に集めた`,test:()=>regionDone(5)},
  {id:'oceania',ic:'🏝️',name:'オセアニア制覇',desc:`オセアニアの${PREF.filter(p=>p.reg===6).length}か国を図鑑に集めた`,test:()=>regionDone(6)},
  {id:'zukanAll',ic:'🌏',name:'世界一周',desc:`${PREF.length}か国すべて図鑑に集めた`,test:()=>seenN()>=PREF.length},
  {id:'archive5',ic:'📅',name:'温故知新',desc:'過去問を5日分解いた',test:()=>S.stats.archive>=5},
  {id:'practice10',ic:'✏️',name:'地理博士',desc:'練習で10問連続正解',test:()=>S.stats.practiceBest>=10},
  {id:'practice30',ic:'🏆',name:'地理マスター',desc:'練習で30問連続正解',test:()=>S.stats.practiceBest>=30},
];
function checkBadges(){
  const got=[];
  BADGES.forEach(b=>{if(!S.badges[b.id]&&b.test()){S.badges[b.id]=dayKey();got.push(b);}});
  if(got.length){save();sfx.badge();got.forEach((b,i)=>setTimeout(()=>toast(`🏅 バッジ獲得: ${b.name}`,2200),600+i*2300));}
}
function renderBadges(){
  const n=Object.keys(S.badges).length;$('badCount').textContent=`${n} / ${BADGES.length}`;
  $('badgeList').innerHTML=BADGES.map(b=>`<div class="badge ${S.badges[b.id]?'':'lock'}"><div class="ic">${b.ic}</div><div><b>${b.name}</b><small>${b.desc}${S.badges[b.id]?'<br>'+S.badges[b.id]:''}</small></div></div>`).join('');
  show('badges');
}

// ================= 図鑑 =================
let zReg=1;
function renderZukan(){
  const n=seenN(),N=PREF.length;$('zCount').textContent=`${n} / ${N}`;$('zBar').style.width=(n/N*100)+'%';
  $('zTabs').innerHTML=[1,2,3,4,5,6].map(l=>{const t=PREF.filter(p=>p.reg===l),g=t.filter(p=>S.seen[p.id]).length;
    return `<button class="${l===zReg?'on':''}" data-l="${l}">${REGIONS[l]} ${g}/${t.length}</button>`;}).join('');
  $('zTabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{sfx.tap();zReg=+b.dataset.l;renderZukan();});
  $('zList').innerHTML=PREF.filter(p=>p.reg===zReg).map(p=>S.seen[p.id]
    ?`<div class="zi" data-id="${p.id}"><div class="zs">${flagHTML(p)}</div><b>${p.n}</b><small>${p.cap}</small></div>`
    :`<div class="zi lock"><div class="zs"><span class="fl q">？</span></div><b>？？？</b><small>${p.sub}</small></div>`).join('');
  $('zList').querySelectorAll('.zi[data-id]').forEach(e=>e.onclick=()=>{const p=P(+e.dataset.id);modal(p.n,prefInfo(p),null,null,'OK',p.id);});
  show('zukan');
}

// ================= ホーム =================
function renderHome(){
  const today=dayKey();
  if(S.lastDay&&S.lastDay!==today&&S.lastDay!==yKey()){
    if(S.streak>0&&S.lastDay===y2Key()&&S.protectUsed!==today){
      const st=S.streak;
      Native.rewarded('🔥 連続記録が途切れそう!',`昨日は解いていません。動画を見ると、${st}日連続の記録を守れます。`,
        ()=>{S.lastDay=yKey();S.protectUsed=today;save();toast('連続記録を守りました');renderHome();},
        ()=>{S.streak=0;save();renderHome();});
      return;
    }
    S.streak=0;save();
  }
  $('hStreak').textContent=S.streak;$('hZukan').textContent=seenN();
  $('hBadges').textContent=Object.keys(S.badges).length;
  const done=S.daily[today];
  $('bDaily').textContent=done?'今日の結果を見る ✓':`今日の5問  #${todayN()}`;
  show('home');
}

// ================= ゲーム =================
let G=null;
// mode: 'daily' | 'archive' | 'practice' | 'tut' | 'view'
function startDaily(){
  const today=dayKey();
  if(S.daily[today]){showDailyResult(S.daily[today]);return;}
  if(!S.tut){startTutorial();return;}
  G={mode:'daily',n:todayN(),list:dailySet(todayN()),i:0,marks:[]};Native.track('daily_start',{n:G.n});loadQ();
}
function startArchive(n){
  const k=keyFromN(n);
  if(S.daily[k]){showDailyResult(S.daily[k]);return;}
  G={mode:'archive',n,list:dailySet(n),i:0,marks:[]};loadQ();
}
function practiceList(){
  const types=['flag','map','cap'];
  return shuffle(PREF).map((p,i)=>{
    let t=types[i%3];if(t==='map'&&!p.onMap)t='flag';if(t==='cap'&&!p.capQ)t='flag';
    return makeQ(p,t,p.easy&&Math.random()<0.6?1:2,Math.random);
  });
}
function startPractice(){
  G={mode:'practice',list:practiceList(),i:0,marks:[],lives:3,score:0,wrongs:[],continued:false};Native.track('practice_start');loadQ();
}
function startTutorial(){
  const id=iso=>PREF.find(p=>p.iso3===iso).id;
  modal('はじめまして!','国旗・地図・首都から、国の名前を当てるゲームです。\nまず1問、いっしょにやってみましょう。',
    ()=>{Native.track('tutorial_begin');G={mode:'tut',list:[{id:id('JPN'),type:'flag',lv:1,choices:[id('KOR'),id('JPN'),id('USA'),id('CHN')]}],i:0,marks:[]};loadQ();},null,'やってみる');
}
function loadQ(){
  const q=G.list[G.i],p=P(q.id);
  G.tries=0;G.hint=0;G.mean=false;G.answered=false;
  renderQ(q);
  $('qTitle').innerHTML=`${TYPE_NAME[q.type]}<span class="lvtag">${LV[q.lv]}</span>`;
  const m=$('ymean');m.className='ymean';m.innerHTML='';
  const msg=$('pMsg');msg.className='msg';
  if(G.mode==='tut'){msg.className='msg tut';msg.textContent='この国旗の国をタップ!';}
  else msg.textContent=q.type==='map'?'光っている国は？':q.type==='flag'?'この国旗の国は？':'この首都がある国は？';
  $('pProg').textContent=G.mode==='tut'?'れんしゅう問題':G.mode==='practice'?`練習  ${G.score} 問連続`:`${G.mode==='archive'?'過去問':'今日の5問'}  ${G.i+1} / 5`;
  $('pLives').textContent=G.mode==='practice'?'❤'.repeat(G.lives)+'♡'.repeat(3-G.lives):(G.mode==='tut'?'':'#'+G.n);
  const ch=$('choices');ch.innerHTML='';ch.className='choices'+(q.choices.length===4?' c4':'');
  q.choices.forEach(id=>{const b=document.createElement('button'),nm=P(id).n;b.className='ch'+(nm.length>11?' xl':nm.length>6?' l':'');b.dataset.id=id;b.textContent=nm;b.onclick=()=>{sfx.tap();answer(id,b);};ch.appendChild(b);});
  $('hintRow').style.display=G.mode==='tut'?'none':'';
  $('bMean').disabled=false;$('bHint').disabled=false;
  $('bNext').style.display='none';
  show('play');
}
function answer(id,btn){
  if(G.answered)return;
  const q=G.list[G.i];G.tries++;
  if(id===q.id){
    G.answered=true;btn.classList.add('right');sfx.ok();
    renderQ(q,'ok');
    const mark=(G.tries===1&&G.hint===0&&!G.mean)?'🟩':'🟨';
    finishQ(mark,true);
  }else{
    sfx.ng();btn.classList.add('wrong');
    const b=$('qbox');b.classList.add('ng');setTimeout(()=>b.classList.remove('ng'),350);
    if(G.mode==='practice'){
      G.lives--;$('pLives').textContent='❤'.repeat(Math.max(0,G.lives))+'♡'.repeat(3-Math.max(0,G.lives));G.wrongs.push(q.id);
      if(G.lives<=0){reveal(q);G.answered=true;showAnswerInfo(q);setTimeout(()=>practiceOver(),1200);return;}
      $('pMsg').textContent='ちがう… 残り ❤'+G.lives;
    }else if(G.mode==='tut'){
      $('pMsg').textContent='おしい! 白地に赤い丸、日の丸の国です';
    }else{
      if(G.tries>=2){reveal(q);G.answered=true;finishQ('🟥',false);return;}
      $('pMsg').textContent='おしい! もう一度';
    }
  }
}
function reveal(q){sfx.reveal();renderQ(q,'rev');
  document.querySelectorAll('.ch').forEach(b=>{if(+b.dataset.id===q.id)b.classList.add('right');});}
function showAnswerInfo(q){
  const p=P(q.id);
  const m=$('ymean');m.className='ymean on';
  m.innerHTML=`<b>${flagOf(p)} ${p.n}</b><br>首都: ${p.cap} ／ ${REGIONS[p.reg]}・${p.sub}<br>面積: ${p.area.toLocaleString()} km²`;
  $('hintRow').style.display='none';
}
function finishQ(mark,ok){
  const q=G.list[G.i];
  if(ok&&G.mode!=='tut'){if(!S.seen[q.id])S.seen[q.id]=dayKey();S.stats.correct++;save();}
  showAnswerInfo(q);
  $('pMsg').className='msg';$('pMsg').textContent=ok?(mark==='🟩'?'正解!':'正解'):'残念…';
  if(G.mode==='tut'){$('bNext').style.display='';$('bNext').textContent='今日の5問へ ▶';return;}
  if(G.mode==='practice'){G.score++;$('bNext').style.display='';$('bNext').textContent='次へ ▶';return;}
  G.marks.push(mark);$('bNext').style.display='';$('bNext').textContent=G.i<4?'次へ ▶':'結果を見る ▶';
}
function next(){
  sfx.tap();
  if(G.mode==='tut'){S.tut=true;save();Native.track('tutorial_complete');toast('準備OK! 今日の5問へ');startDaily();return;}
  if(G.mode==='practice'){
    G.i++;if(G.i>=G.list.length){G.list=practiceList();G.i=0;}
    if(G.score>0&&G.score%8===0&&adsUnlocked())Native.interstitial(()=>loadQ());else loadQ();
    return;
  }
  if(G.i<4){G.i++;loadQ();}else dailyDone();
}
// ヒント: 「ヒントを見る」(今日の5問は1問1回まで無料) / 2つ消す(動画)
function hintText(q){
  const p=P(q.id);
  if(q.type==='cap')return `国旗は ${flagOf(p)}`;      // 首都の問題は国旗がヒント
  return `${p.sub}の国。首都は「${[...p.cap][0]}…」`;   // 国旗・地図
}
function meaningHint(){
  const q=G.list[G.i];
  const doIt=()=>{G.mean=true;S.stats.hints++;save();
    if(q.type==='cap')renderQ(q);else{const m=$('ymean');m.className='ymean on';m.innerHTML=`💡 ${hintText(q)}`;}
    $('bMean').disabled=true;};
  if(G.mode==='practice')Native.rewarded('ヒントを見る','動画を見ると、この国のヒントが見られます。',doIt,()=>{});
  else doIt();
}
function removeTwo(){
  const q=G.list[G.i];
  Native.rewarded('ヒント','動画を見ると、まちがいの候補を2つ消せます。',()=>{
    G.hint++;S.stats.hints++;save();
    const cand=[...document.querySelectorAll('.ch')].filter(b=>+b.dataset.id!==q.id&&!b.classList.contains('off')&&!b.classList.contains('wrong'));
    shuffle(cand).slice(0,2).forEach(b=>b.classList.add('off'));
    if(!Native.isPremium())$('bHint').disabled=true;toast('候補を2つ消しました');
  },()=>{});
}
function dailyDone(){
  const k=keyFromN(G.n),today=dayKey();
  if(G.mode==='daily'){S.streak=(S.lastDay===yKey())?S.streak+1:(S.lastDay===today?S.streak:1);S.lastDay=today;}
  else S.stats.archive++;
  const perfect=G.marks.every(m=>m==='🟩');if(perfect)S.stats.perfect++;
  const rec={n:G.n,marks:G.marks,ids:G.list.map(q=>q.id),types:G.list.map(q=>q.type),streak:S.streak,mode:G.mode};
  S.daily[k]=rec;save();Native.track(G.mode==='daily'?'daily_complete':'archive_complete',{n:G.n,correct:G.marks.filter(m=>m!=='🟥').length,streak:S.streak});showDailyResult(rec,true);checkBadges();
}
function showDailyResult(rec,fresh=false){
  const isToday=rec.n===todayN();
  $('rTitle').textContent=(isToday?'今日の5問':'過去問 '+keyFromN(rec.n))+' #'+rec.n;
  const g=rec.marks.filter(m=>m==='🟩').length;
  $('rBig').textContent=g===5?'満点!':g>=4?'お見事':g>=3?'いい感じ':g>=1?'まずまず':'次はきっと';
  $('rTiles').textContent=rec.marks.join('');
  $('rStreakCard').style.display=isToday?'':'none';$('rStreak').textContent=S.streak;
  $('rList').innerHTML=rec.ids.map((id,i)=>resHTML(P(id),rec.marks[i],rec.types&&rec.types[i])).join('');
  $('rList').querySelectorAll('.res').forEach((e,i)=>{e.style.cursor='pointer';e.onclick=()=>{const p=P(rec.ids[i]);modal(p.n,prefInfo(p),null,null,'OK',p.id);};});
  const st=$('stamp');st.className='stamp';
  show('result');
  if(fresh&&g===5){setTimeout(()=>{st.className='stamp on';sfx.perfect();},250);}
  G={mode:'view',rec};
}
function practiceOver(){
  if(!G.continued){
    Native.rewarded('コンティニュー?','動画を見ると ❤ を1つ回復して続けられます。',()=>{G.continued=true;G.lives=1;G.i++;if(G.i>=G.list.length){G.list=practiceList();G.i=0;}loadQ();},()=>practiceEnd());
  }else practiceEnd();
}
function practiceEnd(){
  if(G.score>S.best)S.best=G.score;
  if(G.score>S.stats.practiceBest)S.stats.practiceBest=G.score;save();
  Native.track('practice_end',{score:G.score,continued:G.continued?1:0});$('prScore').textContent=G.score;$('prBest').textContent=S.best;
  const ids=[...new Set(G.wrongs)];
  $('prList').innerHTML=ids.map(id=>resHTML(P(id))).join('')||'<div style="color:var(--sub);font-size:13px">なし</div>';
  show('presult');checkBadges();
}
function share(){
  const rec=G&&G.rec;if(!rec)return;
  const text=`ぽちっと世界の国 #${rec.n} ${rec.marks.join('')}${rec.mode==='daily'?` 🔥${rec.streak}日目`:''}\n国旗と地図と首都で国名、わかる？`;
  Native.track('share',{method:'result',content_type:rec.mode});Native.share(text);
}

// ================= 過去問カレンダー =================
let calY,calM;
function openArchive(){const d=new Date();calY=d.getFullYear();calM=d.getMonth();renderCal();show('archive');}
function renderCal(){
  const first=new Date(calY,calM,1),last=new Date(calY,calM+1,0);
  $('calTitle').textContent=`${calY}年${calM+1}月`;
  const minM=new Date(EPOCH.getFullYear(),EPOCH.getMonth(),1),now=new Date();
  $('calPrev').disabled=first<=minM;$('calNext').disabled=(calY>now.getFullYear())||(calY===now.getFullYear()&&calM>=now.getMonth());
  const cal=$('cal');cal.innerHTML=['日','月','火','水','木','金','土'].map(d=>`<div class="dow">${d}</div>`).join('');
  for(let i=0;i<first.getDay();i++){const e=document.createElement('div');e.className='day off';cal.appendChild(e);}
  const tN=todayN();
  for(let d=1;d<=last.getDate();d++){
    const dt=new Date(calY,calM,d),n=dayIndex(dt),k=dayKey(dt),rec=S.daily[k];
    const e=document.createElement('div');e.className='day';e.innerHTML=`<span>${d}</span>`;
    if(n<1||n>tN){e.classList.add('na');}
    else{
      if(n===tN)e.classList.add('today');
      if(rec){e.classList.add('done');e.innerHTML+=`<div class="m">${rec.marks.map(m=>`<i class="${m==='🟩'?'g':m==='🟨'?'y':'r'}"></i>`).join('')}</div>`;}
      e.onclick=()=>{sfx.tap();n===tN?startDaily():startArchive(n);};
    }
    cal.appendChild(e);
  }
}

// ================= 設定 =================
const OTHER_APPS=[
  {n:'ぽちっと漢字',d:'まんなかの漢字を当てる毎日3問',id:'6811293101'},
  {n:'ぽちっと四字熟語',d:'□に入る漢字を選ぶ毎日5問',id:'6818395412'},
  {n:'ぽちっと反射神経',d:'反応速度で反射神経年齢を測定',id:'6818035906'},
  {n:'押すな！ボタン',d:'押してはいけないボタンを避けるバカゲー',id:'6793996412'},
];
function renderSettings(){
  $('swSound').classList.toggle('on',S.sound);$('swNotif').classList.toggle('on',S.notif);$('notifTime').value=S.notifTime;
  $('otherApps').innerHTML=OTHER_APPS.map(a=>`<a class="res" style="text-decoration:none;color:inherit" href="https://apps.apple.com/jp/app/id${a.id}" target="_blank" rel="noopener"><span>${a.n}</span><span class="w">${a.d} ›</span></a>`).join('');
}

// ================= イベント =================
$('bDaily').onclick=()=>{sfx.tap();startDaily();};
$('bPractice').onclick=()=>{sfx.tap();startPractice();};
$('bArchive').onclick=()=>{sfx.tap();openArchive();};
$('bBadges').onclick=()=>{sfx.tap();renderBadges();};
$('bZukan').onclick=()=>{sfx.tap();renderZukan();};
$('hBadgeBox').onclick=renderBadges;$('hZukanBox').onclick=renderZukan;
$('bHow').onclick=()=>modal('遊び方',`3種類の問題で国の名前を当てます。\n・この国旗の国は？: 国旗から当てる\n・地図のどこ？: 光っている国の名前\n・首都から当てよう: 首都がある国を当てる\n\n・毎日5問（4択3問・6択2問）。みんな同じ問題です\n・1回目で正解なら🟩、2回目かヒントを使ったら🟨、2回まちがえたら🟥\n・「ヒントを見る」は今日の5問なら各問1回無料\n・正解した国は図鑑に集まります（${PREF.length}か国コンプリートを目指そう）\n・練習モードは❤3つでどこまで続くか挑戦`);
$('bSettings').onclick=()=>{sfx.tap();renderSettings();show('settings');};
$('bQuit').onclick=()=>modal('やめますか?',G&&G.mode==='practice'?'練習の記録は保存されません。':'途中の回答は保存されません(最初からになります)。',()=>renderHome(),()=>{});
$('bNext').onclick=next;$('bHint').onclick=()=>{sfx.tap();removeTwo();};$('bMean').onclick=()=>{sfx.tap();meaningHint();};
$('bResHome').onclick=renderHome;$('bResPractice').onclick=startPractice;$('bResArchive').onclick=openArchive;$('bShare').onclick=share;
$('bPResHome').onclick=renderHome;$('bPHome').onclick=renderHome;$('bPAgain').onclick=startPractice;
$('bArcHome').onclick=renderHome;$('calPrev').onclick=()=>{calM--;if(calM<0){calM=11;calY--;}renderCal();};$('calNext').onclick=()=>{calM++;if(calM>11){calM=0;calY++;}renderCal();};
$('bBadHome').onclick=renderHome;$('bSetHome').onclick=renderHome;$('bZukHome').onclick=renderHome;
$('bTutAgain').onclick=()=>{S.tut=false;save();startTutorial();};
$('bReset').onclick=()=>modal('記録をリセット','連続記録・図鑑・バッジ・履歴を消します。よろしいですか?',()=>{const keep={sound:S.sound,notif:S.notif,notifTime:S.notifTime};S=Object.assign(JSON.parse(JSON.stringify(DEF)),keep);S.firstDay=dayKey();save();toast('リセットしました');renderHome();},()=>{});
$('swSound').onclick=()=>{S.sound=!S.sound;save();renderSettings();sfx.tap();};
$('swNotif').onclick=()=>{S.notif=!S.notif;save();renderSettings();Native.scheduleDaily(S.notifTime,S.notif);};
$('notifTime').onchange=e=>{S.notifTime=e.target.value;save();toast('通知時刻: '+S.notifTime);Native.scheduleDaily(S.notifTime,S.notif);};
$('bBuy').onclick=()=>{sfx.tap();Native.buyPremium();};
$('bRestore').onclick=()=>{sfx.tap();Native.restore();};

// ================= 広告・課金 =================
// インタースティシャルは初回起動から3日目以降、練習モードの区切りでのみ(最初の体験を守る)
function adsUnlocked(){
  if(Native.isPremium()||!S.firstDay)return false;
  return (mid(new Date())-mid(new Date(S.firstDay)))/DAY>=2;
}
window.onPremiumChanged=v=>{applyPremium();if(v)modal('ありがとうございます','広告なし+ヒント無制限になりました。');};
function applyPremium(){
  const p=Native.isPremium();
  document.body.classList.toggle('has-banner',!p&&Native.isApp);
  const b=$('bBuy');if(b){b.disabled=p;b.textContent=p?'購入済み':'購入';}
  const n=$('buyNote');if(n)n.textContent=p?'購入済み。広告は表示されません':'¥300 買い切り';
}
function updateBanner(){Native.banner(!Native.isPremium()&&$('home').classList.contains('on'));}
const _show=show;show=id=>{_show(id);updateBanner();};

if(!S.firstDay){S.firstDay=dayKey();save();}
applyPremium();
renderHome();
Native.init().then(()=>{applyPremium();updateBanner();Native.scheduleDaily(S.notifTime,S.notif);});
