import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  Client,
  GatewayIntentBits,
  Collection,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder
} from "discord.js";

import { groups } from "./commands/lfg.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
  const command = await import(`./commands/${file}`);
  if (!command.default?.data) continue;
  commands.set(command.default.data.name, command.default);
}

client.once("ready", () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  try {

    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
    }

    if (interaction.isAutocomplete()) {
      const command = commands.get(interaction.commandName);
      if (!command?.autocomplete) return;
      await command.autocomplete(interaction);
    }

    if (interaction.isButton()) {
      const command = commands.get("lfg");
      if (!command?.button) return;
      await command.button(interaction);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("lfg_modal_")) {

      const user = interaction.user;
      const temp = groups.get(`temp_${user.id}`);

      if (!temp)
        return interaction.reply({
          content: "❌ LFG session expired. Please run /lfg again.",
          ephemeral: true
        });

      const { activity, slots } = temp;
      groups.delete(`temp_${user.id}`);

      const monthNum = parseInt(interaction.fields.getTextInputValue("lfg_month"));
      const day = parseInt(interaction.fields.getTextInputValue("lfg_day"));
      let timeRaw = interaction.fields.getTextInputValue("lfg_time");
      const notes = interaction.fields.getTextInputValue("lfg_notes") || "None";

      if (
        monthNum < 1 || monthNum > 12 ||
        day < 1 || day > 31 ||
        !/^\d{3,4}$/.test(timeRaw)
      ) {
        return interaction.reply({
          content: "❌ Invalid input. Check month, day, or time format (HHMM).",
          ephemeral: true
        });
      }

      if (timeRaw.length === 3) timeRaw = "0" + timeRaw;

      const hour = timeRaw.slice(0, 2);
      const minute = timeRaw.slice(2, 4);

      const now = new Date();
      let year = now.getUTCFullYear();

      const dateCandidate = new Date(
        Date.UTC(year, monthNum - 1, day, parseInt(hour), parseInt(minute))
      );

      if (dateCandidate < now) year += 1;

      const monthNames = [
        "January","February","March","April","May","June",
        "July","August","September","October","November","December"
      ];

      const monthName = monthNames[monthNum - 1];
      const dateTime = `${monthName} ${day} ${year} ${hour}:${minute} UTC`;

      const embed = new EmbedBuilder()
        .setTitle(`LFG: ${activity}`)
        .addFields(
          { name: `Players (1/${slots})`, value: `<@${user.id}>` },
          { name: "Scheduled for", value: dateTime },
          { name: "Notes", value: notes }
        );

      const join = new ButtonBuilder()
        .setCustomId("lfg_join")
        .setLabel("Join")
        .setStyle(ButtonStyle.Success);

      const leave = new ButtonBuilder()
        .setCustomId("lfg_leave")
        .setLabel("Leave")
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(join, leave);

      const msg = await interaction.reply({
        embeds: [embed],
        components: [row],
        fetchReply: true
      });

      groups.set(msg.id, {
        activity,
        slots,
        players: [user.id],
        dateTime,
        notes
      });

    }

  } catch (error) {

    console.error("❌ Interaction Error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Something went wrong running that command.",
        ephemeral: true
      });
    }

  }
});

client.login(process.env.DISCORD_TOKEN);