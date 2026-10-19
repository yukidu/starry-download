# Starry 生態系｜共用使用權限遮罩套件 v1.0

> 實際驗收範本：繁星下載 `download.starry.phd`。此文件是程式碼複用契約，不代表其他 App 已經安裝或啟用。

## 設計原則

- **畫面顯示**與**後端驗權**完全分開。遮罩永遠不是安全邊界；私密 API 一定要由各 App 的 Worker 驗證。
- 同一套 UI：登入、切換身分、正在確認權限、未開通、網路錯誤都由同一個 `StarryAccessUI.make(status)` 渲染。
- 同一份視覺參數：`static/starry-access.css` 的 `--starry-access-black-opacity: .60` 是**唯一**黑色透明度設定位置。兩個畫面不得套不同底色/模糊效果。此透明度是黑色覆蓋強度 60%，背景其餘仍可看見。
- 名稱、狀態字詞：`static/starry-access-ui.js` 的 `COPY`，兩個 App 的登入橋接不同，但視覺元件不變。
- 訪客不是中央會員。訪客可被單獨允許使用**安全、明確列出的公開功能**，不代表可讀取私人 API。
- 避免無限重整：初次頁面載入不主動驗權；真正點擊立即渲染 `checking`，再非同步向後端確認；重複點擊只驗一次。被禁止不自動重新登入。
- 考量 Cloudflare 免費額度：公開首頁不打 D1，只有觸發互動才確認；已核驗同一頁免重查，切回分頁後需重新確認；私密 API 仍每次由伺服器檢查。
- 同一生態系身分：帳號切換必須經過 `https://id.starry.phd/api/google-sync` 的 `appId:'starry-id'`，之後各 App 自己向 Starry ID 換票證，不能獨立更換局部會員身分。

## 檔案職責

| 檔案 | 責任 | 未來可直接複製？ |
|---|---|---|
| `static/starry-access.css` | 黑色60%、字體、排版、按鈕與畫面背景 | 是 |
| `static/starry-access-ui.js` | **不連線、不儲存帳號、不跳轉**的純遮罩元件及文案 | 是 |
| `static/access-gate.js` | 繁星下載專屬的首次點擊與狀態管理 | 須改 App 名稱與事件規則 |
| `static/starry-account-switch.js` | Starry ID 全生態系身分同步、登入及換票證 | 須改 App 專屬票證網址 |
| `cloudflare/download-access-gate.js` | 繁星下載的後端私密 API 權限檢查及訪客規則 | **不可直接複製**；必須依每個 App 做威脅評估 |
| `cloudflare/worker.js` | 安裝 HTML、路由與伺服器權限限制 | 只複用整合方式 |

## 接入新 App 的標準步驟

1. 複製原版 `starry-access.css` 與 `starry-access-ui.js`，保持檔名、版本與樣式變數一致。
2. 在應用 HTML 頭部載入共用 CSS；底部依序載入：共用 UI → App 專屬 Starry ID 身分同步 → App 專屬互動閘門。
3. `click` 捕捉階段先 `preventDefault`，**同步**呼叫 `StarryAccessUI.make('checking')`，然後發出身分/權限查詢。
4. 若有權限便立即移除遮罩；若未登入顯示 `login_required`；明確被拒絕顯示 `denied`；網路故障顯示 `unavailable`，不得把故障當作停權。
5. 根據該 App 自身的 API 清單逐一劃分公共與私人功能；在 **Cloudflare Workers / Server** 另做實際權限攔截。不得靠純前端「遮住」安全控制。
6. 訪客需要中央 App 安全整合核准。只使用 Starry ID 的獨立 `starry_guest_app_policies` 設定表讀取匿名公開互動開關；預設沒有記錄一律禁止。私人功能不受此開關放行。
7. 完成匿名、已登入允許、被拒絕、切換中央帳號、伺服器 API 防繞過、手機/桌機/PWA、反覆點擊、斷線重試、Cloudflare 無限重整等測試後，才把新 App 加進 Starry ID 安全整合清單。
8. 每個 App 分別以 GitHub main + CI + Cloudflare Production + 網域驗證為正式上線標準，並記下**當次上一個 Worker 的版本 UUID**。

## 繁星下載目前訪客能力（已實裝）

- 中央 `starry_guest_app_policies` 對 `downloadstarry` 的 `allowed=1` 才允許未登入者點擊首頁公開內容。查詢只會在使用者第一次點擊發生。
- 無訪客許可、資料表未建立或查詢錯誤時，一律走原有未登入提示，不得擅自開放。
- `/api/download-access/status` 是**唯一**可以回報 `guest_allowed` 的路由。
- **仍須 Starry ID 會員授權**：實際下載、收藏、紀錄、回報、管理 API 及受保護內頁。即使訪客按鈕開啟，也不授與 App Session。
- 如果中央顯示使用者已登入，該人的明確拒絕權限不能被訪客開放設定繞過。
- 管理員要讓訪客「真的下載」不是本次範圍：需另規劃匿名防濫用、流量上限及 Cloudflare 額度保護，另案測試後開放。

## 回溯與故障排除

- 統一改遮罩強度：只改 `starry-access.css` 的 `--starry-access-black-opacity`，不要在頁面、JS、登入流程或 Worker 再加 `rgba(...)`/模糊特效。
- 未授權畫面與確認中畫面應該完全同一塊黑色強度；若不同先檢查是否有額外背景畫面、PWA 快取或舊 CSS。
- 網頁可以自由瀏覽但私密 API 出現 403，是預期安全行為。
- 登入身分切換屬中央 Starry ID；只清除當前 App 的本地憑證，不能替其他 App 登出。
- 如 Cloudflare 上線失敗，以該次部署回報的前版 Worker UUID 還原。此文件不含假定「永遠有效」的還原代碼。
