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
import * as credit from "./credit.js";
import * as tithes from "./tithes.js";
import * as afterdark from "./afterdark.js";
import * as music from "./music.js";

export interface Command {
  data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | SlashCommandOptionsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

// Single source of truth for all commands
const commands: Command[] = [
  ping,
  social,
  funGate,
  credit,
  tithes,
  afterdark,
  music,
];

export const commandMap = new Map<string, Command>(
  commands.map((cmd) => [cmd.data.name, cmd]),
);

export default commands;
