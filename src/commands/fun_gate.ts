import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionsBitField,
  type GuildMember,
} from "discord.js";
import {
  addFunRole,
  removeFunRole,
  getFunRoles,
} from "../db/socialDb.js";

export const data = new SlashCommandBuilder()
  .setName("fun_gate")
  .setDescription("Configure which roles can use Yak Yak fun commands.")
  .addSubcommand((sub) =>
    sub
      .setName("add_role")
      .setDescription("Allow a role to use fun commands.")
      .addRoleOption((opt) =>
        opt
          .setName("role")
          .setDescription("Role to allow")
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove_role")
      .setDescription("Remove a role from fun operators.")
      .addRoleOption((opt) =>
        opt
          .setName("role")
          .setDescription("Role to remove")
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("list_roles")
      .setDescription("List roles allowed to use fun commands."),
  );

function isGuildAdminOrOwner(
  interaction: ChatInputCommandInteraction,
): boolean {
  const member = interaction.member as GuildMember | null;
  if (!member) return false;

  if (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild)
  ) {
    return true;
  }

  const ownerId = process.env.OWNER_ID;
  if (ownerId && interaction.user.id === ownerId) {
    return true;
  }

  return false;
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  if (!isGuildAdminOrOwner(interaction)) {
    await interaction.reply({
      content:
        "You lack sufficient Social Credit to reconfigure the gates.",
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guildId;
  const sub = interaction.options.getSubcommand(true);

  if (sub === "add_role") {
    const role = interaction.options.getRole("role", true);
    addFunRole(guildId, role.id);
    await interaction.reply({
      content: `✅ Added ${role} as a Fun Operator role.`,
      ephemeral: true,
    });
  } else if (sub === "remove_role") {
    const role = interaction.options.getRole("role", true);
    removeFunRole(guildId, role.id);
    await interaction.reply({
      content: `✅ Removed ${role} from Fun Operator roles.`,
      ephemeral: true,
    });
  } else if (sub === "list_roles") {
    const roles = getFunRoles(guildId);
    if (roles.length === 0) {
      await interaction.reply({
        content:
          "No Fun Operator roles configured. Only admins and the bot owner can use fun commands.",
        ephemeral: true,
      });
      return;
    }

    const mentions = roles.map((id) => `<@&${id}>`).join("\n");
    await interaction.reply({
      content: `Fun Operator roles:\n${mentions}`,
      ephemeral: true,
    });
  }
}
