import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatMessage, ChatMessagesResponse } from "@kerala-election/shared";
import { randomUUID } from "node:crypto";

const dataDir = path.resolve(process.cwd(), "data");
const chatPath = path.join(dataDir, "chat-messages.json");
const MAX_MESSAGES = 400;
const MAX_MESSAGE_LENGTH = 400;
const MAX_NAME_LENGTH = 40;
const POST_INTERVAL_MS = 3000;

const lastPostAt = new Map<string, number>();
const listeners = new Set<(message: ChatMessage) => void>();

type StoredChat = {
  messages: ChatMessage[];
};

export async function getChatMessages(limit = 120): Promise<ChatMessagesResponse> {
  const store = await readStore();
  return {
    generatedAt: new Date().toISOString(),
    messages: store.messages.slice(-Math.max(1, Math.min(limit, MAX_MESSAGES)))
  };
}

export async function addChatMessage(input: {
  viewerId: string;
  displayName?: string;
  message: string;
}): Promise<ChatMessage> {
  const viewerId = input.viewerId.trim();
  const message = normalizeMessage(input.message);
  const displayName = normalizeDisplayName(input.displayName);

  if (!viewerId) {
    throw Object.assign(new Error("Viewer ID is required to post a chat message."), { statusCode: 400, code: "CHAT_VIEWER_REQUIRED" });
  }

  if (!message) {
    throw Object.assign(new Error("Message cannot be empty."), { statusCode: 400, code: "CHAT_MESSAGE_EMPTY" });
  }

  const now = Date.now();
  const previous = lastPostAt.get(viewerId) ?? 0;
  if (now - previous < POST_INTERVAL_MS) {
    throw Object.assign(new Error("Please wait a moment before sending another message."), { statusCode: 429, code: "CHAT_RATE_LIMIT" });
  }
  lastPostAt.set(viewerId, now);

  const nextMessage: ChatMessage = {
    id: randomUUID(),
    viewerId,
    displayName,
    message,
    createdAt: new Date(now).toISOString()
  };

  const store = await readStore();
  store.messages = [...store.messages, nextMessage].slice(-MAX_MESSAGES);
  await writeStore(store);
  emit(nextMessage);
  return nextMessage;
}

export async function deleteChatMessage(messageId: string): Promise<ChatMessage> {
  const store = await readStore();
  const index = store.messages.findIndex((message) => message.id === messageId);
  if (index === -1) {
    throw Object.assign(new Error("Chat message not found."), { statusCode: 404, code: "CHAT_NOT_FOUND" });
  }
  const deleted: ChatMessage = {
    ...store.messages[index],
    deleted: true,
    message: "[deleted by admin]"
  };
  store.messages[index] = deleted;
  await writeStore(store);
  emit(deleted);
  return deleted;
}

export function subscribeToChat(listener: (message: ChatMessage) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function readStore(): Promise<StoredChat> {
  try {
    const file = await readFile(chatPath, "utf8");
    const parsed = JSON.parse(file) as StoredChat;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages.filter(Boolean) : []
    };
  } catch {
    return { messages: [] };
  }
}

async function writeStore(store: StoredChat): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(chatPath, JSON.stringify(store, null, 2), "utf8");
}

function normalizeDisplayName(value?: string) {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "Anonymous";
  return trimmed.slice(0, MAX_NAME_LENGTH);
}

function normalizeMessage(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_MESSAGE_LENGTH);
}

function emit(message: ChatMessage) {
  for (const listener of listeners) {
    listener(message);
  }
}
