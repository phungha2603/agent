# Công ty mô phỏng (Agent Company Simulator)

Mỗi "vị trí" trong công ty là một AI agent độc lập (Claude, OpenAI, hoặc
provider OpenAI-compatible khác — chỉ cần API key), chạy theo "ca" (lịch cố
định, định kỳ, hoặc phản ứng khi có việc mới), đọc/ghi dữ liệu qua một hàng
đợi dùng chung (SQLite). Đó là cách các vị trí "liên kết" với nhau giống một
công ty thật: Sales tạo lead → Marketing nhận lead đó để outreach → Lễ tân
ghi nhận, v.v. Một dashboard real-time (WebSocket) hiển thị trạng thái từng
vị trí khi nó đổi.

## Chạy thử (không cần API key)

**Yêu cầu Node.js 20 hoặc 22 (bản LTS).** `better-sqlite3` cần biên dịch
native code nếu không có sẵn bản build dựng sẵn cho đúng version Node đang
dùng — các bản LTS luôn có bản dựng sẵn nên cài tức thì; bản Node quá mới
(vd bản "Current" mới nhất, chưa phải LTS) thường chưa có, `npm install` sẽ
tự biên dịch và dễ lỗi nếu mã nguồn module chưa cập nhật theo kịp. Nếu gặp
lỗi dài dằng dặc nhắc đến `node-gyp`/`make`/`V8_DEPRECATED` lúc `npm
install`, 99% là do đang dùng Node quá mới — cài [nvm](https://github.com/nvm-sh/nvm)
rồi:

```bash
nvm install 22
nvm use 22
rm -rf node_modules package-lock.json
npm install
```

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

Server bắt cả `SIGINT` lẫn `SIGTERM`: khi dừng, nó ngừng nhận ca mới, đợi ca
đang chạy dở xong (tối đa 10s), rồi mới checkpoint SQLite và thoát — tránh
hỏng file `.db-wal` khi redeploy. `docker stop` mặc định chỉ đợi 10s trước
khi gửi SIGKILL; nếu vị trí nào đó dùng model thật có thể chạy lâu hơn, tăng
thời gian chờ:

```bash
docker stop --time 30 agent-company
# hoặc trong docker-compose.yml: stop_grace_period: 30s
```

Nếu đặt domain + reverse proxy trước app (khuyến nghị cho production), xem
`nginx.conf.example` — phần quan trọng nhất là header `Upgrade`/`Connection`
để Socket.IO không bị rớt kết nối qua proxy.

## Khi mở rộng cấu hình (nhiều vị trí/phòng ban hơn)

Server kiểm tra config ngay lúc khởi động (`config/loadConfig.ts`):
- **Cảnh báo** (không dừng server) nếu một `outboxTopic` không có vị trí nào
  đọc, hoặc một `inboxTopics` không có vị trí nào ghi — thường là dấu hiệu
  gõ nhầm tên topic lúc nối các vị trí mới với nhau.
- **Dừng server** (lỗi rõ ràng, không chạy ngầm rồi lỗi từng ca) nếu một vị
  trí dùng provider khác "mock" mà biến môi trường `apiKeyEnv` tương ứng
  chưa được set.

Nếu một ca lỗi (mạng, rate limit, provider gián đoạn...) sau khi đã nhận
việc từ hộp thư đến, các item đó được trả lại hàng đợi để thử lại ở lượt
sau thay vì mất — tối đa 3 lần, sau đó mới thực sự bỏ và ghi log lỗi rõ
ràng để biết vị trí nào đang gặp vấn đề.

Dashboard hiển thị trong một khung nhìn cố định (`#building-wrap`, cuộn
nội bộ không lộ ra ngoài trang) và tự co vừa toàn bộ cảnh (toà nhà + phố)
khi tải lần đầu hoặc khi đổi kích thước cửa sổ — không phóng to quá kích
thước gốc của canvas (tránh bị mờ). Dùng cuộn chuột để phóng to/thu nhỏ
(zoom quanh đúng vị trí con trỏ), giữ chuột trái và kéo để di chuyển khung
nhìn; nhấp đúp để quay lại trạng thái vừa khung ban đầu. Một khi người dùng
đã tự zoom/kéo, dashboard thôi tự động co lại nữa (tôn trọng góc nhìn họ
chọn) cho đến khi họ nhấp đúp để reset.

## Xem lại lịch sử (thanh tua thời gian)

Dưới khung toà nhà có nút "Xem lịch sử" — bấm vào để chuyển dashboard sang
chế độ xem lại quá khứ thay vì trực tiếp. Chế độ này cho:

- Thanh scrubber kéo tới bất kỳ thời điểm nào từ lúc công ty có dữ liệu đầu
  tiên đến hiện tại, nút play/pause tự tua theo tốc độ 1x/5x/20x, và một
  nút "Về trực tiếp" để quay lại chế độ thường bất cứ lúc nào.
- Ngày/đêm, đồng hồ kim trên tường, và chip trạng thái của từng vị trí đều
  phản ánh ĐÚNG thời điểm đang xem (không phải thời gian thực) — dựng lại
  từ các dòng log `level: "status"` mà `runShift()` ghi mỗi lần một vị trí
  đổi trạng thái (không chỉ lúc xong/lỗi như trước), lấy qua
  `GET /api/history?since=&until=`.
- Các chấm đỏ trên thanh scrubber đánh dấu lúc có lỗi xảy ra — bấm vào một
  chấm để nhảy thẳng tới thời điểm đó và camera tự pan tới đúng phòng.
- Nhân viên hiển thị đứng/ngồi cố định tại bàn theo trạng thái lịch sử,
  **không** replay lại việc đi lại/trò chuyện lúc rảnh — hành vi đó vốn chỉ
  chạy ở trình duyệt người xem, ngẫu nhiên và không đồng bộ giữa các người
  xem khác nhau (xem mục "Giới hạn hiện tại" bên dưới), nên không có "vị
  trí thật" nào trong quá khứ để tua lại chính xác.

Tính năng này được thiết kế qua 1 vòng thảo luận Claude↔Gemini riêng (3
lượt) trước khi triển khai — xem lịch sử trao đổi trong quá trình phát
triển nếu cần.

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
