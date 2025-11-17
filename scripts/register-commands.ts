// scripts/register-commands.ts
import "dotenv/config";
import { REST, Routes } from "discord.js";
import commands from "../src/commands/index.js";

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.SOCIAL_GUILD_ID;
const appId =
  process.env.DISCORD_APP_ID ?? process.env.DISCORD_CLIENT_ID ?? null;

if (!token) {
  throw new Error("DISCORD_TOKEN is not set");
}
if (!guildId) {
  throw new Error("SOCIAL_GUILD_ID is not set");
}
if (!appId) {
  throw new Error(
    "DISCORD_APP_ID (or DISCORD_CLIENT_ID) is not set in the environment",
  );
}

const rest = new REST({ version: "10" }).setToken(token);

async function main() {
  const body = commands.map((c) => c.data.toJSON());

  console.log(
    `Registering ${body.length} guild commands for guild ${guildId} (app ${appId})`,
  );

  // 1) Replace ALL guild commands with our current list (ping, social, fun_gate)
  await rest.put(Routes.applicationGuildCommands(appId, guildId), {
    body,
  });
  console.log("✓ Guild commands updated");

  // 2) Wipe any GLOBAL commands so ghosts like /credit, /gifs disappear
  await rest.put(Routes.applicationCommands(appId), { body: [] });
  console.log("✓ Global commands cleared");
}

main().catch((err) => {
  console.error("Error registering commands:", err);
  process.exit(1);
});
