/* せかいタッチ — iOSの機能をつなぐ部分（広告・課金・シェア・計測）
 * ブラウザで開いたときは、広告や課金はダイアログで代わりに動く。
 *
 * 守っていること（過去の審査の教訓）
 *  - ATTの許可は、アプリが前面に出てから自分で要求する → そのあとAdMobを初期化する
 *  - 課金は deviceready を待ってから初期化。購入時に商品が取れていなければ取り直す
 *  - 購入した商品を含むレシートだけを「購入済み」として扱う
 */
var Native = (function () {
  'use strict';

  var CONFIG = {
    testing: false,
    ads: {
      banner: 'ca-app-pub-7792368657314009/2711119271',
      interstitial: 'ca-app-pub-7792368657314009/2755526310',
      rewarded: 'ca-app-pub-7792368657314009/9875293420'
    },
    product: 'pochittosekai_premium',
    storeUrl: 'https://apps.apple.com/jp/app/id6824358920'
  };

  var cap = window.Capacitor;
  var inApp = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  var plugins = {};
  var state = { premium: false, banner: false, interstitial: false };
  try { state.premium = localStorage.getItem('st_premium') === '1'; } catch (e) {}

  function say() { try { console.log.apply(console, ['[native]'].concat([].slice.call(arguments))); } catch (e) {} }
  function ask(title, body, ok, cancel, okLabel) {
    if (window.UI && UI.dialog) UI.dialog(title, body, ok, cancel, okLabel);
    else if (ok) ok();
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------- 起動 ---------- */
  function start() {
    if (!inApp) return Promise.resolve();
    plugins.ads = cap.Plugins.AdMob;
    plugins.share = cap.Plugins.Share || null;
    plugins.analytics = cap.Plugins.FirebaseAnalytics || null;
    return askTracking().then(startAds).then(startStore).catch(function (e) { say('start error', e); });
  }

  function visible() {
    return new Promise(function (resolve) {
      if (document.visibilityState === 'visible') { wait(800).then(resolve); return; }
      var h = function () {
        if (document.visibilityState !== 'visible') return;
        document.removeEventListener('visibilitychange', h); wait(800).then(resolve);
      };
      document.addEventListener('visibilitychange', h);
      wait(5000).then(resolve);
    });
  }

  function trackingStatus() {
    var a = plugins.ads;
    if (!a || !a.trackingAuthorizationStatus) return Promise.resolve(null);
    return a.trackingAuthorizationStatus().then(function (r) { return r && r.status; }).catch(function () { return null; });
  }

  function askTracking() {
    var a = plugins.ads;
    if (!a || !a.requestTrackingAuthorization) return Promise.resolve();
    return visible().then(trackingStatus).then(function (s) {
      if (s && s !== 'notDetermined') return s;
      return a.requestTrackingAuthorization().then(trackingStatus).then(function (s2) {
        if (s2 !== 'notDetermined') return s2;
        return wait(2000).then(function () { return a.requestTrackingAuthorization(); }).then(trackingStatus);
      });
    }).then(function (s) { say('ATT', s); }).catch(function (e) { say('ATT error', e); });
  }

  function startAds() {
    var a = plugins.ads;
    if (!a) return Promise.resolve();
    return a.initialize({ initializeForTesting: CONFIG.testing }).then(loadInterstitial);
  }

  function loadInterstitial() {
    var a = plugins.ads;
    if (!a || state.premium) return;
    a.prepareInterstitial({ adId: CONFIG.ads.interstitial, isTesting: CONFIG.testing })
      .then(function () { state.interstitial = true; })
      .catch(function () { state.interstitial = false; });
  }

  /* ---------- 課金 ---------- */
  function startStore() {
    return new Promise(function (resolve) {
      var begun = false;
      var go = function () {
        if (begun) return; begun = true;
        var CP = window.CdvPurchase;
        if (!CP) { resolve(); return; }
        try {
          var store = CP.store;
          store.register([{ id: CONFIG.product, type: CP.ProductType.NON_CONSUMABLE, platform: CP.Platform.APPLE_APPSTORE }]);
          store.when()
            .approved(function (tx) { if (includesProduct(tx)) tx.verify(); })
            .verified(function (receipt) { receipt.finish(); checkOwned(); })
            .finished(function (tx) { if (includesProduct(tx)) setPremium(true); })
            .receiptUpdated(checkOwned);
          store.error(function (e) { say('store', e && e.message); });
          store.initialize([CP.Platform.APPLE_APPSTORE]).then(function () { checkOwned(); resolve(); });
        } catch (e) { say('store error', e); resolve(); }
      };
      document.addEventListener('deviceready', go, { once: true });
      setTimeout(go, 2500);
    });
  }

  function includesProduct(tx) {
    try { return !!(tx && tx.products && tx.products.some(function (p) { return p.id === CONFIG.product; })); }
    catch (e) { return false; }
  }

  function checkOwned() {
    try { var CP = window.CdvPurchase; if (CP && CP.store.owned(CONFIG.product)) setPremium(true); } catch (e) {}
  }

  function setPremium(on) {
    if (state.premium === on) return;
    state.premium = on;
    try { localStorage.setItem('st_premium', on ? '1' : '0'); } catch (e) {}
    if (on) showBanner(false);
    if (window.App && App.onPremium) App.onPremium(on);
  }

  function buy() {
    if (!inApp) { ask('アプリ版で購入できます', '広告なし＋ヒント使い放題（¥300・買い切り）は、アプリ版で購入できます。'); return; }
    try {
      var CP = window.CdvPurchase, store = CP.store;
      var order = function () {
        var p = store.get(CONFIG.product, CP.Platform.APPLE_APPSTORE);
        if (p && p.getOffer()) { p.getOffer().order(); return true; }
        return false;
      };
      if (!order()) store.update().then(function () {
        if (!order()) ask('しばらくしてからお試しください', '商品の情報を取得できませんでした。通信環境をご確認ください。');
      });
    } catch (e) { say('buy error', e); }
  }

  function restore() {
    if (!inApp) { ask('アプリ版で復元できます', 'ブラウザ版では購入の復元はできません。'); return; }
    try {
      window.CdvPurchase.store.restorePurchases().then(function () {
        checkOwned();
        ask('購入の復元', state.premium ? '広告なしを復元しました。' : '復元できる購入はありませんでした。');
      });
    } catch (e) { say('restore error', e); }
  }

  /* ---------- 広告 ---------- */
  function showBanner(on) {
    var a = plugins.ads;
    if (!inApp || !a) return;
    if (!on || state.premium) {
      if (state.banner) { a.hideBanner().catch(function () {}); state.banner = false; }
      return;
    }
    if (state.banner) return;
    state.banner = true;
    a.showBanner({ adId: CONFIG.ads.banner, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: 0, isTesting: CONFIG.testing })
      .catch(function () { state.banner = false; });
  }

  function interstitial(next) {
    next = next || function () {};
    var a = plugins.ads;
    if (!inApp || !a || state.premium || !state.interstitial) { next(); return; }
    state.interstitial = false;
    a.showInterstitial().then(function () { loadInterstitial(); next(); })
      .catch(function () { loadInterstitial(); next(); });
  }

  // ヒント用のリワード動画。購入済みならそのまま使える
  function reward(title, body, granted, declined) {
    granted = granted || function () {}; declined = declined || function () {};
    if (state.premium) { granted(); return; }
    var a = plugins.ads;
    if (!inApp || !a) { ask(title, body + '\n（ブラウザ版では動画の代わりにこのダイアログが出ます）', granted, declined, '動画を見る'); return; }
    ask(title, body, function () {
      a.prepareRewardVideoAd({ adId: CONFIG.ads.rewarded, isTesting: CONFIG.testing })
        .then(function () { return a.showRewardVideoAd(); })
        .then(function (r) { if (r) { track('hint_reward'); granted(); } else declined(); })
        .catch(function () { ask('動画を読み込めませんでした', '通信環境をご確認ください。', declined); });
    }, declined, '動画を見る');
  }

  /* ---------- シェア・計測 ---------- */
  function share(text) {
    var full = text + '\n' + CONFIG.storeUrl;
    if (plugins.share) { plugins.share.share({ text: text, url: CONFIG.storeUrl, dialogTitle: 'シェア' }).catch(function () {}); return; }
    if (navigator.share) { navigator.share({ text: full }).catch(function () {}); return; }
    try {
      navigator.clipboard.writeText(full).then(function () { ask('コピーしました', 'SNSに貼り付けてシェアしてください。\n\n' + full); },
        function () { ask('シェア', full); });
    } catch (e) { ask('シェア', full); }
  }

  function track(name, params) {
    var f = plugins.analytics;
    if (!f) return;
    try { f.logEvent({ name: name, params: params || {} }).catch(function () {}); } catch (e) {}
  }

  return {
    inApp: inApp, start: start, buy: buy, restore: restore, banner: showBanner,
    interstitial: interstitial, reward: reward, share: share, track: track,
    premium: function () { return state.premium; }
  };
})();
