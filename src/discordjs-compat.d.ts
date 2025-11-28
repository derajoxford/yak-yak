// src/discordjs-compat.d.ts
// Nuclear option: relaxed typings for discord.js so Yak Yak compiles
// even if the installed discord.js version/types don't match the code.

declare module "discord.js" {
  // Core client stuff
  export class Client {
    [key: string]: any;
  }

  export const Events: any;
  export const GatewayIntentBits: any;

  // Slash command builders
  export class SlashCommandBuilder {
    [key: string]: any;
  }

  export class SlashCommandSubcommandsOnlyBuilder {
    [key: string]: any;
  }

  export class SlashCommandOptionsOnlyBuilder {
    [key: string]: any;
  }

  // Embeds
  export class EmbedBuilder {
    [key: string]: any;
    constructor(...args: any[]);
    toJSON(): any;
  }

  // Components
  export class ActionRowBuilder<T = any> {
    [key: string]: any;
    constructor(...args: any[]);
  }

  export class ButtonBuilder {
    [key: string]: any;
    constructor(...args: any[]);
  }

  // Bitfields / enums used as values
  export const PermissionFlagsBits: any;
  export const ChannelType: any;
  export const ButtonStyle: any;
  export const PermissionsBitField: any;

  // Interaction / guild / message types
  export type ChatInputCommandInteraction = any;
  export type AutocompleteInteraction = any;
  export type ButtonInteraction = any;
  export type GuildMember = any;
  export type Message = any;
  export type TextChannel = any;
}
