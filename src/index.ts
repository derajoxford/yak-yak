import { Client, Events, GatewayIntentBits } from "discord.js";
import { commandMap } from "./commands/index.js";

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.SOCIAL_GUILD_ID;

if (!token) {
  throw new Error("DISCORD_TOKEN is not set");
}

if (!guildId) {
  console.warn("[warn] SOCIAL_GUILD_ID is not set; bot will run but won’t enforce guild-only scope.");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    // We will later add message intents for auto social credit triggers.
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Social Credit bot ready as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (guildId && interaction.guildId && interaction.guildId !== guildId) {
    // Ignore commands from other guilds
    return;
  }

  const command = commandMap.get(interaction.commandName);
  if (!command) {
    console.warn(`Unknown command: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error("Error handling command:", interaction.commandName, err);
    const replyPayload = {
      content: "Something went wrong running that command.",
      ephemeral: true as const,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(replyPayload).catch(() => {});
    } else {
      await interaction.reply(replyPayload).catch(() => {});
    }
  }
});

client.login(token);
