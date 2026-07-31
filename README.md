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

Công cụ này **chỉ thu thập nội dung bài đăng** và link tới chính bài đó.

Nó **không** thu thập thông tin người đăng: không link profile, không user id,
không tên tác giả. Đầu ra dùng để tổng hợp thông tin thị trường, không phải để
tạo danh sách nhắn tin.

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

Chạy `npm test` để chắc chắn mọi thứ ổn (73 test, không cần mạng).

### Đăng nhập một lần

```bash
npm run login
```

Mở cửa sổ trình duyệt, bạn **tự đăng nhập bằng tay** — kể cả bước 2FA. Script
không đọc mật khẩu từ đâu cả; nó chỉ lưu cookie vào `storage-state.json` để các
lần chạy sau khỏi đăng nhập lại.

> `storage-state.json` chứa cookie Facebook của bạn. Đã nằm trong `.gitignore` —
> đừng commit, đừng chia sẻ.

---

## Chạy

```bash
npm run run              # collect → analyze → report → send
npm run run -- --no-mail # tạo báo cáo, không gửi mail
```

Hoặc chạy từng bước (mỗi bước ghi kết quả ra đĩa nên chạy lại được độc lập):

```bash
npm run collect   # → data/posts.json
npm run analyze   # → data/analysis.json
npm run report    # → out/report-YYYY-MM-DD.html + .csv
npm run send      # gửi báo cáo gần nhất
```

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

## Khử trùng lặp

`data/seen.json` lưu vân tay (fingerprint) của mọi bài đã báo cáo, giữ trong 30
ngày. Bài nằm lâu ở đầu feed sẽ được thu thập lại mỗi ngày nhưng chỉ vào báo cáo
**một lần**.

Vân tay tính từ nội dung bài (không phải từ DOM id, vì Facebook đổi id mỗi lần
render), nên vẫn nhận ra bài cũ sau khi Facebook re-render.

Việc đánh dấu "đã báo cáo" diễn ra **sau khi** file báo cáo được ghi thành công
— nếu bước report lỗi, bài vẫn xuất hiện ở lần chạy sau.

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
    browser.js        vòng đời Playwright + phát hiện checkpoint
    login.js          đăng nhập thủ công một lần
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
test/                 73 test, chạy offline
```

---

## Giới hạn đã biết

- **DOM Facebook hay đổi.** `scrape.js` bám vào `[role="article"]` — thuộc tính
  accessibility nên ổn định hơn class name, nhưng không có gì bảo đảm. Nếu bỗng
  nhiên thu được 0 bài, đây là chỗ cần sửa đầu tiên.
- **Không có thời gian đăng chính xác.** Facebook hiển thị nhãn tương đối
  ("2 giờ"). Trường `timeLabel` giữ nguyên nhãn đó; `collectedAt` mới là mốc
  thời gian đáng tin.
- **Bài dài có thể bị cắt.** Script bấm "Xem thêm" trước khi trích, nhưng nút
  bị re-render thì bỏ qua và lấy phần text đang có.
- **Chỉ đọc bài, không đọc bình luận.**
