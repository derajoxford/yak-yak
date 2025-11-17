import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import * as ping from "./ping.js";

export type SlashCommandType =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder;

export interface Command {
  data: SlashCommandType;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const commandList: Command[] = [
  {
    data: ping.data,
    execute: ping.execute,
  },
];

export const commands = commandList;

export const commandMap = new Map<string, Command>(
  commandList.map((cmd) => [cmd.data.name, cmd]),
);
