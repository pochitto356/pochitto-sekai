# ぽちっと世界の国 (pochitto-sekai)

国旗・世界地図・首都から国名を当てる、毎日5問の世界の国クイズ。Capacitor 7 製 iOS アプリ（ぽちっと都道府県のエンジンを流用、Firebase計測は四字熟語1.0.2と同じ構成）。

## 構成
| ファイル | 内容 |
|---|---|
| `www/index.html` | 画面とスタイル（テーマ色: 青 #1f6fae、光る国はオレンジ） |
| `www/app.js` | ゲーム本体（今日の5問・過去問・練習・図鑑・バッジ・シェア・計測イベント） |
| `www/country.js` | 194か国データ（国名・首都・地域・小地域・面積・隣国・やさしい国・地図に出すか） |
| `www/map.js` | 世界地図のSVGパス（Natural Earth 1:50m / world-atlas を NaturalEarth1 図法で投影。viewBox 0 0 1000 444） |
| `www/native.js` | 広告・課金・通知・シェア・Firebase計測の橋渡し（ブラウザでは全部ダミー動作） |
| `assets/icon.png` `splash.png` | 仮アイコン（地球儀＋「ぽ」） |
| `privacy/pochittosekai-privacy.html` | プライバシーポリシー（Firebase記載済み。pochitto356.github.io に置く） |
| `codemagic.yaml` | Codemagic ビルド設定（Firebase設定ステップ入り。`firebase/GoogleService-Info.plist` が必要） |
| `STORE.md` | App Store 掲載文面 |

## 出題の仕組み
- 1日の5問は `[国旗4択, 地図4択, 首都4択, 国旗6択, 地図6択]`
- 4択は「やさしい国」63か国から（日本人になじみのある国）。6択はすべての国、ダミーは同じ小地域・隣国から
- 地図問題は地図で見える158か国のみ。小さい国は丸で囲んで表示
- 首都問題は首都名＝国名の国（シンガポール等）と議論のある国（イスラエル等）を除外
- 国旗は絵文字（iOSで表示）。画像素材なし
- `EPOCH`（app.js）が #1 の日。公開日に合わせて変更する

## リリース前に差し替えるもの（★）
- `www/native.js` の `IS_TESTING=false` と広告ユニットID 3つ、`APP_STORE_ID`
- `codemagic.yaml` の `APP_APPLE_ID` と `ADMOB_APP_ID`
- `firebase/GoogleService-Info.plist`（Firebaseの pochitto-games にiOSアプリ追加して取得）
- App Store Connect: 非消耗型 IAP `pochittosekai_premium`
- `www/app.js` の `EPOCH`

## データの出典
- 国名・地域・国境・面積: world-countries (mledoze, ODbL)
- 地図: Natural Earth (public domain) / world-atlas
- 首都の日本語表記: 外務省の表記に合わせて手入力（2026-10-19 確認。赤道ギニアは2026年1月の首都移転を反映し首都問題からは除外）
