/**
 * Fork (chickenputty/t3code): a topic emoji for a thread, read from its title.
 *
 * Rows inside a project group show it in place of the project icon, which the
 * group's header already shows. Rules run in order and the first match wins,
 * so specific subjects sit above broad activities, and platforms come last.
 */
const THREAD_EMOJI_RULES: ReadonlyArray<readonly [pattern: RegExp, emoji: string]> = [
  // Seasons and events.
  [/\b(halloween|pumpkin|spook|haunt|ghost)/, "🎃"],
  [/\b(christmas|xmas|santa|winter|snow)/, "🎄"],
  [/\bvalentine/, "💘"],
  [/\beaster\b/, "🐣"],
  [/\b(pi[ñn]ata|fiesta)/, "🪅"],
  // Game subjects.
  [/\b(lucky|luck)\b/, "🍀"],
  [/\b(space|galaxy|rocket|planet)/, "🚀"],
  [/\b(mine|mining|pickaxe|ores?)\b/, "⛏️"],
  [/\b(explosive|tnt|bombs?)\b/, "💣"],
  [/\barcade/, "🕹️"],
  [/\b(coins?|currency|gems?|diamonds?)\b/, "🪙"],
  [/\bsky(box)?/, "🌅"],
  [/\bhoverboard/, "🛹"],
  [/\bbooths?\b/, "🏪"],
  [/\beggs?\b/, "🥚"],
  [/\bpets?\b/, "🐾"],
  [/\b(stalks?|vines?|plants?|garden|grow|seeds?)\b/, "🌱"],
  // Performance, then media and design.
  [/\b(perf|optimi[sz]|speed|slow|lag|load time|microprofiler|profil)/, "⚡"],
  [/\b(particles?|fx|vfx|effects?|sparkle)\b/, "✨"],
  [/\b(sounds?|audio|sfx|music)\b/, "🔊"],
  [/\b(video|trailer|teaser|animation|gif|mp4)/, "🎬"],
  [/\breplay/, "🎞️"],
  [/\b(screenshots?|captures?|photo)/, "📸"],
  [/\b(thumbnails?|thumbs?|clickbait)\b/, "🖼️"],
  // Not "model": in these titles it is as often an AI model as a 3D one.
  [/\b(mesh|meshes|3d|blender)\b/, "🧊"],
  [/\b(art|textures?|retextur|hue|palette|images?|backgrounds?|sprites?|icons?)\b/, "🎨"],
  [/\b(ui|gui|overlay|hud|button|layout)\b/, "🪟"],
  // Activities.
  [/\b(tests?|testing|qa|suite|playtest)\b/, "🧪"],
  [/\b(fix|bugs?|debug|errors?|broken|crash|warnings?|regression|issues?)\b/, "🐛"],
  [/\b(ban|mod|moderation|appeals?|tickets?|staff|audit|security)\b/, "🛡️"],
  [/\b(pr|prs|merge|branch(es)?|git|push|commit|pull request)\b/, "🔀"],
  [/\b(deploy|release|ship|publish|railway|heroku|vercel)/, "🚢"],
  [/\b(docs?|document|readme|claude\.md|instructions|handbook|summary|knowledge|notes)\b/, "📝"],
  [/\b(data|database|mongo|query|sql|analytics|metrics|datastore|leaderboard|graph)\b/, "📊"],
  [/\b(sync|upstream)\b/, "🔄"],
  [/\bhandoffs?\b/, "🤝"],
  [/\b(ci|runners?|fleet|workflows?|pipeline|jobs?)\b/, "🚦"],
  [/\b(automate|automated|automation|auto)\b/, "⚙️"],
  [/\b(agents?|claude|codex|gpt|bot|coordinat)/, "🤖"],
  // Platforms and places.
  [/\b(android|iphone|ios|mobile|phones?|tablet)\b/, "📱"],
  [/\b(mac|macbook|tailscale)\b/, "💻"],
  [/\b(world|zones?|map|places?)\b/, "🗺️"],
  [/\b(roblox|studio)\b/, "🧱"],
  [/\b(notion|board|cards?)\b/, "🗂️"],
  [/\b(discord|twitter|youtube|social|partners?|creators?|streamers?|webhook)\b/, "📡"],
  [/\b(library|index|indexes|catalog|archive|assets?)\b/, "📚"],
  [/\b(events?|games?|gameplay|progression|rewards?|mechanics?|loop)\b/, "🎮"],
  [/\b(brainstorm|ideas?|design|plan|research|pitch|spec|concepts?)\b/, "💡"],
  [/\b(set ?up|install|config|configure|environment|settings)\b/, "🔧"],
];

export const FALLBACK_THREAD_EMOJI = "💬";

// Names that contain topic words but are not the topic: the game itself and the vault.
const NAME_PATTERN = /\bpet sim(ulator)?( 99)?\b|\bps99\b|\bpet vault\b/g;

export function threadEmojiForTitle(title: string): string {
  const text = title.toLowerCase().replace(NAME_PATTERN, " ");
  for (const [pattern, emoji] of THREAD_EMOJI_RULES) {
    if (pattern.test(text)) return emoji;
  }
  return FALLBACK_THREAD_EMOJI;
}
