# IntelShield — app di động

Một app cho bảo vệ, đội trưởng, quản lý (giao diện theo quyền). React + Vite + Capacitor 8.

## Chạy thử trên trình duyệt
```bash
cp .env.example .env          # VITE_API_BASE=http://localhost:3001/api
npm install
npm run dev                   # http://localhost:5173 — backend cần CORS_ORIGIN có http://localhost:5173
```

## Build APK thử (Android)
```bash
# JDK đi kèm Android Studio (đổi theo nơi bạn cài)
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
# trỏ API vào máy chạy backend trong LAN, cho phép HTTP
set VITE_API_BASE=http://192.168.1.10:3001/api
set MOBILE_DEV=1
npm run android:apk           # → android/app/build/outputs/apk/debug/app-debug.apk
```
Backend cần `CORS_ORIGIN` có `https://localhost` (origin của app Android).

## Thông báo đẩy
Tải `google-services.json` của dự án Firebase (gói `io.github.oldcyborg.intelshield`) vào `android/app/` **và** build với `VITE_PUSH_ENABLED=1`.
Không commit tệp này. Thiếu tệp: app vẫn chạy, chỉ không nhận thông báo đẩy (hộp thông báo trong app vẫn có).

## Cài thử trên điện thoại (mạng nội bộ)
1. Máy chạy backend và điện thoại **cùng một Wi-Fi**. Lấy IPv4 của máy backend bằng `ipconfig` (VD `192.168.1.7`).
2. Backend dev đang chạy (`cd backend && npm run start:dev`), `backend/.env` có `CORS_ORIGIN=...,https://localhost,...`.
3. Windows Firewall: cho phép cổng 3001 (một lần, quyền quản trị):
   `netsh advfirewall firewall add rule name="Patrol API 3001" dir=in action=allow protocol=TCP localport=3001`
4. Build: `VITE_API_BASE=http://192.168.1.7:3001/api MOBILE_DEV=1 npm run build && MOBILE_DEV=1 npx cap sync android`,
   rồi `cd android && JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew.bat assembleDebug`.
5. Chép `android/app/build/outputs/apk/debug/app-debug.apk` sang điện thoại, cho phép "cài ứng dụng không rõ nguồn", cài.
6. Đăng nhập bằng tài khoản bảo vệ/đội trưởng. Máy đầu tiên của mỗi bảo vệ được tin ngay; máy thứ hai chờ HR duyệt ở trang **Thiết bị**.

APK thử chỉ dùng trong mạng nội bộ (HTTP). Bản phát hành trỏ vào HTTPS của VPS và được ký bằng khoá phát hành.

## Bản phát hành
`MOBILE_RELEASE=1 VITE_API_BASE=https://<tên miền>/api npm run build && npx cap sync android` (không đặt `MOBILE_DEV`) — build sẽ dừng nếu API không phải HTTPS. Sau đó ký APK/AAB bằng khoá phát hành (làm cùng bước đưa lên Google Play).
