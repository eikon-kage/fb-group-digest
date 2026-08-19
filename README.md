# fb-group-digest

Đọc bài đăng từ các nhóm Facebook mà tài khoản của bạn **đã là thành viên**, lọc
theo từ khoá, phân tích bằng Claude, rồi gửi báo cáo qua email.

```
collect  →  analyze  →  report  →  send
 Playwright  từ khoá +   HTML +    SMTP
             Claude      CSV
```

---

## Phạm vi — đọc kỹ trước khi dùng

Công cụ này thu thập nội dung bài đăng, link tới bài, **và thông tin người
đăng**: tên hiển thị, ảnh đại diện, link trang cá nhân, user id.

> **Đây là dữ liệu định danh.** `data/posts.json`, `data/posts.csv` và file báo
> cáo chứa đủ thông tin để dựng danh sách liên hệ. Các thư mục đó nằm trong
> `.gitignore` — đừng commit, đừng chia sẻ, và cân nhắc rằng bạn đang lưu dữ
> liệu cá nhân của người khác trên máy mình.
>
> Không cần phần này thì đặt `COLLECT_AUTHORS=false`.

Nó **không** có bất kỳ kỹ thuật né phát hiện bot nào: dùng Chromium mặc định,
user-agent mặc định, không proxy, không giả fingerprint, không random delay để
mô phỏng người thật. Các độ trễ trong code là để giảm tải, không phải để nguỵ
trang — và chúng được ghi chú rõ như vậy ngay trong source.

Gặp checkpoint thì script **dừng hẳn** và báo lỗi. Nó không thử vượt qua.

### Rủi ro bạn cần biết

Tự động hoá trình duyệt vi phạm điều khoản sử dụng của Facebook. Hình phạt nếu
có sẽ rơi vào **tài khoản của bạn** — nhẹ thì checkpoint, nặng thì khoá tính
năng. Quy mô nhỏ (20 nhóm, 1 lần/ngày) rủi ro thấp hơn nhiều so với chạy liên
tục, nhưng không phải bằng không.

**Khuyến nghị: dùng tài khoản phụ.**

Nếu bạn là admin nhóm, hãy dùng [Graph API Groups][graph] thay cho phần
`collect` — hợp lệ, có rate limit rõ ràng, không rủi ro tài khoản. Toàn bộ phần
lọc / phân tích / báo cáo bên dưới dùng lại được nguyên vẹn.

[graph]: https://developers.facebook.com/docs/graph-api/reference/v21.0/group/feed

---

## Cài đặt

```bash
npm install
npx playwright install chromium

cp .env.example .env                       # điền SMTP + (tuỳ chọn) API key
cp config/groups.example.json config/groups.json   # điền nhóm + từ khoá
```

Chạy `npm test` để chắc chắn mọi thứ ổn (117 test, không cần mạng).

### Đăng nhập một lần

```bash
npm run login
```

Mở cửa sổ trình duyệt, bạn **tự đăng nhập bằng tay** — kể cả bước 2FA. Script
không đọc mật khẩu từ đâu cả.

Toàn bộ phiên đăng nhập nằm trong **một thư mục profile Chromium cố định**
(mặc định `.fb-profile/`, đổi qua `FB_USER_DATA_DIR` trong `.env`) — đúng như
một profile Chrome bình thường. Mỗi lần chạy `collect`, tool mở lại chính
profile đó, dùng lại đúng một tab, và ghi cookie đã gia hạn ngược lại vào thư
mục khi đóng. Nên bạn chỉ đăng nhập **một lần**, không phải login lại sau mỗi
lần chạy.

Chạy lại `npm run login` lúc nào cũng được: nếu profile còn đăng nhập, script
báo "đã đăng nhập sẵn" rồi thoát; nếu Facebook bắt xác minh lại, bạn xử lý ngay
trong cửa sổ đó.

> `.fb-profile/` chứa cookie Facebook của bạn. Đã nằm trong `.gitignore` —
> đừng commit, đừng chia sẻ.
>
> Đừng chạy hai tiến trình cùng lúc trên cùng một profile (ví dụ `login` trong
> khi cron đang `collect`): Playwright không khoá thư mục, tiến trình đóng sau
> sẽ ghi đè session của tiến trình kia.

---

## Chạy

```bash
npm run run              # collect → analyze → report → send
npm run run -- --no-mail # tạo báo cáo, không gửi mail
```

Hoặc chạy từng bước (mỗi bước ghi kết quả ra đĩa nên chạy lại được độc lập):

```bash
npm run collect   # → data/posts.json
npm run analyze   # → data/analysis.json (+ data/history.json)
npm run report    # → out/report-YYYY-MM-DD.html + .csv
npm run send      # gửi báo cáo gần nhất
```

Một lệnh không có script npm, gọi thẳng CLI:

```bash
node src/cli.js mark-read              # đánh dấu bài đang có là đã đọc, lần sau bỏ qua
node src/cli.js mark-read --from analysis   # chỉ đánh dấu những bài đã vào báo cáo
```

`node src/cli.js help` in ra toàn bộ lệnh và tuỳ chọn.

### Tuỳ chọn

Qua `npm run`, tuỳ chọn phải đứng sau `--`:
`npm run collect -- --all`. Gọi thẳng `node src/cli.js collect --all` thì không cần.

| Tuỳ chọn              | Áp dụng cho        | Ý nghĩa                                                    |
| --------------------- | ------------------ | ---------------------------------------------------------- |
| `--config <path>`     | `collect`, `analyze` | File cấu hình nhóm/từ khoá (mặc định `config/groups.json`) |
| `--all`               | `collect`          | Bỏ qua bộ nhớ, lấy lại tất cả và ghi đè `data/posts.json`   |
| `--all`               | `analyze`          | Phân tích lại cả bài đã báo cáo lần trước (tốn thêm lời gọi Claude) |
| `--posts-csv <path>`  | `collect`          | Ghi đè đường dẫn CSV bài thô (mặc định `data/posts.csv`)    |
| `--from <nguồn>`      | `mark-read`        | `posts` (mặc định) hoặc `analysis`                          |
| `--date <yyyy-mm-dd>` | `report`, `send`   | Ngày dùng để đặt tên file báo cáo (mặc định hôm nay)        |
| `--html <path>`       | `report`, `send`   | Ghi đè đường dẫn file HTML                                  |
| `--csv <path>`        | `report`, `send`   | Ghi đè đường dẫn file CSV báo cáo                           |
| `--history <ngày>`    | `report`           | Kèm lại bài đã báo cáo trong N ngày qua (mặc định 7, `0` = tắt) |
| `--no-mail`           | `run`              | Tạo báo cáo nhưng không gửi mail                            |

`run` truyền nguyên tuỳ chọn xuống cả bốn bước, nên dùng được hết bảng trên.

Chạy hằng ngày lúc 8h sáng:

```cron
0 8 * * *  cd /path/to/fb-group-digest && /usr/local/bin/node src/cli.js run >> run.log 2>&1
```

> Cron chạy `HEADLESS=false` sẽ cần một session đồ hoạ. Nếu chạy trên máy chủ
> không màn hình, đặt `HEADLESS=true` — nhưng khi đó bạn sẽ không xử lý được
> checkpoint, script chỉ dừng và ghi log.

---

## Cấu hình từ khoá

`config/groups.json`:

```json
{
    "groups": [
        { "id": "123", "name": "Mua bán đồ cũ HN", "url": "https://www.facebook.com/groups/123" }
    ],
    "rules": [
        {
            "name": "Cần mua laptop",
            "all": ["cần mua"],
            "any": ["laptop", "macbook", "thinkpad"],
            "none": ["đã mua", "đã có"],
            "weight": 3
        }
    ],
    "minScore": 1
}
```

| Clause   | Ý nghĩa                                    |
| -------- | ------------------------------------------ |
| `all`    | Mọi từ đều phải xuất hiện                  |
| `any`    | Ít nhất một từ phải xuất hiện              |
| `none`   | Không từ nào được xuất hiện (loại bài)     |
| `regex`  | Mọi pattern đều phải khớp                  |
| `weight` | Cộng vào điểm của bài khi rule khớp        |

Bài nào có tổng điểm `>= minScore` thì vào báo cáo, sắp xếp theo điểm giảm dần.

### Tiếng Việt có dấu / không dấu

Mọi so khớp chạy trên dạng đã **fold**: bỏ dấu, `đ` → `d`, viết thường. Nên
rule `"cần mua"` bắt được cả `"cần mua"`, `"CAN MUA"`, và `"can mua"`.

So khớp có tôn trọng ranh giới từ, nên `"an"` **không** khớp trong `"bánh"`.

Riêng `regex` cũng chạy trên text đã fold — **viết pattern không dấu**:

```json
{ "name": "Giá tiền", "regex": ["\\d+\\s*(tr|trieu)"] }
```

Rule không có clause nào sẽ báo lỗi lúc load config, thay vì âm thầm khớp mọi bài.

---

## Đọc báo cáo HTML

File `out/report-*.html` mở bằng trình duyệt là đủ, không cần server.

- **Chọn nhóm**: thanh lọc dính ở đầu trang có một chip cho mỗi nhóm. Bấm để
  bật/tắt nhóm, **Alt/⌘ + bấm** để chỉ xem một nhóm. Nhiều nhóm thì gõ vào ô
  *Tìm nhóm…* rồi bấm **Tất cả** / **Bỏ hết** — hai nút này chỉ áp cho các chip
  đang hiện, nên "chọn đúng 5 nhóm tuyển dụng" là gõ *tuyen dung* → **Tất cả**.
  Số trên chip là số bài **chưa đọc** của nhóm đó.
- **Đã đọc**: mỗi bài có nút **✓ Đã đọc** ở góc dưới phải, mỗi nhóm có
  **✓ Cả nhóm** ở tiêu đề. Bài đã đánh dấu bị ẩn ngay (tắt **Ẩn đã đọc** để xem
  lại và bỏ đánh dấu, hoặc **Xoá đánh dấu** để xoá sạch).
- **Chỉ gấp**: chỉ hiện những bài Claude gắn `urgency: cao`.

Trạng thái đã đọc và bộ nhóm đang chọn lưu trong `localStorage` của trình duyệt
(giữ 90 ngày), khoá theo id permalink giống `data/seen.json` — nên đóng file mở
lại vẫn giữ nguyên, và cùng một bài xuất hiện ở báo cáo sau vẫn nhận ra. Đây là
bộ lọc **khi đọc**, không đụng tới `data/seen.json`; muốn lần `collect` sau bỏ
qua thì vẫn dùng `node src/cli.js mark-read`.

Thanh lọc và các nút chạy bằng JavaScript. Mail client thường chặn script, nên
báo cáo gửi qua email hiện đúng như trước: không thanh lọc, chỉ có dãy link nhảy
tới từng nhóm.

---

## Bài từ lần chạy trước

Một lần chạy thường chỉ ra vài bài mới, đọc rời rạc. Nên báo cáo mặc định kèm
lại **mọi bài đã báo cáo trong 7 ngày qua**, trộn chung vào đúng nhóm của nó,
gắn nhãn mờ *lần trước* và có tooltip ghi nó nằm trong báo cáo ngày nào.

- Đổi cửa sổ: `node src/cli.js report --history 14`. Tắt hẳn: `--history 0`.
- Thanh lọc có thêm nút **Chỉ bài mới** để ẩn chúng khi cần (trạng thái được nhớ
  lại giữa các lần mở file, cùng chỗ với "Ẩn đã đọc").
- Bài cũ **không** được đẩy lên đầu dù gắn `gấp` — nó đã có lượt đứng đầu ở báo
  cáo lần trước rồi.
- CSV vẫn chỉ chứa bài mới của lần chạy này, để còn dùng làm bản ghi máy đọc.

Kho lưu là `data/history.json`, ghi ở bước `analyze` cùng lúc với kết quả phân
tích, giữ 30 ngày. Vì đã lưu sẵn kết quả phân tích nên hiện lại bài cũ **không
tốn thêm lời gọi Claude** nào.

Kho này chỉ có dữ liệu từ lúc bạn cập nhật tính năng trở đi. Muốn kéo lại những
bài đã bị đánh dấu "đã báo cáo" từ trước, chạy `npm run analyze -- --all` một
lần: nó phân tích lại toàn bộ `data/posts.json` (tốn lời gọi Claude) và nạp
chúng vào kho.

---

## Khử trùng lặp

`data/seen.json` lưu vân tay (fingerprint) của mọi bài đã báo cáo, giữ trong 30
ngày. Bài nằm lâu ở đầu feed sẽ được thu thập lại mỗi ngày nhưng chỉ vào báo cáo
**một lần**.

Vân tay tính từ nội dung bài (không phải từ DOM id, vì Facebook đổi id mỗi lần
render), nên vẫn nhận ra bài cũ sau khi Facebook re-render.

Việc đánh dấu "đã báo cáo" diễn ra **sau khi** file báo cáo được ghi thành công
— nếu bước report lỗi, bài vẫn xuất hiện ở lần chạy sau.

### Lần chạy sau chỉ lấy bài mới

Feed được ép sắp xếp theo thời gian (`sorting_setting=CHRONOLOGICAL`), nên khi
cuộn xuống mà **đáy** cửa sổ feed toàn bài đã lấy lần trước thì phần bài mới đã
đi qua hết — script dừng nhóm đó ngay. Ngưỡng là `STOP_AFTER_SEEN` (mặc định 5
bài liên tiếp); một cửa sổ mà **không còn bài mới nào** cũng đủ để dừng, để nhóm
ít bài hơn ngưỡng vẫn không bị cuộn tới đáy.

Đếm từ dưới lên là có chủ đích: bài ghim nằm trên đầu feed và đã được báo cáo từ
lần đầu, nên nếu đếm gộp thì một bài ghim đã đủ làm script tưởng đã hết bài mới.

Chạy lần 1 lấy 10 bài, lần 2 nhóm có thêm 3 bài → lần 2 chỉ lấy 3 bài đó rồi
dừng, không cuộn tiếp xuống những bài cũ hơn mốc của lần 1. Muốn cào lại toàn bộ
thì dùng `npm run collect -- --all` (bỏ qua bộ nhớ và ghi đè `data/posts.json`).

Bài đã có sẵn trong `data/posts.json` cũng được tính là "đã lấy", nên chạy
`collect` hai lần liên tiếp không cào lại từ đầu, kể cả khi chưa chạy `report`.

---

## Phân tích bằng Claude

Hai lượt gọi, cố ý tách ra để cân bằng chi phí:

| Lượt          | Model           | Effort | Việc                                                    |
| ------------- | --------------- | ------ | ------------------------------------------------------- |
| `classifyPosts` | `claude-opus-5` | `low`  | Phân loại từng bài (structured output, 15 bài/request)  |
| `buildDigest`   | `claude-opus-5` | `high` | Viết phần tóm tắt mở đầu báo cáo                        |

Đổi model/effort qua `.env` (`CLAUDE_MODEL`, `CLAUDE_CLASSIFY_EFFORT`,
`CLAUDE_DIGEST_EFFORT`).

Lượt phân loại dùng `output_config.format` với JSON schema nên kết quả luôn đúng
cấu trúc, không cần parse đoán. Lô nào lỗi thì được ghi log và bỏ qua — báo cáo
thiếu một lô vẫn hơn là mất cả báo cáo.

**API key:** để trống `ANTHROPIC_API_KEY` nếu bạn đã chạy `ant auth login` — SDK
tự lấy profile đã lưu.

---

## Cấu trúc

```
src/
  cli.js              điều phối các bước
  config.js           đọc .env + config/groups.json (có validate)
  collect/
    browser.js        profile Chromium cố định + phát hiện checkpoint
    login.js          đăng nhập thủ công một lần vào profile đó
    scrape.js         cuộn feed, trích nội dung bài
  filter/
    normalize.js      fold tiếng Việt, so khớp theo ranh giới từ, fingerprint
    keywords.js       engine rule all/any/none/regex + chấm điểm
  analyze/claude.js   phân loại + viết tóm tắt
  report/
    html.js           báo cáo HTML tự chứa (escape đầy đủ)
    csv.js            CSV RFC 4180 + BOM cho Excel
  mail/send.js        gửi SMTP
  store/
    io.js             đọc/ghi JSON
    seen.js           index khử trùng lặp + dọn bản ghi cũ
    history.js        kho bài đã báo cáo, để báo cáo sau kèm lại
test/                 140 test, chạy offline
```

---

## Giới hạn đã biết

- **DOM Facebook hay đổi.** `scrape.js` bám vào `[role="article"]` — thuộc tính
  accessibility nên ổn định hơn class name, nhưng không có gì bảo đảm. Nếu bỗng
  nhiên thu được 0 bài, đây là chỗ cần sửa đầu tiên.
- **Giờ đăng chỉ là xấp xỉ, và không phải bài nào cũng có.** Facebook hiển thị
  giờ đăng theo hai cách: xáo trộn từng ký tự rồi ghép lại bằng CSS, hoặc vẽ
  nguyên nhãn bằng SVG sprite (`<use xlink:href="#SvgT1">`, chữ nằm trong một
  `<text>` ở chỗ khác). `scrape.js` đọc cả hai — đo trên một nhóm thật:
  15/18 bài có giờ. Bài đọc không ra vẫn giữ `postedAt: null` và báo cáo ghi
  "không rõ giờ đăng" thay vì bịa ra ngày.
  Nhãn là tương đối ("3 hours ago", "18h") nên sai số tới một giờ; `collectedAt`
  mới là mốc chính xác. Vì vậy vẫn **không có tuỳ chọn "chỉ lấy N ngày gần
  nhất"** — `collect` ép feed sang thứ tự thời gian
  (`?sorting_setting=CHRONOLOGICAL`) rồi cuộn từ mới về cũ, giới hạn bằng
  `MAX_POSTS_PER_GROUP`.
- **Permalink không phải bài nào cũng có.** Link timestamp của bài chỉ chứa
  query tracking, không có đường dẫn. Permalink lấy được từ link của bình luận
  (chúng trỏ về bài cha), nên bài chưa có bình luận thì `permalink` là `null`.
- **Bài dài có thể bị cắt.** Script bấm "Xem thêm" trước khi trích, nhưng nút
  bị re-render thì bỏ qua và lấy phần text đang có.
- **Chỉ đọc bài, không đọc bình luận.**
