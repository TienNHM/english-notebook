# Hướng dẫn sử dụng English Notebook

Dành cho người học. Cài đặt và vận hành xem [OPERATIONS.md](OPERATIONS.md); kiến trúc xem [ARCHITECTURE.md](ARCHITECTURE.md).

Mục lục: [1. Bắt đầu](#1-bắt-đầu) · [2. Thêm từ và câu](#2-thêm-từ-và-câu) · [3. Thư viện](#3-thư-viện) · [4. Ôn tập](#4-ôn-tập-leitner) · [5. Thưởng và streak](#5-thưởng-streak-và-mục-tiêu-ngày) · [6. Giao diện](#6-giao-diện) · [7. Cài lên điện thoại](#7-cài-lên-điện-thoại-pwa) · [8. Chia sẻ kho](#8-chia-sẻ-kho-từ-vựng) · [9. Dùng với AI agent](#9-dùng-với-ai-agent-claude-cursor) · [10. Hỏi đáp](#10-hỏi-đáp)

## 1. Bắt đầu

1. Mở `https://english-notebook.tiennhm.io.vn`.
2. Bấm **Đăng nhập Google** để đồng bộ giữa các thiết bị. Không đăng nhập vẫn dùng được, nhưng dữ liệu chỉ nằm trong trình duyệt này.
3. App có 4 tab: **Thêm**, **Thư viện**, **Ôn tập**, **Thưởng**.

## 2. Thêm từ và câu

- **Từ / cụm từ:** nhập nghĩa tiếng Việt, ví dụ và ghi chú (tùy chọn).
- **Câu:** nhập câu tiếng Anh, nghĩa, câu gốc (vd tiếng Việt bạn đã gõ) và các **cụm hay** trong câu. Mỗi cụm thành một thẻ riêng, liên kết với câu.
- **Tag** (vd `work`, `git`, `meeting`) giúp lọc trong Thư viện.
- Thẻ trùng nội dung (không phân biệt hoa thường) sẽ bị bỏ qua khi thêm bằng AI agent.

## 3. Thư viện

Tìm kiếm, lọc theo loại (từ, cụm, câu) và tag, sửa hoặc xóa thẻ. Cuối trang có các nút:

| Nút | Làm gì |
|---|---|
| 🔗 Chia sẻ kho | Tạo link để người khác nhập một bản sao kho của bạn. |
| 📥 Nhập từ link | Dán link hoặc mã nhận được để xem trước và nhập. |
| 🤖 Kết nối AI agent | Tạo token để AI agent tự lưu từ và câu vào sổ. |
| ⬇ Xuất JSON / ⬆ Nhập JSON | Sao lưu hoặc khôi phục toàn bộ sổ. |

## 4. Ôn tập (Leitner)

Thẻ nằm trong 6 hộp (box 0 đến 5). Sau mỗi lần ôn, chọn **Quên**, **Nhớ** hoặc **Dễ**:

- **Quên:** về box 0, hiện lại sau khoảng 10 phút.
- **Nhớ:** lên 1 box. **Dễ:** lên 2 box (tối đa box 5).
- Khoảng cách ôn theo box: 0, 1, 3, 7, 14, 30 ngày.

Tab Ôn tập chỉ hiện các thẻ **đến hạn** hôm nay, và dùng toàn bộ chiều cao màn hình.

## 5. Thưởng, streak và mục tiêu ngày

Tab **Thưởng** có:

- **Streak:** số ngày liên tiếp hoàn thành mục tiêu. Cứ mỗi 7 ngày streak bạn nhận 1 **băng giữ streak** (tối đa 2), tự dùng khi lỡ một ngày.
- **Mục tiêu ngày:** 5, 10, 15, 20 hoặc 30 thẻ; đạt mục tiêu được thưởng thêm XP.
- **XP:** Quên 1, Nhớ 3, Dễ 5.
- **Huy hiệu:** mở khóa theo streak (3 đến 100 ngày), số lần nhớ đúng (50, 200, 1000), số thẻ (10, 50, 100), 10 câu đã lưu, thẻ lên box 5…
- **Chia sẻ thành tích:** tạo ảnh thẻ thành tích để đăng lên mạng xã hội (ảnh tạo ngay trên máy bạn, không tải gì lên).

## 6. Giao diện

- 🎨 đổi **4 phong cách**: Neo (brutalism), Solid, Glass, Gradient.
- Nút chủ đề: **sáng / tối / theo hệ thống**.
- Hiệu ứng chuyển động có công tắc bật/tắt (mặc định theo cài đặt "giảm chuyển động" của hệ điều hành).

## 7. Cài lên điện thoại (PWA)

- **Android (Chrome):** bấm **📲 Cài app** hoặc menu ⋮ → *Cài đặt ứng dụng*. Trên Samsung nếu có cảnh báo bảo mật, hãy cài từ Chrome (cảnh báo đến từ Samsung Auto Blocker, không phải lỗi của app).
- **iPhone / iPad (Safari):** Chia sẻ → *Thêm vào Màn hình chính*.
- **Máy tính (Chrome/Edge):** biểu tượng cài ở thanh địa chỉ.

App chạy toàn màn hình, dùng được khi không có mạng và tự cập nhật khi có bản mới.

## 8. Chia sẻ kho từ vựng

**Người chia sẻ:** Thư viện → 🔗 Chia sẻ kho → chọn loại thẻ và tag → chọn có kèm *câu gốc* và *ghi chú* hay không → chọn thời hạn (7, 30 hoặc 90 ngày) → **Tạo link** → gửi link hoặc mã 22 ký tự. Bạn có thể **thu hồi** link bất cứ lúc nào.

**Người nhận:** mở link (hoặc Thư viện → 📥 Nhập từ link), đăng nhập, **xem trước**, rồi nhập. Thẻ được **sao chép** vào sổ của người nhận (box 0, tag `#shared`); sổ của người chia sẻ không đổi và tiến độ học không bị chia sẻ.

## 9. Dùng với AI agent (Claude, Cursor…)

AI agent sẽ: sửa tiếng Anh cho bạn, trả lời bằng tiếng Anh đơn giản kèm tiếng Việt, rồi **tự lưu** câu và cụm hay vào sổ sau mỗi yêu cầu tiếng Việt.

1. Trong app: **Thư viện → 🤖 Kết nối AI agent → Tạo token**. Sao chép token ngay (chỉ hiện một lần, không gửi cho ai).
2. Trong Claude Code (bản 2.1.275 trở lên):

   ```bash
   claude plugin marketplace add TienNHM/english-notebook-mcp
   claude plugin install english-notebook@tiennhm
   ```

3. Dán token khi được hỏi, rồi khởi động lại Claude Code.
4. Thử: gõ yêu cầu bằng tiếng Việt, hoặc *"lưu từ rollback (quay lại bản cũ)"*, rồi mở app xem thẻ mới.

Agent khác (Cursor, Codex, Copilot, Windsurf…): dùng prompt "Quick start" trong [README của MCP](https://github.com/TienNHM/english-notebook-mcp#quick-start-let-your-ai-agent-set-everything-up); agent sẽ tự cài giúp bạn.

Gõ **"skip coach"** trong một tin nhắn để tắt coach và việc lưu cho lượt đó. Mất hoặc lộ token: thu hồi trong cùng màn hình rồi tạo token mới (có thể mất vài giây đến một phút để có hiệu lực). Mỗi người tối đa 5 token và 200 thẻ mới mỗi ngày.

## 10. Hỏi đáp

**Dữ liệu của tôi nằm ở đâu?** Trong trình duyệt (khi chưa đăng nhập) và trong Firestore tài khoản của bạn (khi đã đăng nhập). Người khác không đọc được, trừ kho bạn tự chia sẻ.

**Token agent đọc được gì?** Lưu thẻ mới và liệt kê chữ, nghĩa các thẻ trong sổ của bạn. Không đọc được tiến độ, không đụng tới tài khoản khác.

**Mất mạng thì sao?** Vẫn thêm và ôn được; dữ liệu đồng bộ lại khi có mạng. Tạo token, chia sẻ kho và agent cần có mạng.

**Đổi điện thoại?** Đăng nhập cùng tài khoản Google; hoặc dùng Xuất JSON / Nhập JSON.

**Agent không lưu gì?** Kiểm tra: đã cài plugin và khởi động lại chưa; token còn hiệu lực chưa (agent sẽ báo "invalid or revoked"); đã quá 200 thẻ trong ngày chưa. Xem thêm bảng lỗi trong [OPERATIONS.md](OPERATIONS.md#9-troubleshooting).
