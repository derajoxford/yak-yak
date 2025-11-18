// scripts/register-commands.ts
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local from project root (one level up from /scripts)
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

import { REST, Routes } from "discord.js";
import { commandMap } from "../src/commands/index.js";

// Env vars (from .env.local)
const token = process.env.DISCORD_TOKEN;
const guildId = process.env.SOCIAL_GUILD_ID;

// Use your DISCORD_APP_ID if set, else DISCORD_CLIENT_ID, else hard-coded ID
const appId =
  process.env.DISCORD_APP_ID ??
  process.env.DISCORD_CLIENT_ID ??
  "1426595434754998464";

if (!token) {
  throw new Error("DISCORD_TOKEN is not set");
}
if (!guildId) {
  throw new Error("SOCIAL_GUILD_ID is not set");
}
if (!appId) {
  throw new Error("Discord application ID is not set");
}

const rest = new REST({ version: "10" }).setToken(token);

// Build command JSON from your commandMap
const commands = Array.from(commandMap.values()).map((cmd) =>
  cmd.data.toJSON(),
);

(async () => {
  try {
    console.log(
      `Registering ${commands.length} commands for guild ${guildId}…`,
    );
    await rest.put(
      Routes.applicationGuildCommands(appId, guildId),
      { body: commands },
    );
    console.log("✅ Slash commands registered.");
  } catch (err) {
    console.error("Error registering commands:", err);
    process.exit(1);
  }
})();
