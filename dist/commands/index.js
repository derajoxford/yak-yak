import * as ping from "./ping.js";
const commandList = [
    {
        data: ping.data,
        execute: ping.execute,
    },
];
export const commands = commandList;
export const commandMap = new Map(commandList.map((cmd) => [cmd.data.name, cmd]));
