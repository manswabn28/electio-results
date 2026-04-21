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
const listeners = new Map<string, Set<(message: ChatMessage) => void>>();

type StoredChat = {
  messagesByProfile: Record<string, ChatMessage[]>;
};

export async function getChatMessages(profileId: string, limit = 120): Promise<ChatMessagesResponse> {
  const store = await readStore();
  const room = getRoomMessages(store, profileId);
  return {
    generatedAt: new Date().toISOString(),
    messages: room.slice(-Math.max(1, Math.min(limit, MAX_MESSAGES)))
  };
}

export async function addChatMessage(input: {
  profileId: string;
  viewerId: string;
  displayName?: string;
  isAdmin?: boolean;
  message: string;
}): Promise<ChatMessage> {
  const profileId = normalizeProfileId(input.profileId);
  const viewerId = input.viewerId.trim();
  const message = normalizeMessage(input.message);
  const displayName = normalizeDisplayName(input.displayName);

  if (!profileId) {
    throw Object.assign(new Error("Profile ID is required to post a chat message."), { statusCode: 400, code: "CHAT_PROFILE_REQUIRED" });
  }

  if (!viewerId) {
    throw Object.assign(new Error("Viewer ID is required to post a chat message."), { statusCode: 400, code: "CHAT_VIEWER_REQUIRED" });
  }

  if (!message) {
    throw Object.assign(new Error("Message cannot be empty."), { statusCode: 400, code: "CHAT_MESSAGE_EMPTY" });
  }

  const now = Date.now();
  const rateLimitKey = `${profileId}:${viewerId}`;
  const previous = lastPostAt.get(rateLimitKey) ?? 0;
  if (now - previous < POST_INTERVAL_MS) {
    throw Object.assign(new Error("Please wait a moment before sending another message."), { statusCode: 429, code: "CHAT_RATE_LIMIT" });
  }
  lastPostAt.set(rateLimitKey, now);

  const nextMessage: ChatMessage = {
    id: randomUUID(),
    profileId,
    viewerId,
    displayName,
    isAdmin: Boolean(input.isAdmin),
    message,
    createdAt: new Date(now).toISOString()
  };

  const store = await readStore();
  const room = getRoomMessages(store, profileId);
  store.messagesByProfile[profileId] = [...room, nextMessage].slice(-MAX_MESSAGES);
  await writeStore(store);
  emit(profileId, nextMessage);
  return nextMessage;
}

export async function deleteChatMessage(profileId: string, messageId: string): Promise<ChatMessage> {
  const normalizedProfileId = normalizeProfileId(profileId);
  const store = await readStore();
  const room = getRoomMessages(store, normalizedProfileId);
  const index = room.findIndex((message) => message.id === messageId);
  if (index === -1) {
    throw Object.assign(new Error("Chat message not found."), { statusCode: 404, code: "CHAT_NOT_FOUND" });
  }
  const deleted: ChatMessage = {
    ...room[index],
    deleted: true,
    message: "[deleted by admin]"
  };
  room[index] = deleted;
  store.messagesByProfile[normalizedProfileId] = room;
  await writeStore(store);
  emit(normalizedProfileId, deleted);
  return deleted;
}

export function subscribeToChat(profileId: string, listener: (message: ChatMessage) => void): () => void {
  const normalizedProfileId = normalizeProfileId(profileId);
  const roomListeners = listeners.get(normalizedProfileId) ?? new Set<(message: ChatMessage) => void>();
  roomListeners.add(listener);
  listeners.set(normalizedProfileId, roomListeners);
  return () => {
    const active = listeners.get(normalizedProfileId);
    if (!active) return;
    active.delete(listener);
    if (active.size === 0) listeners.delete(normalizedProfileId);
  };
}

async function readStore(): Promise<StoredChat> {
  try {
    const file = await readFile(chatPath, "utf8");
    const parsed = JSON.parse(file) as StoredChat;
    return {
      messagesByProfile: parsed?.messagesByProfile && typeof parsed.messagesByProfile === "object"
        ? Object.fromEntries(
            Object.entries(parsed.messagesByProfile).map(([profileId, messages]) => [
              profileId,
              Array.isArray(messages) ? messages.filter(Boolean) : []
            ])
          )
        : migrateLegacyMessages((parsed as { messages?: ChatMessage[] }).messages)
    };
  } catch {
    return { messagesByProfile: {} };
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

function normalizeProfileId(value?: string) {
  return value?.trim() || "default";
}

function getRoomMessages(store: StoredChat, profileId: string) {
  const normalizedProfileId = normalizeProfileId(profileId);
  return store.messagesByProfile[normalizedProfileId] ?? [];
}

function migrateLegacyMessages(messages?: ChatMessage[]) {
  const legacy = Array.isArray(messages) ? messages.filter(Boolean) : [];
  if (!legacy.length) return {} as Record<string, ChatMessage[]>;
  return { default: legacy.map((message) => ({ ...message, profileId: message.profileId || "default" })) };
}

function emit(profileId: string, message: ChatMessage) {
  const roomListeners = listeners.get(normalizeProfileId(profileId));
  if (!roomListeners) return;
  for (const listener of roomListeners) {
    listener(message);
  }
}
