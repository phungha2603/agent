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

Để tránh cấu hình lỡ tạo thành vòng khép kín (A đẩy việc cho B, B đẩy lại
cho A, lặp vô hạn — tốn tiền API thật rất nhanh), mỗi item trong hàng đợi có
`depth` tăng dần qua từng chặng; item ở `depth` vượt quá 8 sẽ bị bỏ và ghi
log lỗi thay vì chuyển tiếp tiếp. Giới hạn này cố định trong code
(`MAX_CHAIN_DEPTH` ở `agents/runner.ts`), không cấu hình qua YAML.

Giờ `"HH:MM"` trong lịch `daily` được hiểu theo `timezone` (IANA, optional)
khai báo ở cấp công ty — xem ví dụ `timezone: "Asia/Ho_Chi_Minh"` trong
`positions.example.yaml`. Bỏ trường này thì giữ hành vi cũ: hiểu theo giờ
local của tiến trình server (thường là UTC khi deploy PaaS).

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
- Dashboard vẽ cả công ty dưới dạng pixel-art isometric (một `<canvas>`
  liền mạch, chiếu phối cảnh 2:1): các phòng ghép chung một mặt bằng của
  một tầng toà nhà, có tường/bàn/màn hình nổi khối; bên trên có bầu
  trời/mây/nắng + dãy cửa sổ tầng trên, bên dưới có phố/vỉa hè/đèn
  đường/xe/cây + một gian hàng rong và một ghế đá có người ngồi trò
  chuyện (thuần trang trí, không gắn với dữ liệu agent). Nhân viên đi bộ
  vào bàn khi bắt đầu ca, gõ phím khi đang chạy, bung dấu check khi xong,
  dấu X đỏ khi lỗi; lúc **rảnh** (`waiting_shift`), nhân viên đứng dậy đi
  lại tự do trong phòng, và cứ sau vài giây hệ thống có thể ghép ngẫu
  nhiên 2 người rảnh cùng phòng đứng lại nói chuyện (bong bóng thoại) rồi
  tự giải tán — toàn bộ hành vi này chạy ở client (`public/app.js`), chỉ
  dựa trên `status`/`lastRunAt` từ WebSocket, không cần ảnh/sprite ngoài.
  Các phòng xếp thành lưới hàng×cột gần vuông (không phải một hàng dài),
  toàn bộ mặt bằng bao trong một viền chung (tường bắc/tây đầy đủ, viền
  thấp phía nam/đông) nên đọc như một không gian chung được bao kín, dù
  bên trong vẫn chia theo từng phòng ban.
- Cảnh vật đổi theo giờ thực của trình duyệt người xem (không phải giờ
  server): nắng ban ngày, ngả vàng lúc chiều, tối hẳn ban đêm có
  sao/trăng — bầu trời, cửa sổ toà nhà, đèn đường và đèn trần văn phòng
  đều chuyển cùng lúc theo một "độ tối" chung (`getTimeOfDay()` trong
  `public/app.js`), nên nội thất và cảnh ngoài trời luôn khớp nhau. Một
  đồng hồ kim treo trên tường bên trong không gian chung chạy đúng theo
  giờ thực đó, cùng nguồn giờ với lịch chạy ca của agent.
- Bên dưới toà nhà, ngoài gian hàng rong và ghế đá trò chuyện, còn có 2
  người đi bộ dạo qua lại trên vỉa hè (một người dắt theo một chú chó
  nhỏ), đèn giao thông đổi màu xanh/vàng/đỏ theo chu kỳ thật, và thùng
  rác — toàn bộ chỉ là hoạt ảnh trang trí theo thời gian, không gắn với
  dữ liệu agent.
- Lịch "interval" vẫn tính theo thời điểm chạy lần trước (`lastRunAt`), không
  phụ thuộc timezone — chỉ `daily` mới dùng `timezone` của config.
- SQLite đã bật `journal_mode = WAL` và `busy_timeout = 5000` (state/db.ts)
  để chịu được việc Socket.IO đọc liên tục trong lúc scheduler/runner ghi,
  nhưng vẫn chỉ phù hợp quy mô demo — không thiết kế cho nhiều instance
  server cùng ghi một file SQLite.
