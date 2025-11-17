// src/commands/index.ts
import {
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  SlashCommandOptionsOnlyBuilder,
  ChatInputCommandInteraction,
} from "discord.js";

import * as ping from "./ping.js";
import * as social from "./social.js";
import * as funGate from "./fun_gate.js";

export interface Command {
  data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | SlashCommandOptionsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

// Single source of truth for all commands
const commands: Command[] = [ping, social, funGate];

export const commandMap = new Map<string, Command>(
  commands.map((cmd) => [cmd.data.name, cmd]),
);

// Default export for the registry script
export default commands;
