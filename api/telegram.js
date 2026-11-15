// Telegram webhook for private receipt submissions by approved household members.
// Connectivity test only: does not yet save receipts or deduplicate retries.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const allowedUsers = (process.env.TELEGRAM_ALLOWED_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

if (!token || !secret || allowedUsers.length === 0) {
  console.error("Missing Telegram configuration", {
    tokenPresent: Boolean(token),
    secretPresent: Boolean(secret),
    allowedUsersConfigured: allowedUsers.length > 0
  });

  if (req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const message = req.body?.message;
  if (!message || message.chat?.type !== "private") {
    return res.status(200).json({ ok: true });
  }

  const userId = String(message.from?.id || "");
  if (!allowedUsers.includes(userId)) {
    return res.status(200).json({ ok: true });
  }

  const chatId = message.chat.id;
  const memberName = message.from?.first_name || message.from?.username || "Household member";
  let reply;

  if (message.photo?.length) {
    reply = `🧾 Receipt photo detected.\nUploaded by: ${memberName}`;
  } else if (message.document && (
    message.document.mime_type === "application/pdf" ||
    message.document.mime_type?.startsWith("image/")
  )) {
    reply = `📄 Receipt file detected.\nUploaded by: ${memberName}`;
  } else if (message.text === "/start") {
    reply = `🏠 Welcome, ${memberName}!\n\nSend a receipt photo or PDF to record a household expense.`;
  } else {
    reply = "📸 Please send a receipt photo or PDF.";
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: reply }),
      signal: AbortSignal.timeout(8000)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(`Telegram send failed: ${JSON.stringify(result)}`);
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Telegram processing error:", error);
    return res.status(500).json({ ok: false });
  }
}
