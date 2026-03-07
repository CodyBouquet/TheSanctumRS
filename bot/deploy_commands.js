import "dotenv/config";
import fs from "fs";
import path from "path";
import { REST, Routes } from "discord.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

const commands = [];

// Use absolute path for safety
const commandsPath = path.join(process.cwd(), "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"));

for (const file of commandFiles) {
  const command = await import(`./commands/${file}`);
  if (!command.default?.data) continue;

  commands.push(command.default.data.toJSON());
}

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("Deploying global commands...");
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands }
    );
    console.log("Commands deployed.");
  } catch (error) {
    console.error("Error deploying commands:", error);
  }
})();