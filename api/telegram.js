
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const storageUrl = process.env.RECEIPT_STORAGE_URL;
  const storageSecret = process.env.RECEIPT_API_SECRET;

  const allowedUsers = (process.env.TELEGRAM_ALLOWED_USER_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);

  if (!token || !secret || !allowedUsers.length) {
    console.error("Missing Telegram configuration");
    return res.status(503).json({ error: "Not configured" });
  }

  if (req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const update = req.body;
  const message = update?.message;

  if (!message || message.chat?.type !== "private") {
    return res.status(200).json({ ok: true });
  }

  const userId = String(message.from?.id || "");

  if (!allowedUsers.includes(userId)) {
    console.warn("Unauthorized Telegram user");
    return res.status(200).json({ ok: true });
  }

  const chatId = message.chat.id;
  const name = message.from?.first_name || "Household member";

  const sendMessage = async text => {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(10000)
      }
    );

    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error("Telegram sendMessage failed");
    }
  };

  try {
    if (message.text?.startsWith("/start")) {
      await sendMessage(
        `🏠 Welcome, ${name}!\n\nSend a receipt photo or PDF to record a household expense.`
      );
      return res.status(200).json({ ok: true });
    }

    let fileId = null;

    if (message.photo?.length) {
      fileId = message.photo[message.photo.length - 1].file_id;
    } else if (
      message.document &&
      (
        message.document.mime_type === "application/pdf" ||
        message.document.mime_type?.startsWith("image/")
      )
    ) {
      fileId = message.document.file_id;
    }

    if (!fileId) {
      await sendMessage("📸 Please send a receipt photo or PDF.");
      return res.status(200).json({ ok: true });
    }

    if (!storageUrl || !storageSecret) {
      console.error("Missing receipt storage configuration");
      return res.status(503).json({ error: "Storage not configured" });
    }

    const storageResponse = await fetch(storageUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        secret: storageSecret,
        updateId: update.update_id,
        fileId,
        userId
      }),
      redirect: "follow",
      signal: AbortSignal.timeout(45000)
    });

    if (!storageResponse.ok) {
      throw new Error(`Storage HTTP ${storageResponse.status}`);
    }

    const saved = await storageResponse.json();

    if (!saved.ok) {
      throw new Error("Receipt storage failed");
    }

    if (!saved.duplicate) {
      await sendMessage(
        `✅ Receipt saved to Google Drive!\n\nReceipt ID: ${saved.receiptId}\nUploaded by: ${name}`
      );
    }

    console.log("Receipt stored", {
      receiptId: saved.receiptId,
      duplicate: saved.duplicate
    });

    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error("Telegram receipt processing failed:", error.message);
    return res.status(500).json({ ok: false });
  }
}
