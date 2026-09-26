// ChatAccess: conversations with the assistant, kept in the same encrypted database as the
// Vault. A chat is how the person talked; the Log is what changed.
import type { Db } from "./database.js";

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Tokens the conversation takes up in the model's context after its latest turn. */
  contextTokens: number;
}

export interface ChatRecord extends ChatSummary {
  messages: unknown[];
}

interface Row {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  context_tokens: number;
  messages?: string;
}

function summary(row: Row): ChatSummary {
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at, contextTokens: row.context_tokens };
}

export class ChatAccess {
  constructor(private readonly db: Db) {}

  list(): ChatSummary[] {
    const rows = this.db.prepare("SELECT id, title, created_at, updated_at, context_tokens FROM chats ORDER BY updated_at DESC").all() as Row[];
    return rows.map(summary);
  }

  read(id: string): ChatRecord | undefined {
    const row = this.db.prepare("SELECT * FROM chats WHERE id = ?").get(id) as Row | undefined;
    return row ? { ...summary(row), messages: JSON.parse(row.messages ?? "[]") } : undefined;
  }

  write(chat: ChatRecord): void {
    this.db
      .prepare("INSERT OR REPLACE INTO chats VALUES (?, ?, ?, ?, ?, ?)")
      .run(chat.id, chat.title, chat.createdAt, chat.updatedAt, chat.contextTokens, JSON.stringify(chat.messages));
  }

  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM chats WHERE id = ?").run(id).changes > 0;
  }
}
