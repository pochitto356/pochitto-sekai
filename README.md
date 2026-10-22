# せかいタッチ（iOS / Capacitor 7）

地図をさわって世界の国を覚えるアプリ。旧「ぽちっと世界の国」（4択クイズ）を、地図そのものが主役のアプリとして作り直したもの（2026-10-22）。

- **さがす**：世界地図を拡大・移動して国をタップ → 国旗・首都・面積（日本と比べて）・陸でとなりの国
- **場所あて**：「○○はどこ？」→ 地図の上でその国をタップ。外れたら方角と距離のヒント、2回目で正解なら1点
- **きろく**：国ごとの習熟度（☆0〜3）で地図をぬり分け。地域ごとの達成度・にがてな国

## ファイル
- `www/geo.js` … 地図データ（Natural Earth 1:50m をメルカトル図法でSVGパス化。194か国）
- `www/app.js` … 地図の表示・操作・各モード
- `www/native.js` … AdMob / 課金（pochittosekai_premium）/ シェア / Firebase Analytics
- `assets/` … アイコンとスプラッシュ（ビルド時に @capacitor/assets で生成）
- `firebase/GoogleService-Info.plist` … Firebase 設定

地図データ：Natural Earth（パブリックドメイン）
