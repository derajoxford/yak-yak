// scripts/register-commands.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { REST, Routes } from "discord.js";
import { commandMap } from "../src/commands/index.js";

// You already have DISCORD_TOKEN / SOCIAL_GUILD_ID in .env.local
const token = process.env.DISCORD_TOKEN;
const guildId = process.env.SOCIAL_GUILD_ID;

// App (client) ID – you gave this earlier: 1426595434754998464
// If you ever want to move it to env, set DISCORD_CLIENT_ID instead.
const appId = process.env.DISCORD_CLIENT_ID ?? "1426595434754998464";

if (!token) {
  throw new Error("DISCORD_TOKEN is not set");
}
if (!guildId) {
  throw new Error("SOCIAL_GUILD_ID is not set");
}
if (!appId) {
  throw new Error("DISCORD client ID is not set");
}

const rest = new REST({ version: "10" }).setToken(token);

// Build the command JSON payload from your commandMap
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
