# n8n — phân loại email bằng Gemini

Workflow n8n: mỗi email mới trong Gmail được Gemini tóm tắt và chấm mức ưu tiên,
kết quả đẩy sang Telegram / Postgres / Notion.

```
 Gmail Trigger
      │
      ▼
 Chuẩn bị email          gom from/subject/body, dựng prompt
      │
      ▼
 Gemini phân tích        generateContent + responseSchema
      │
      ▼
 Chuẩn hoá kết quả       { summary, priority, category, todo }
      │
      ├──► Ưu tiên cao? ──► Telegram      chỉ urgent/high
      ├──► Postgres                        mọi email
      └──► Notion                          mọi email
```

Phần này **độc lập** với `src/` — nó không import code JavaScript của repo, chỉ
dùng chung thư mục. Có thể copy nguyên folder `n8n/` sang chỗ khác.

---

## Import

```
n8n → Workflows → ⋯ → Import from File → n8n/workflows/gmail-triage.workflow.json
```

Import xong, workflow ở trạng thái **inactive**. Nối credential và sửa 3 chỗ
placeholder bên dưới rồi mới bật.

---

## Credential cần nối

| Node                | Loại credential          | Lấy ở đâu                                                          |
| ------------------- | ------------------------ | ------------------------------------------------------------------ |
| `Gmail Trigger`     | Gmail OAuth2             | Google Cloud Console → OAuth client, bật Gmail API                  |
| `Gemini phân tích`  | **Header Auth**          | Xem bên dưới                                                        |
| `Báo Telegram`      | Telegram API             | Token từ [@BotFather](https://t.me/botfather)                       |
| `Lưu vào Postgres`  | Postgres                 | DB của bạn                                                          |
| `Tạo trang Notion`  | Notion API               | [Internal integration](https://www.notion.so/my-integrations) token |

### Gemini — Header Auth

Node gọi thẳng REST API thay vì dùng node Gemini có sẵn, để không phụ thuộc vào
version của community node và để nhìn thấy nguyên request/response khi debug.

1. Lấy API key ở [Google AI Studio](https://aistudio.google.com/apikey).
2. n8n → Credentials → New → **Header Auth**:
   - Name: `x-goog-api-key`
   - Value: API key vừa lấy
3. Chọn credential đó ở node `Gemini phân tích`.

Model mặc định là `gemini-2.5-flash` (có free tier). Đổi model bằng cách sửa URL
trong node — chỉ đổi phần tên model, giữ nguyên `:generateContent`.

---

## Ba chỗ phải sửa sau khi import

| Node               | Field        | Giá trị hiện tại                  |
| ------------------ | ------------ | --------------------------------- |
| `Báo Telegram`     | Chat ID      | `REPLACE_WITH_TELEGRAM_CHAT_ID`   |
| `Tạo trang Notion` | Database     | `REPLACE_WITH_NOTION_DATABASE_ID` |
| `Lưu vào Postgres` | —            | cần chạy `sql/schema.sql` trước   |

**Chat ID Telegram:** nhắn cho bot một tin bất kỳ rồi mở
`https://api.telegram.org/bot<TOKEN>/getUpdates`, lấy `message.chat.id`.

**Postgres:**

```bash
psql "$DATABASE_URL" -f n8n/sql/schema.sql
```

**Notion:** database phải có đúng các property này (tên và kiểu):

| Property   | Kiểu      |
| ---------- | --------- |
| `Name`     | Title     |
| `Summary`  | Text      |
| `Priority` | Select    |
| `Category` | Select    |
| `Todo`     | Text      |
| `Link`     | URL       |
| `Received` | Date      |

Sau khi chọn database trong UI, n8n sẽ nạp lại danh sách property — chọn lại một
lượt cho chắc, vì id property trong file JSON là dạng `Tên|kiểu` chứ không phải
id thật của workspace bạn. Nhớ share database cho integration (`⋯ → Connections`),
nếu không Notion trả 404.

---

## Đầu ra

Mỗi email thành một item như sau, ba nhánh cuối dùng chung:

```json
{
  "messageId": "18f0a...",
  "threadId": "18f0a...",
  "from": "Sếp <boss@corp.vn>",
  "subject": "Deadline báo cáo Q3",
  "receivedAt": "2026-08-01T02:11:00.000Z",
  "link": "https://mail.google.com/mail/u/0/#inbox/18f0a...",
  "summary": "Sếp cần báo cáo Q3 trước 17h hôm nay.",
  "priority": "urgent",
  "category": "work",
  "todo": ["Gửi báo cáo Q3 trước 17h", "Xác nhận lại với sếp"],
  "notify": true
}
```

| Field      | Giá trị                                                                     |
| ---------- | --------------------------------------------------------------------------- |
| `priority` | `urgent` \| `high` \| `normal` \| `low`                                     |
| `category` | `work` \| `finance` \| `personal` \| `newsletter` \| `promotion` \| `spam` \| `other` |
| `todo`     | mảng string, rỗng nếu không có việc gì                                      |
| `notify`   | `true` khi priority là `urgent`/`high` — điều kiện của node `Ưu tiên cao?`   |

Request gửi Gemini có `responseSchema`, nên `priority`/`category` luôn nằm trong
enum. Code node vẫn kiểm tra lại một lần nữa trước khi ghi vào DB.

---

## Sửa cách phân loại

Prompt nằm trong Code node **`Chuẩn bị email`**, ở mảng `prompt` — sửa trực tiếp
trong n8n. Đây là chỗ duy nhất giữ prompt, không có bản copy nào khác trong repo.

Muốn thêm giá trị cho `priority`/`category` thì phải sửa **ba** chỗ cho khớp:

1. `responseSchema.properties.*.enum` trong node `Chuẩn bị email`
2. mảng `PRIORITIES` / `CATEGORIES` trong node `Chuẩn hoá kết quả`
3. ràng buộc `CHECK` trong [sql/schema.sql](sql/schema.sql)

Bỏ sót bước 3 thì Postgres chặn insert và execution đỏ.

---

## Hành vi khi lỗi

- **Gemini trả 429 hoặc 5xx** — node retry 3 lần, cách nhau 5 giây. Free tier có
  giới hạn request/phút; nếu inbox nhiều thư, giãn `pollTimes` của Gmail Trigger
  ra 5–15 phút thay vì mỗi phút.
- **Gemini trả text không parse được** — item vẫn đi tiếp với
  `summary = "(Gemini không trả về JSON hợp lệ…)"`, `priority = normal`. Mất phần
  phân tích của một email vẫn hơn để cả luồng dừng. Tìm chuỗi đó trong DB để lọc
  ra các email cần xem lại.
- **Chạy lại trên cùng một email** — `message_id` là khoá chính, `ON CONFLICT DO
  UPDATE` cập nhật bản ghi cũ. Riêng Telegram và Notion **không** khử trùng lặp:
  chạy lại sẽ gửi lại tin nhắn và tạo thêm trang mới.

---

## Giới hạn đã biết

- **Nội dung email bị cắt ở 6000 ký tự** (`MAX_CHARS` trong `Chuẩn bị email`).
  Thư dài thì phần cuối — chữ ký, trích dẫn — không được đọc.
- **Chỉ đọc phần text**, bỏ qua HTML thuần và file đính kèm. Email chỉ có HTML
  sẽ rơi về `snippet`, tức là Gemini chỉ thấy vài dòng đầu.
- **Nội dung email là dữ liệu không tin được.** Prompt có dặn Gemini coi email là
  dữ liệu chứ không phải chỉ dẫn, nhưng đó là biện pháp giảm rủi ro, không phải
  bảo đảm. Đừng nối thêm nhánh nào tự động *hành động* theo `todo` (gửi mail,
  chuyển tiền, gọi API ghi dữ liệu) — chỉ nên dừng ở mức báo cho người đọc.
- **Telegram gửi `parse_mode=HTML`**, text đã được escape trong Code node. Nếu
  bạn sửa `telegramText`, giữ nguyên phần `escapeHtml`, không thì một dấu `<`
  trong tiêu đề email đủ làm Telegram trả 400.
- **Gmail Trigger đọc mọi email khớp filter**, kể cả thư của chính bạn gửi đi nếu
  filter cho qua. Filter mặc định là `is:unread -category:promotions
  -category:social`; sửa trong node theo cú pháp tìm kiếm của Gmail.
- **Không tự đánh dấu đã đọc.** Email vẫn ở trạng thái `unread` sau khi xử lý —
  workflow chỉ đọc, không đụng vào hộp thư. Gmail Trigger chặn lặp bằng mốc thời
  gian lần poll trước nên bình thường không xử lý lại cùng một thư, nhưng đó là
  trạng thái nằm trong n8n: đổi filter hoặc bật/tắt lại workflow có thể làm nó
  quét lại một khoảng. Muốn chắc chắn thì thêm node Gmail → *Mark as read* / gắn
  label vào sau nhánh Postgres.
