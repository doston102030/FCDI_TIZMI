export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { imageData } = req.body;
  if (!imageData) return res.status(400).json({ error: "imageData required" });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: imageData },
              },
              {
                type: "text",
                text: "Bu O'zbekiston pasporti yoki ID karta rasmi. Faqat JSHSHIR (PINFL) raqamini top — bu 14 xonali raqam. Agar topilsa FAQAT 14 ta raqamni yoz. Agar topilmasa faqat TOPILMADI deb yoz.",
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    const text = data.content?.map((c) => c.text || "").join("") || "";
    const match = text.match(/\d{14}/);
    res.json({ jshshir: match ? match[0] : null });
  } catch (e) {
    res.status(500).json({ error: "Skaner xatosi" });
  }
}
