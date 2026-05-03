const TOKEN   = "7660071945:AAGLRapX6CooIar_uczm_fdyfRHr9Z3F60o";
const CHAT_ID = "1980003040";
const BASE    = `https://api.telegram.org/bot${TOKEN}`;

// Base64 rasmni Telegram ga multipart/form-data orqali yuborish
async function sendPhoto(base64DataUrl, caption) {
  const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");
  const blob   = new Blob([buffer], { type: "image/jpeg" });

  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("photo",   blob, "photo.jpg");
  form.append("caption", caption);

  await fetch(`${BASE}/sendPhoto`, { method: "POST", body: form });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { record, facePhoto, passportPhoto } = req.body;

  const text = [
    `🏘 *MFY:* ${record.mfy?.name || "-"}`,
    `👤 *Ism:* ${record.fullName}`,
    `🔢 *JSHSHIR:* \`${record.jshshir}\``,
    `👮 *Hodim:* ${record.hodimName}`,
    `📅 *Sana:* ${new Date(record.timestamp).toLocaleString("uz-UZ")}`,
    `📍 *Joylashuv:* ${record.coords?.lat}, ${record.coords?.lng}`,
  ].join("\n");

  try {
    // 1) Matn
    await fetch(`${BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "Markdown" }),
    });

    // 2) Yuz rasmi
    if (facePhoto) await sendPhoto(facePhoto, "🤳 Yuz rasmi");

    // 3) Pasport rasmi
    if (passportPhoto) await sendPhoto(passportPhoto, `📄 Hujjat | 👤 ${record.fullName} | 🔢 ${record.jshshir}`);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
