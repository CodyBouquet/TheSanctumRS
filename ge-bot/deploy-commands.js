// ge-bot/deploy-commands.js
import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token) throw new Error("Missing DISCORD_TOKEN in .env");
if (!clientId) throw new Error("Missing DISCORD_CLIENT_ID in .env");

const commands = [
  new SlashCommandBuilder()
    .setName("price")
    .setDescription("Get RS3 GE price + quick stats")
    .addStringOption((opt) =>
      opt
        .setName("query")
        .setDescription("Type to search (autocomplete)")
        .setRequired(true)
        .setAutocomplete(true)
    )
    // optional: allow command in DMs too
    .setDMPermission(true)
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(token);

try {
  console.log("Deploying GLOBAL commands…");

  // GLOBAL registration (no guild ID)
  await rest.put(Routes.applicationCommands(clientId), { body: commands });

  console.log("✅ Global commands deployed.");
  console.log("Note: Global commands can take a while to appear everywhere.");
} catch (err) {
  console.error("❌ Deploy failed:", err);
  process.exit(1);
}
