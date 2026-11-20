# Công ty mô phỏng (Agent Company Simulator)

Mỗi "vị trí" trong công ty là một AI agent độc lập (Claude, OpenAI, hoặc
provider OpenAI-compatible khác — chỉ cần API key), chạy theo "ca" (lịch cố
định, định kỳ, hoặc phản ứng khi có việc mới), đọc/ghi dữ liệu qua một hàng
đợi dùng chung (SQLite). Đó là cách các vị trí "liên kết" với nhau giống một
công ty thật: Sales tạo lead → Marketing nhận lead đó để outreach → Lễ tân
ghi nhận, v.v. Một dashboard real-time (WebSocket) hiển thị trạng thái từng
vị trí khi nó đổi.

## Chạy thử (không cần API key)

Config mẫu `src/config/positions.example.yaml` dùng toàn bộ provider `mock`
— chạy được ngay, không tốn phí, để bạn thấy luồng điều phối hoạt động.

```bash
npm install
npm run dev
```

Mở `http://localhost:3000`. Mỗi vị trí sẽ tự chạy theo lịch khai báo trong
config (xem cột `schedule` — `daily` chạy vào giờ cố định, `interval` chạy
định kỳ mỗi N phút, `on_inbox` chạy ngay khi có dữ liệu mới gửi tới).

## Gắn model thật cho từng vị trí

Sửa `src/config/positions.example.yaml` (hoặc tạo file config riêng và trỏ
`COMPANY_CONFIG` tới đó). Với mỗi vị trí:

```yaml
- id: sales_contact
  provider: anthropic # hoặc "openai"
  model: claude-sonnet-5-5
  apiKeyEnv: ANTHROPIC_API_KEY # tên biến môi trường chứa API key
  # baseUrl: https://my-openai-compatible-endpoint/v1  # chỉ cần với openai
```

Copy `.env.example` thành `.env` và điền key tương ứng. Mỗi vị trí dùng
provider/model/key khác nhau hoàn toàn độc lập — vị trí này chạy Claude, vị
trí khác chạy GPT hay model local nào đó cũng được.

## Thêm / sửa vị trí và liên kết giữa chúng

- `inboxTopics`: danh sách "topic" mà vị trí này đọc dữ liệu vào.
- `outboxTopic`: topic mà vị trí này ghi dữ liệu ra cho vị trí khác đọc.
- `room`: chỉ để nhóm hiển thị trên dashboard, không ảnh hưởng logic.
- `role`: system prompt mô tả công việc của vị trí.

Hai vị trí "liên kết" với nhau đơn giản bằng cách vị trí A có
`outboxTopic: X` và vị trí B có `X` trong `inboxTopics` — không có lệnh gọi
trực tiếp giữa các agent, tất cả đi qua hàng đợi chung.

## Build & chạy production

```bash
npm run build
npm start
```

## Triển khai Docker / VPS

```bash
docker build -t agent-company .
docker run -d \
  --name agent-company \
  -p 3000:3000 \
  -v agent-company-data:/app/data \
  --env-file .env \
  agent-company
```

Mount `/app/data` ra volume để dữ liệu (SQLite) không mất khi container khởi
động lại. Đổi `COMPANY_CONFIG` qua biến môi trường nếu muốn dùng file config
khác mặc định.

## Giới hạn hiện tại (biết trước để mở rộng)

- Agent hiện chỉ gọi LLM một lượt rồi parse JSON ra kết quả — chưa có
  tool-calling thật (web search, gửi email...). Có thể thêm bằng cách mở
  rộng `agents/adapter.ts` để truyền `tools` vào SDK của từng provider.
- Dashboard vẽ cả công ty như một tầng duy nhất của một toà nhà (một
  `<canvas>` liền mạch): các phòng ghép chung một mặt bằng, có bầu
  trời/mây/nắng và dãy cửa sổ tầng trên phía trên, có phố/vỉa hè/cây/đèn
  đường/cửa ra vào phía dưới. Nhân vật đi bộ vào bàn khi bắt đầu ca, gõ
  phím khi đang chạy, bung dấu check khi xong, dấu X đỏ khi lỗi — toàn bộ
  chỉ dựa trên `status`/`lastRunAt` từ WebSocket, không cần ảnh/sprite
  ngoài (xem `public/app.js`). Nhiều phòng tự xuống hàng nếu công ty có
  thêm vị trí, vẫn trong cùng một tầng.
- Lịch "daily"/"interval" chạy theo giờ hệ thống của server (không có
  timezone riêng per-vị trí).
