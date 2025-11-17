import { REST, Routes } from "discord.js";
import { commands } from "../src/commands/index.js";

const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_APP_ID;
const guildId = process.env.SOCIAL_GUILD_ID;

if (!token || !appId || !guildId) {
  throw new Error(
    "DISCORD_TOKEN, DISCORD_APP_ID, and SOCIAL_GUILD_ID must be set to register commands.",
  );
}

const rest = new REST({ version: "10" }).setToken(token);

async function main() {
  console.log(`Registering commands to guild ${guildId}...`);
  await rest.put(Routes.applicationGuildCommands(appId, guildId), {
    body: commands.map((c) => c.data.toJSON()),
  });
  console.log(`Done. Registered ${commands.length} commands.`);
}

main().catch((err) => {
  console.error("Error registering commands:", err);
  process.exit(1);
});
