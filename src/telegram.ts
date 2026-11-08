// Sends a message to the reader on Telegram, through the bot whose token is TELEGRAM_BOT_TOKEN, to the
// chat TELEGRAM_CHAT_ID (the reader's own chat with the bot). Bot API: core.telegram.org/bots/api.

export const telegramOn = () => !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID;

// Telegram's HTML takes only &, < and > escaped.
export const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Button = { text: string; url: string };

// Node runs this file by stripping its types, so no constructor parameter properties.
class TelegramError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call(method: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, parse_mode: "HTML", ...body }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!json.ok) throw new TelegramError(`Telegram ${method}: ${res.status} ${json.description ?? ""}`.trim(), res.status);
}

// `html` under a photo when there is one (a caption holds 1,024 characters), else as a message. Only a
// photo Telegram refuses (400: it cannot fetch or read it) falls back to the message alone; a timeout or
// a 5xx may already have posted it, so it is thrown, not sent twice. Buttons go in one row under it.
export async function sendTelegram({ html, photo, buttons = [] }: { html: string; photo?: string | null; buttons?: Button[] }): Promise<void> {
  const reply_markup = buttons.length ? { inline_keyboard: [buttons] } : undefined;
  if (photo && html.length <= 1024) {
    try {
      return await call("sendPhoto", { photo, caption: html, reply_markup });
    } catch (err) {
      if (!(err instanceof TelegramError && err.status === 400)) throw err;
    }
  }
  await call("sendMessage", { text: html, reply_markup, link_preview_options: { is_disabled: true } });
}
