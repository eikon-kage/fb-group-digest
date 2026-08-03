-- Bảng đích cho node "Lưu vào Postgres".
-- Chạy một lần trước khi bật workflow:
--   psql "$DATABASE_URL" -f n8n/sql/schema.sql

CREATE TABLE IF NOT EXISTS email_triage (
    message_id  text PRIMARY KEY,
    thread_id   text        NOT NULL,
    sender      text        NOT NULL,
    subject     text        NOT NULL,
    received_at timestamptz NOT NULL,
    link        text        NOT NULL,
    summary     text        NOT NULL,
    priority    text        NOT NULL CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
    category    text        NOT NULL CHECK (category IN
                    ('work', 'finance', 'personal', 'newsletter', 'promotion', 'spam', 'other')),
    todo        jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- message_id là khoá chính nên chạy lại workflow trên cùng một email chỉ cập nhật
-- bản ghi cũ (ON CONFLICT DO UPDATE), không tạo bản trùng.

CREATE INDEX IF NOT EXISTS email_triage_priority_idx
    ON email_triage (priority, received_at DESC);

CREATE INDEX IF NOT EXISTS email_triage_received_idx
    ON email_triage (received_at DESC);


-- Vài truy vấn hay dùng:

-- Việc cần làm hôm nay, gấp trước:
--   SELECT received_at, sender, subject, summary, todo
--   FROM email_triage
--   WHERE priority IN ('urgent', 'high')
--     AND received_at >= now() - interval '1 day'
--   ORDER BY array_position(ARRAY['urgent','high'], priority), received_at DESC;

-- Gom tất cả todo của tuần thành từng dòng:
--   SELECT received_at, subject, jsonb_array_elements_text(todo) AS task
--   FROM email_triage
--   WHERE received_at >= now() - interval '7 days'
--   ORDER BY received_at DESC;
