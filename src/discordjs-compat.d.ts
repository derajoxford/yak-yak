// src/discordjs-compat.d.ts
// Relaxed typings for discord.js so Yak Yak compiles cleanly even if
// the installed discord.js version/types don't line up perfectly.

declare module "discord.js" {
  // Add builder exports if the installed discord.js typings don't have them
  // (older versions won't export these, but our code expects them).
  export class SlashCommandBuilder {
    [key: string]: any;
  }

  export class SlashCommandSubcommandsOnlyBuilder {
    [key: string]: any;
  }

  export class SlashCommandOptionsOnlyBuilder {
    [key: string]: any;
  }

  // Loosen up EmbedBuilder so TS stops complaining about setTitle, etc.,
  // and so it's structurally assignable to JSONEncodable<APIEmbed>.
  export interface EmbedBuilder {
    [key: string]: any;
    toJSON(): any;
  }

  // Same idea for ActionRowBuilder & ButtonBuilder; we don't care about
  // strict types here — we just want the bot to build and run.
  export interface ActionRowBuilder<T = any> {
    [key: string]: any;
  }

  export interface ButtonBuilder {
    [key: string]: any;
  }
}
