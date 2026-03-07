import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";

const groups = new Map();

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export default {
  data: new SlashCommandBuilder()
    .setName("lfg")
    .setDescription("Create a looking-for-group post")
    .addStringOption(option =>
      option
        .setName("activity")
        .setDescription("What activity?")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("slots")
        .setDescription("Total players")
        .setRequired(true)
    ),

  async execute(interaction) {
    const activity = interaction.options.getString("activity");
    const slots = interaction.options.getInteger("slots");

    const modal = new ModalBuilder()
      .setCustomId(`lfg_modal_${interaction.user.id}`)
      .setTitle("Schedule your LFG");

    const monthInput = new TextInputBuilder()
      .setCustomId("lfg_month")
      .setLabel("Month (1-12)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Enter month number (1 = Jan, 12 = Dec)")
      .setRequired(true);

    const dayInput = new TextInputBuilder()
      .setCustomId("lfg_day")
      .setLabel("Day (1-31)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Enter the day number")
      .setRequired(true);

    const timeInput = new TextInputBuilder()
      .setCustomId("lfg_time")
      .setLabel("Time (HHMM, UTC)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Example: 1530 for 15:30 UTC")
      .setRequired(true);

    const notesInput = new TextInputBuilder()
      .setCustomId("lfg_notes")
      .setLabel("Notes (optional)")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Extra info for your group")
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(monthInput),
      new ActionRowBuilder().addComponents(dayInput),
      new ActionRowBuilder().addComponents(timeInput),
      new ActionRowBuilder().addComponents(notesInput)
    );

    await interaction.showModal(modal);

    groups.set(`temp_${interaction.user.id}`, { activity, slots });
  },

  async button(interaction) {
    const group = groups.get(interaction.message.id);
    if (!group) return;

    const userId = interaction.user.id;

    if (interaction.customId === "lfg_join") {
      if (group.players.includes(userId)) return interaction.reply({ content: "You already joined this group.", ephemeral: true });
      if (group.players.length >= group.slots) return interaction.reply({ content: "This group is already full.", ephemeral: true });
      group.players.push(userId);
    }

    if (interaction.customId === "lfg_leave") {
      const index = group.players.indexOf(userId);
      if (index === -1) return interaction.reply({ content: "You aren't in this group.", ephemeral: true });
      group.players.splice(index, 1);
    }

    const playerList = group.players.map(id => `<@${id}>`).join("\n") || "No players yet";

    const embed = new EmbedBuilder()
      .setTitle(`LFG: ${group.activity}`)
      .addFields(
        { name: `Players (${group.players.length}/${group.slots})`, value: playerList },
        { name: "Scheduled for", value: group.dateTime },
        { name: "Notes", value: group.notes || "None" }
      );

    await interaction.update({ embeds: [embed] });
  }
};

export { groups };