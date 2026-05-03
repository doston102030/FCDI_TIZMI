const TOKEN   = "7660071945:AAGLRapX6CooIar_uczm_fdyfRHr9Z3F60o";
const CHAT_ID = "1980003040";
const BASE    = `https://api.telegram.org/bot${TOKEN}`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { record, facePhoto, passportPhoto } = req.body;

  const text = `
🏘 *MFY:* ${record.mfy?.name || "-"}
👤 *Ism:* ${record.fullName}
🔢 *JSHSHIR:* \`${record.jshshir}\`
👮 *Hodim:* ${record.hodimName}
📅 *Sana:* ${new Date(record.timestamp).toLocaleString("uz-UZ")}
📍 *Joylashuv:* ${record.coords?.lat}, ${record.coords?.lng}
  `.trim();

  try {
    // Matn xabar
    await fetch(`${BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "Markdown" }),
    });

    // Yuz rasmi
    if (facePhoto) {
      await fetch(`${BASE}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, photo: facePhoto, caption: "🤳 Yuz rasmi" }),
      });
    }

    // Pasport rasmi
    if (passportPhoto) {
      await fetch(`${BASE}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, photo: passportPhoto, caption: "📄 Hujjat" }),
      });
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
