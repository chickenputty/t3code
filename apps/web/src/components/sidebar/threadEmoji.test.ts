import { describe, expect, it } from "vite-plus/test";

import { FALLBACK_THREAD_EMOJI, threadEmojiForTitle } from "./threadEmoji";

describe("threadEmojiForTitle", () => {
  it("picks the most specific subject a title mentions", () => {
    expect(threadEmojiForTitle("Create Fresh Halloween Pets")).toBe("🎃");
    expect(threadEmojiForTitle("Auto-Detect Pet Mesh Materials")).toBe("🐾");
    expect(threadEmojiForTitle("Calibrate Roblox Particle Viewer")).toBe("✨");
    expect(threadEmojiForTitle("Optimize UI Performance and Load Time")).toBe("⚡");
    expect(threadEmojiForTitle("Fix Roblox Studio Runtime Warnings")).toBe("🐛");
    expect(threadEmojiForTitle("Run Multiple Roblox Studio Containers")).toBe("🧱");
  });

  it("reads the game's and the vault's names as names, not as pets", () => {
    expect(threadEmojiForTitle("Rename Pet Simulator 99 marketing UI screenshots")).toBe("📸");
    expect(threadEmojiForTitle("Move Asset Library Into Pet Vault")).toBe("📚");
  });

  it("matches whole words, so short keywords do not fire inside longer ones", () => {
    // "ci" inside "Circle" and "ui" inside "Quiet" are not CI or UI.
    expect(threadEmojiForTitle("Circle back on the quiet list")).toBe(FALLBACK_THREAD_EMOJI);
    expect(threadEmojiForTitle("Manage CI Worker Fleet")).toBe("🚦");
  });

  it("falls back when nothing in the title says what the thread is about", () => {
    expect(threadEmojiForTitle("<pasted_content>")).toBe(FALLBACK_THREAD_EMOJI);
    expect(threadEmojiForTitle("")).toBe(FALLBACK_THREAD_EMOJI);
  });
});
