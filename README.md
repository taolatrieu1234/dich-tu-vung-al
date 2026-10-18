# ☁️ Tra Từ Đám Mây (Cloud Dictionary) - Manifest V3

> **Extension tra từ vựng & dịch câu thông minh dạng bong bóng đám mây (Cloud Bubbles) trên mọi trang web và Notion, tích hợp Google Gemini LLM.**

![Manifest V3](https://img.shields.io/badge/Manifest-V3-6366f1)
![Gemini API](https://img.shields.io/badge/AI-Google%20Gemini-06b6d4)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ Tính Năng Nổi Bật

### 1. 🎈 Giao diện Bong Bóng Đám Mây (Shadow DOM)
- **Hoàn toàn độc lập:** Sử dụng Shadow DOM cô lập 100%, không bị ảnh hưởng bởi CSS/Dark mode của trang web mẹ (kể cả Notion).
- **Thiết kế Glassmorphism hiện đại:** Kính mờ cao cấp, đổ bóng mềm và hiệu ứng bung nở lơ lửng ngay trên mặt chữ.
- **Tọa độ Viewport Fixed:** Neo cố định chính xác, chống tràn màn hình (Boundary Collision Avoidance), mượt mà trên các trang có thanh cuộn riêng như Notion.

### 2. 🧠 Nhận Diện Tự Động 2 Chế Độ
- **Chế độ Tra Từ (`Word Mode`):**
  - Hiển thị 4 bong bóng chi tiết: Phiên âm/Romaji, Từ loại, Giải nghĩa ngữ cảnh tiếng Việt, Câu ví dụ đời thường.
- **Chế độ Dịch Câu (`Sentence Mode`):**
  - Khi bôi đen cả câu dài, tự động chuyển sang chế độ tinh gọn chỉ gồm 2 bong bóng: **Romaji đọc cả câu** và **Bản dịch tiếng Việt mượt mà**. Tốc độ phản hồi cực nhanh (< 1s).

### 3. ⚡ Thao Tác Siêu Nhanh & Tối Ưu Cho Notion
- **Icon Đám Mây Nổi Nhanh (1-Click):** Vừa bôi đen xong là có icon ☁️ bay ra cạnh con trỏ chuột trong 3 giây để tra 1 chạm.
- **Phím tắt `Alt + Q`:** Tra tức thì, không bị thanh công cụ định dạng của Notion che khuất.
- **Menu chuột phải:** Chuột phải chọn *"Tra đám mây: [từ]"*.

### 4. 📌 Tiện Ích Học Tập
- **Nút Ghim (Pin 📌):** Ghim bong bóng đứng yên trên màn hình để vừa nhìn nghĩa vừa gõ ghi chú trong Notion mà không bị tự đóng.
- **Sao chép 1-Click (📋):** Nút sao chép riêng cho phần Romaji và phần Nghĩa tiếng Việt.
- **Phát âm bản ngữ (🔊):** Tích hợp Web Speech API đọc chuẩn giọng tiếng Anh và tiếng Nhật.

### 5. 🛡️ Chuỗi Dự Phòng Thông Minh (Auto-Failover)
- Hỗ trợ đa dạng model Gemini: `Gemini 3.8 Flash`, `Gemini 3.5 Flash-Lite`, `Gemini 3.1 Flash-Lite`, `Gemini 3 Flash Preview` hoặc model tự chọn.
- **Cơ chế Failover & Timeout (4.5s):** Nếu model chính bị quá tải hoặc phản hồi chậm, extension tự động chuyển sang các model Flash-Lite dự phòng, không bao giờ bị treo đợi.
- **Tầng Cache siêu tốc:** Tra lại từ cũ nạp ngay lập tức (< 10ms) từ bộ nhớ máy tính.

---

## 🛠️ Hướng Dẫn Cài Đặt (Developer Mode)

1. **Tải / Clone repository:**
   ```bash
   git clone https://github.com/<your-username>/<repo-name>.git
   ```
2. **Mở trình duyệt Chrome hoặc Edge:**
   - Truy cập vào địa chỉ: `chrome://extensions`
   - Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. **Tải extension lên:**
   - Bấm nút **Load unpacked** (Tải tiện ích đã giải nén).
   - Chọn thư mục dự án vừa tải về.

---

## ⚙️ Cấu Hình API Key

1. Lấy **API Key miễn phí** từ [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Chuột phải vào biểu tượng extension trên thanh công cụ trình duyệt ➡️ chọn **Options** (Tùy chọn).
3. Dán API Key, chọn model (khuyên dùng `Gemini 3.8 Flash` hoặc `Gemini 3.5 Flash-Lite`).
4. Bấm **Kiểm Tra Kết Nối** ➡️ Bấm **Lưu Cài Đặt**.

---

## 📁 Cấu Trúc Dự Án

```
├── manifest.json              # File đầu não Manifest V3
├── README.md                  # Tài liệu giới thiệu & hướng dẫn
├── LICENSE                    # Giấy phép MIT
├── .gitignore                 # Chặn file rác Git
│
├── icons/                     # Bộ icon các kích thước
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
│
├── options/                   # Module Trang Cài Đặt (Options UI)
│   ├── options.html
│   ├── options.css
│   └── options.js
│
└── src/                       # Module Mã Nguồn Cốt Lõi (Core Engine)
    ├── background.js          # Service Worker: Gọi Gemini, Cache, Fallback
    ├── content.js             # Content Script: Notion, Alt+Q, Pin, Quick Trigger
    └── bubbles.css            # Style Glassmorphism trong Shadow DOM
```

---

## 📄 License
Phát hành theo giấy phép [MIT License](LICENSE).
