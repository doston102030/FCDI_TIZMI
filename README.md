# 🏘️ MFY Monitoring

Fuqarolarni ro'yxatga olish tizimi — Shahrixon tuman MFYlari uchun.

## 📋 Loyiha haqida

Bu ilova hodimlar va boshliq uchun mo'ljallangan:

### 👷 Hodim imkoniyatlari:
- 76 ta MFYdan birini tanlash
- Fuqaroning yuz rasmini olish (Face ID)
- Pasportni skanerlash → JShShIR avtomatik o'qiladi (AI orqali)
- F.I.O va JShShIR kiritish
- GPS koordinatalarni avtomatik olish
- Ma'lumotni boshliqqa yuborish

### 👑 Boshliq imkoniyatlari:
- Barcha hodimlarni kuzatish
- Har bir hodim nechta rasm tashlagani
- Qaysi MFYda ishlayotgani
- MFY bo'yicha filterlash
- Har bir yozuvni batafsil ko'rish (yuz rasmi, pasport, koordinata, vaqt)

## 🚀 O'rnatish va ishga tushirish

### 1. Node.js o'rnating
https://nodejs.org dan Node.js ni yuklab o'rnating (v18 yoki undan yuqori)

### 2. Loyihani oching
```bash
cd mfy-monitoring
```

### 3. Kutubxonalarni o'rnating
```bash
npm install
```

### 4. Ishga tushiring
```bash
npm start
```

Brauzer avtomatik ochiladi: http://localhost:3000

## 🔐 Demo loginlar

| Login | Parol | Rol |
|-------|-------|-----|
| admin | admin123 | Boshliq |
| hodim1 | 1234 | Hodim |
| hodim2 | 1234 | Hodim |
| hodim3 | 1234 | Hodim |

## 📁 Loyiha strukturasi

```
mfy-monitoring/
├── public/
│   └── index.html          ← Asosiy HTML fayl
├── src/
│   ├── index.js             ← Kirish nuqtasi
│   └── App.jsx              ← Asosiy ilova kodi
├── package.json             ← Kutubxonalar ro'yxati
└── README.md                ← Shu fayl
```

## 📱 Mobil qurilmada sinash

Loyihani ishga tushirgandan keyin, terminalda ko'rsatilgan IP manzilni
(masalan: http://192.168.1.100:3000) telefon brauzerida oching.

## 🛠 Texnologiyalar

- React 18
- Claude AI (pasport skanerlash uchun)
- Web Camera API
- Geolocation API
