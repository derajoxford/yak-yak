// src/scripts/register_commands.ts
import { REST, Routes } from "discord.js";
import commands from "../commands/index.js";

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.SOCIAL_GUILD_ID;

if (!token) {
  throw new Error("DISCORD_TOKEN is not set");
}

if (!guildId) {
  throw new Error("SOCIAL_GUILD_ID is not set");
}

async function main() {
  const rest = new REST({ version: "10" }).setToken(token);

  // Fetch application (bot) info so we get the client ID dynamically
  const appData = (await rest.get(
    Routes.oauth2CurrentApplication(),
  )) as any;
  const clientId = appData.id;

  const body = commands.map((cmd) => cmd.data.toJSON());

  console.log(
    `[slash] Registering ${body.length} guild commands for guild ${guildId} (app ${clientId})`,
  );

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body,
  });

  console.log("[slash] Done registering guild commands.");
}

main().catch((err) => {
  console.error("[slash] Failed to register commands:", err);
  process.exit(1);
});
