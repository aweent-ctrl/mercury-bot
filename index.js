require("dotenv").config();

const fs = require("fs");

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ApplicationCommandOptionType,
  Events,
} = require("discord.js");

const DATA_FILE = "./data.json";
const EPHEMERAL_FLAG = 64;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const strely = new Map();
const scheduledTenMinute = new Set();
const scheduledCreatorTwoHour = new Set();
const scheduledStats = new Set();

let data = {
  blacklist: {},
  antiDeleteChannels: {},
  slotAdmins: {},
  activeEvents: {},
  stats: {},
};

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return;

  try {
    const loaded = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    data.blacklist = loaded.blacklist || {};
    data.antiDeleteChannels = loaded.antiDeleteChannels || {};
    data.slotAdmins = loaded.slotAdmins || {};
    data.activeEvents = loaded.activeEvents || {};
    data.stats = loaded.stats || {};
  } catch (error) {
    console.log("Ошибка чтения data.json:", error);

    data = {
      blacklist: {},
      antiDeleteChannels: {},
      slotAdmins: {},
      activeEvents: {},
      stats: {},
    };
  }
}

function saveData() {
  try {
    const tempFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
    fs.renameSync(tempFile, DATA_FILE);
  } catch (error) {
    console.log("Ошибка сохранения data.json:", error);
  }
}

function normalizeSlotAdmins(guildId) {
  const raw = data.slotAdmins[guildId];

  if (!raw) {
    data.slotAdmins[guildId] = [];
    return [];
  }

  if (Array.isArray(raw)) {
    data.slotAdmins[guildId] = raw.map((id) => String(id));
    return data.slotAdmins[guildId];
  }

  if (typeof raw === "object") {
    data.slotAdmins[guildId] = Object.keys(raw)
      .filter((id) => raw[id])
      .map((id) => String(id));

    return data.slotAdmins[guildId];
  }

  data.slotAdmins[guildId] = [];
  return [];
}

function normalizeStats(guildId) {
  if (!data.stats[guildId]) {
    data.stats[guildId] = {
      mainSlots: {},
    };
  }

  if (!data.stats[guildId].mainSlots) {
    data.stats[guildId].mainSlots = {};
  }

  return data.stats[guildId];
}

function normalizeEvent(eventItem) {
  if (!eventItem) return null;

  if (eventItem.eventDate && !(eventItem.eventDate instanceof Date)) {
    eventItem.eventDate = new Date(eventItem.eventDate);
  }

  eventItem.picked = Array.isArray(eventItem.picked) ? eventItem.picked : [];
  eventItem.players = Array.isArray(eventItem.players) ? eventItem.players : [];
  eventItem.replacements = Array.isArray(eventItem.replacements)
    ? eventItem.replacements
    : [];
  eventItem.specialPlayers = Array.isArray(eventItem.specialPlayers)
    ? eventItem.specialPlayers
    : [];

  if (typeof eventItem.fullFiveNotified !== "boolean") {
    eventItem.fullFiveNotified = false;
  }

  if (typeof eventItem.creatorTwoHourNotified !== "boolean") {
    eventItem.creatorTwoHourNotified = false;
  }

  if (typeof eventItem.tenMinuteNotified !== "boolean") {
    eventItem.tenMinuteNotified = false;
  }

  if (typeof eventItem.statsCounted !== "boolean") {
    eventItem.statsCounted = false;
  }

  return eventItem;
}

function serializeEvent(eventItem) {
  const normalized = normalizeEvent(eventItem);

  return {
    ...normalized,
    eventDate: normalized.eventDate ? normalized.eventDate.toISOString() : null,
  };
}

function deserializeEvent(eventItem) {
  return normalizeEvent({
    ...eventItem,
    eventDate: eventItem.eventDate ? new Date(eventItem.eventDate) : null,
  });
}

function saveEvent(messageId, eventItem) {
  const normalized = normalizeEvent(eventItem);

  strely.set(messageId, normalized);
  data.activeEvents[messageId] = serializeEvent(normalized);

  saveData();
}

function getEvent(messageId) {
  let eventItem = strely.get(messageId);

  if (eventItem) {
    return normalizeEvent(eventItem);
  }

  const savedEvent = data.activeEvents[messageId];

  if (!savedEvent) return null;

  eventItem = deserializeEvent(savedEvent);
  strely.set(messageId, eventItem);

  return eventItem;
}

function restoreActiveEvents() {
  strely.clear();

  for (const [messageId, eventItem] of Object.entries(data.activeEvents || {})) {
    strely.set(messageId, deserializeEvent(eventItem));
  }

  console.log(`Загружено активных записей: ${strely.size}`);
}

loadData();
restoreActiveEvents();

client.once(Events.ClientReady, async () => {
  console.log(`Бот запущен как ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    await guild.commands.set([
      {
        name: "adm",
        description: "Разрешить пользователю запускать слоты",
        options: [
          {
            name: "user",
            description: "Пользователь",
            type: ApplicationCommandOptionType.User,
            required: true,
          },
        ],
      },
      {
        name: "unadm",
        description: "Забрать у пользователя доступ к запуску слотов",
        options: [
          {
            name: "user",
            description: "Пользователь",
            type: ApplicationCommandOptionType.User,
            required: true,
          },
        ],
      },
      {
        name: "static",
        description: "Показать статистику, сколько раз люди были в основе на стреле",
      },
      {
        name: "ch",
        description: "Добавить игрока в ЧС на конкретный сервер",
        options: [
          {
            name: "server",
            description: "Название сервера",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "user",
            description: "Пользователь",
            type: ApplicationCommandOptionType.User,
            required: true,
          },
        ],
      },
      {
        name: "unch",
        description: "Убрать игрока из ЧС на конкретном сервере",
        options: [
          {
            name: "server",
            description: "Название сервера",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "user",
            description: "Пользователь",
            type: ApplicationCommandOptionType.User,
            required: true,
          },
        ],
      },
      {
        name: "antidel",
        description: "Включить или выключить автоудаление сообщений в этом канале",
      },
      {
        name: "redakt",
        description: "Редактировать состав созданной тобой метки/вышки/ФВ/притона",
        options: [
          {
            name: "action",
            description: "Что сделать с игроком",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
              { name: "Добавить в основу", value: "add_main" },
              { name: "Добавить в замену", value: "add_replace" },
              { name: "Добавить без сета", value: "add_no_set" },
              { name: "Добавить с сетом", value: "add_with_set" },
              { name: "Сет оплачен", value: "set_paid" },
              { name: "Убрать из состава", value: "remove" },
            ],
          },
          {
            name: "user",
            description: "Пользователь",
            type: ApplicationCommandOptionType.User,
            required: true,
          },
          {
            name: "message_id",
            description: "ID сообщения бота со слотами, если нужно",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ],
      },
      {
        name: "fw",
        description: "Создать пик слотов на ФВ",
        options: [
          {
            name: "time",
            description: "Время ФВ по МСК, например 21:30",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "against",
            description: "Против кого",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: "neft",
        description: "Создать пик слотов на нефтевышки",
        options: [
          {
            name: "organizations",
            description: "Организации",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "server",
            description: "Сервер",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: "priton",
        description: "Создать пик слотов на притон",
        options: [
          {
            name: "organizations",
            description: "Организации",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "server",
            description: "Сервер",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
    ]);
  }

  for (const [messageId] of strely.entries()) {
    scheduleCreatorTwoHourReminder(messageId);
    scheduleTenMinuteReminder(messageId);
    scheduleStatsCount(messageId);
  }

  console.log("Slash-команды зарегистрированы");
});

function ephemeralReply(content) {
  return {
    content,
    flags: EPHEMERAL_FLAG,
  };
}

function isUnknownInteractionError(error) {
  return error && Number(error.code) === 10062;
}

async function safeDeferReply(interaction, ephemeral = true) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      const options = ephemeral ? { flags: EPHEMERAL_FLAG } : {};
      await interaction.deferReply(options);
    }

    return true;
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      console.log(
        "Unknown interaction при deferReply. Скорее всего, запущены 2 копии бота или interaction уже протух."
      );
      return false;
    }

    console.log("Не удалось сделать deferReply:", error.message);
    return false;
  }
}

async function safeEditReply(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply({ content });
    }

    return await interaction.reply(ephemeralReply(content));
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      console.log(
        "Unknown interaction при ответе. Бот не упал, но ответить Discord уже не дал."
      );
      return;
    }

    console.log("Не удалось ответить на interaction:", error.message);
  }
}

function hasAdmin(member) {
  try {
    if (!member) return false;

    if (member.permissions && typeof member.permissions.has === "function") {
      return member.permissions.has(PermissionsBitField.Flags.Administrator);
    }

    return false;
  } catch (error) {
    return false;
  }
}

function interactionHasAdmin(interaction) {
  try {
    if (
      interaction.memberPermissions &&
      interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)
    ) {
      return true;
    }

    return hasAdmin(interaction.member);
  } catch (error) {
    return false;
  }
}

function isSlotAdmin(guildId, userId) {
  const list = normalizeSlotAdmins(String(guildId));
  return list.includes(String(userId));
}

function hasSlotCreatorAccess(member, guildId, userId) {
  if (!guildId || !userId) return false;
  if (hasAdmin(member)) return true;

  return isSlotAdmin(guildId, userId);
}

function interactionHasSlotCreatorAccess(interaction) {
  if (interactionHasAdmin(interaction)) return true;

  return isSlotAdmin(interaction.guild.id, interaction.user.id);
}

function addSlotAdmin(guildId, userId) {
  const guildKey = String(guildId);
  const userKey = String(userId);

  const list = normalizeSlotAdmins(guildKey);

  if (!list.includes(userKey)) {
    list.push(userKey);
  }

  data.slotAdmins[guildKey] = list;
  saveData();
}

function removeSlotAdmin(guildId, userId) {
  const guildKey = String(guildId);
  const userKey = String(userId);

  const list = normalizeSlotAdmins(guildKey);

  data.slotAdmins[guildKey] = list.filter((id) => id !== userKey);
  saveData();
}

function normalizeServerName(server) {
  return server.trim().toLowerCase();
}

function isBlacklisted(server, userId) {
  if (!server) return false;

  const serverKey = normalizeServerName(server);

  if (!data.blacklist[serverKey]) return false;

  return data.blacklist[serverKey].includes(userId);
}

function addToBlacklist(server, userId) {
  const serverKey = normalizeServerName(server);

  if (!data.blacklist[serverKey]) {
    data.blacklist[serverKey] = [];
  }

  if (!data.blacklist[serverKey].includes(userId)) {
    data.blacklist[serverKey].push(userId);
  }

  saveData();
}

function removeFromBlacklist(server, userId) {
  const serverKey = normalizeServerName(server);

  if (!data.blacklist[serverKey]) return;

  data.blacklist[serverKey] = data.blacklist[serverKey].filter(
    (id) => id !== userId
  );

  saveData();
}

function getChannelKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

function isAntiDeleteEnabled(guildId, channelId) {
  const key = getChannelKey(guildId, channelId);
  return data.antiDeleteChannels[key] === true;
}

function setAntiDelete(guildId, channelId, value) {
  const key = getChannelKey(guildId, channelId);
  data.antiDeleteChannels[key] = value;
  saveData();
}

function getField(text, fieldName) {
  const regex = new RegExp(`${fieldName}\\s*:\\s*(.+)`, "i");
  const match = text.match(regex);

  if (!match) return null;

  return match[1].trim();
}

function parseMskEventTime(timeText) {
  const match = timeText.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  const now = new Date();

  const mskNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);

  const year = mskNow.getUTCFullYear();
  const month = mskNow.getUTCMonth();
  const day = mskNow.getUTCDate();

  let eventDate = new Date(Date.UTC(year, month, day, hours - 3, minutes, 0, 0));

  if (eventDate.getTime() < now.getTime()) {
    eventDate = new Date(eventDate.getTime() + 24 * 60 * 60 * 1000);
  }

  return eventDate;
}

function minutesBeforeEvent(eventItem) {
  if (!eventItem.eventDate) return 999999;

  return Math.floor((eventItem.eventDate.getTime() - Date.now()) / 1000 / 60);
}

function isSpecialEvent(eventItem) {
  return ["fw", "neft", "priton"].includes(eventItem.type);
}

function getEventTitle(eventItem) {
  if (eventItem.type === "strela") return "Запись на стрелу";
  if (eventItem.type === "fw") return "Пик слотов на ФВ";
  if (eventItem.type === "neft") return "Пик слотов на нефтевышки";
  if (eventItem.type === "priton") return "Пик слотов на притон";

  return "Пик слотов";
}

function getReminderUsers(eventItem) {
  if (eventItem.type === "strela") {
    return [...new Set(eventItem.players || [])];
  }

  if (isSpecialEvent(eventItem)) {
    return [
      ...new Set((eventItem.specialPlayers || []).map((player) => player.userId)),
    ];
  }

  return [];
}

function buildDecideEmbed(eventItem) {
  const picked =
    eventItem.picked.length > 0
      ? eventItem.picked
          .map((userId, index) => `**${index + 1}.** <@${userId}>`)
          .join("\n")
      : "Пока никто не пикнул слот.";

  return new EmbedBuilder()
    .setTitle("Нам забили, решаем сколько слотов")
    .setColor(0xffa500)
    .addFields(
      { name: "Сервер", value: eventItem.server || "Не указан", inline: true },
      { name: "Карта", value: eventItem.map || "Не указана", inline: true },
      { name: "Оружие", value: eventItem.weapon || "Не указано", inline: true },
      {
        name: "Время",
        value: `${eventItem.timeText || "Не указано"} МСК`,
        inline: true,
      },
      { name: "Пикнувшие люди", value: picked },
      {
        name: "Статус",
        value:
          "Создатель слотов должен выбрать формат: 2/2, 3/3, 4/4 или 5/5.",
      }
    )
    .setFooter({ text: `Создал: ${eventItem.createdByTag}` });
}

function buildStrelaEmbed(eventItem) {
  const mainPlayers =
    eventItem.players.length > 0
      ? eventItem.players
          .map((userId, index) => `**Игрок ${index + 1}** — <@${userId}>`)
          .join("\n")
      : "Пока никто не пикнул слот.";

  const replaces =
    eventItem.replacements.length > 0
      ? eventItem.replacements
          .map((userId, index) => `**Замена ${index + 1}** — <@${userId}>`)
          .join("\n")
      : "Пока замен нет.";

  return new EmbedBuilder()
    .setTitle("Запись на стрелу")
    .setColor(0x8b0000)
    .addFields(
      { name: "Сервер", value: eventItem.server || "Не указан", inline: true },
      { name: "Количество людей", value: `${eventItem.limit}`, inline: true },
      { name: "Карта", value: eventItem.map || "Не указана", inline: true },
      { name: "Оружие", value: eventItem.weapon || "Не указано", inline: true },
      {
        name: "Время",
        value: `${eventItem.timeText || "Не указано"} МСК`,
        inline: true,
      },
      { name: "Основные слоты", value: mainPlayers },
      { name: "Замена", value: replaces }
    )
    .setFooter({ text: `Создал: ${eventItem.createdByTag}` });
}

function buildSpecialEmbed(eventItem) {
  const players =
    eventItem.specialPlayers.length > 0
      ? eventItem.specialPlayers
          .map(
            (player, index) =>
              `**${index + 1}.** <@${player.userId}> (${player.status})`
          )
          .join("\n")
      : "Пока никто не пикнул слот.";

  const embed = new EmbedBuilder()
    .setTitle(getEventTitle(eventItem))
    .setColor(0x8b0000)
    .setFooter({ text: `Создал: ${eventItem.createdByTag}` });

  if (eventItem.type === "fw") {
    embed.addFields(
      {
        name: "Время",
        value: `${eventItem.timeText || "Не указано"} МСК`,
        inline: true,
      },
      {
        name: "Против кого",
        value: eventItem.against || "Не указано",
        inline: true,
      },
      { name: "Пикнувшие слоты", value: players }
    );

    return embed;
  }

  if (eventItem.type === "neft" || eventItem.type === "priton") {
    embed.addFields(
      {
        name: "Организации",
        value: eventItem.organizations || "Не указано",
        inline: true,
      },
      { name: "Сервер", value: eventItem.server || "Не указан", inline: true },
      { name: "Пикнувшие слоты", value: players }
    );

    return embed;
  }

  return embed;
}

function buildEmbed(eventItem) {
  if (eventItem.mode === "decide") return buildDecideEmbed(eventItem);
  if (isSpecialEvent(eventItem)) return buildSpecialEmbed(eventItem);

  return buildStrelaEmbed(eventItem);
}

function buildDecideButtons() {
  const pickButton = new ButtonBuilder()
    .setCustomId("decide_pick")
    .setLabel("ПИКНУТЬ СЛОТ")
    .setStyle(ButtonStyle.Success);

  const unpickButton = new ButtonBuilder()
    .setCustomId("decide_unpick")
    .setLabel("ОТПИКНУТЬ СЛОТ")
    .setStyle(ButtonStyle.Danger);

  const row1 = new ActionRowBuilder().addComponents(pickButton, unpickButton);

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("format_2")
      .setLabel("2/2")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("format_3")
      .setLabel("3/3")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("format_4")
      .setLabel("4/4")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("format_5")
      .setLabel("5/5")
      .setStyle(ButtonStyle.Primary)
  );

  return [row1, row2];
}

function buildStrelaButtons(eventItem) {
  const isFull = eventItem.players.length >= eventItem.limit;

  const pickButton = new ButtonBuilder()
    .setCustomId("pick_slot")
    .setLabel("ПИКНУТЬ СЛОТ")
    .setStyle(ButtonStyle.Success)
    .setDisabled(isFull);

  const unpickButton = new ButtonBuilder()
    .setCustomId("unpick_slot")
    .setLabel("ОТПИКНУТЬ СЛОТ")
    .setStyle(ButtonStyle.Danger);

  const replaceButton = new ButtonBuilder()
    .setCustomId("replacement_slot")
    .setLabel("Я смогу быть на замене")
    .setStyle(ButtonStyle.Secondary);

  return [
    new ActionRowBuilder().addComponents(
      pickButton,
      unpickButton,
      replaceButton
    ),
  ];
}

function buildSpecialButtons() {
  const noSetButton = new ButtonBuilder()
    .setCustomId("special_no_set")
    .setLabel("ПИКНУТЬ СЛОТ (БЕЗ СЕТА)")
    .setStyle(ButtonStyle.Success);

  const withSetButton = new ButtonBuilder()
    .setCustomId("special_with_set")
    .setLabel("ПИКНУТЬ СЛОТ (С СЕТОМ)")
    .setStyle(ButtonStyle.Primary);

  const setPaidButton = new ButtonBuilder()
    .setCustomId("special_set_paid")
    .setLabel("СЕТ ОПЛАЧЕН")
    .setStyle(ButtonStyle.Secondary);

  return [
    new ActionRowBuilder().addComponents(
      noSetButton,
      withSetButton,
      setPaidButton
    ),
  ];
}

function buildButtons(eventItem) {
  if (eventItem.mode === "decide") return buildDecideButtons();
  if (isSpecialEvent(eventItem)) return buildSpecialButtons();

  return buildStrelaButtons(eventItem);
}

async function updateEventMessage(message, eventItem) {
  await message.edit({
    embeds: [buildEmbed(eventItem)],
    components: buildButtons(eventItem),
  });

  saveEvent(message.id, eventItem);
  scheduleTenMinuteReminder(message.id);
  scheduleStatsCount(message.id);
}

function addMainStats(guildId, userId) {
  const guildStats = normalizeStats(String(guildId));

  const key = String(userId);

  if (!guildStats.mainSlots[key]) {
    guildStats.mainSlots[key] = 0;
  }

  guildStats.mainSlots[key] += 1;
}

function countStatsForEvent(messageId) {
  const eventItem = getEvent(messageId);

  if (!eventItem) return;
  if (eventItem.statsCounted) return;
  if (eventItem.type !== "strela") return;
  if (eventItem.mode !== "normal") return;
  if (!Array.isArray(eventItem.players) || eventItem.players.length === 0) return;

  const uniquePlayers = [...new Set(eventItem.players)];

  for (const userId of uniquePlayers) {
    addMainStats(eventItem.guildId, userId);
  }

  eventItem.statsCounted = true;
  saveEvent(messageId, eventItem);

  console.log(`Статистика записана для стрелы ${messageId}`);
}

function scheduleStatsCount(messageId) {
  const eventItem = getEvent(messageId);

  if (!eventItem) return;
  if (!eventItem.eventDate) return;
  if (eventItem.statsCounted) return;
  if (eventItem.type !== "strela") return;

  const delay = eventItem.eventDate.getTime() - Date.now();

  if (delay <= 0) {
    countStatsForEvent(messageId);
    return;
  }

  if (scheduledStats.has(messageId)) return;

  scheduledStats.add(messageId);

  setTimeout(() => {
    scheduledStats.delete(messageId);
    countStatsForEvent(messageId);
  }, delay);
}

async function promoteFirstReplacement(messageId, eventItem) {
  if (eventItem.replacements.length === 0) return null;

  const promotedUserId = eventItem.replacements.shift();
  eventItem.players.push(promotedUserId);

  try {
    const user = await client.users.fetch(promotedUserId);

    await user.send("ОСНОВНОЙ ИГРОК НЕ СМОЖЕТ - ТЫ ИДЕШЬ НА МЕТКУ");
  } catch (error) {
    console.log(`Не удалось отправить ЛС пользователю ${promotedUserId}`);
  }

  saveEvent(messageId, eventItem);

  return promotedUserId;
}

async function notifyCreatorAboutFive(messageId, eventItem) {
  if (eventItem.fullFiveNotified) return;
  if (eventItem.picked.length < 5) return;

  eventItem.fullFiveNotified = true;

  try {
    const user = await client.users.fetch(eventItem.createdById);

    await user.send(
      `На стрелу **${eventItem.server}** уже пикнулось 5 человек. Можно закрывать пик слотов и выбирать формат.`
    );
  } catch (error) {
    console.log(`Не удалось отправить ЛС создателю ${eventItem.createdById}`);
  }

  saveEvent(messageId, eventItem);
}

function scheduleCreatorTwoHourReminder(messageId) {
  const eventItem = getEvent(messageId);

  if (!eventItem) return;
  if (eventItem.type !== "strela") return;
  if (eventItem.mode !== "decide") return;
  if (!eventItem.eventDate) return;
  if (eventItem.creatorTwoHourNotified) return;
  if (scheduledCreatorTwoHour.has(messageId)) return;

  const remindTime = eventItem.eventDate.getTime() - 2 * 60 * 60 * 1000;
  const delay = remindTime - Date.now();

  if (delay <= 0) return;

  scheduledCreatorTwoHour.add(messageId);

  setTimeout(async () => {
    scheduledCreatorTwoHour.delete(messageId);

    const latest = getEvent(messageId);

    if (!latest) return;
    if (latest.mode !== "decide") return;
    if (latest.creatorTwoHourNotified) return;

    latest.creatorTwoHourNotified = true;

    try {
      const user = await client.users.fetch(latest.createdById);

      await user.send(
        `До стрелы на сервере **${latest.server}** осталось 2 часа.\nПикнувших людей: **${latest.picked.length}**.\nВремя: **${latest.timeText} МСК**.\nСервер: **${latest.server || "не указан"}**.\nЗайди и выбери формат 2/2, 3/3, 4/4 или 5/5.`
      );
    } catch (error) {
      console.log(`Не удалось отправить ЛС создателю ${latest.createdById}`);
    }

    saveEvent(messageId, latest);
  }, delay);
}

function scheduleTenMinuteReminder(messageId) {
  const eventItem = getEvent(messageId);

  if (!eventItem) return;
  if (!eventItem.eventDate) return;
  if (eventItem.tenMinuteNotified) return;

  const eventTime = eventItem.eventDate.getTime();
  const now = Date.now();

  if (eventTime <= now) return;

  const remindTime = eventTime - 10 * 60 * 1000;
  const delay = remindTime - now;

  if (delay <= 0) {
    runTenMinuteReminder(messageId);
    return;
  }

  if (scheduledTenMinute.has(messageId)) return;

  scheduledTenMinute.add(messageId);

  setTimeout(async () => {
    scheduledTenMinute.delete(messageId);
    await runTenMinuteReminder(messageId);
  }, delay);
}

async function runTenMinuteReminder(messageId) {
  const latest = getEvent(messageId);

  if (!latest) return;
  if (!latest.eventDate) return;
  if (latest.tenMinuteNotified) return;

  const now = Date.now();
  const eventTime = latest.eventDate.getTime();

  if (eventTime <= now) return;

  const userIds = getReminderUsers(latest);

  if (userIds.length === 0) {
    return;
  }

  const title = getEventTitle(latest);
  const timeText = latest.timeText ? `${latest.timeText} МСК` : "не указано";
  const serverText = latest.server || "не указан";
  const mentions = userIds.map((id) => `<@${id}>`).join(" ");

  for (const userId of userIds) {
    try {
      const user = await client.users.fetch(userId);

      await user.send(
        `⏰ Напоминание: через 10 минут будет стрела.\n\n${title}\nВремя: ${timeText}\nСервер: ${serverText}`
      );
    } catch (error) {
      console.log(`Не удалось отправить ЛС пользователю ${userId}`);
    }
  }

  try {
    const channel = await client.channels.fetch(latest.channelId);

    if (channel && channel.send) {
      await channel.send({
        content:
          `⏰ ${mentions}\n` +
          `Через 10 минут будет **${title}**.\n` +
          `Время: **${timeText}**.\n` +
          `Сервер: **${serverText}**.`,
        allowedMentions: {
          users: userIds,
        },
      });
    }
  } catch (error) {
    console.log("Не удалось отправить напоминание в канал:", error.message);
  }

  latest.tenMinuteNotified = true;
  saveEvent(messageId, latest);
}

async function sendHelp(message) {
  return message.reply(
    [
      "**Команды бота:**",
      "",
      "**/adm @user** — выдать пользователю доступ к запуску слотов.",
      "**/unadm @user** — забрать доступ к запуску слотов.",
      "**/static** — статистика, сколько раз люди были в основе на стреле.",
      "",
      "**!strela** — обычная стрела с лимитом людей.",
      "```text",
      "!strela",
      "Сервер: Gilbert",
      "Количество людей: 5",
      "Карта: SF",
      "Оружие: AK-47",
      "Время: 21:30",
      "```",
      "",
      "**!strela 2** — когда вам забили стрелу, и сначала нужно понять сколько людей пойдёт.",
      "```text",
      "!strela 2",
      "Сервер: Gilbert",
      "Карта: SF",
      "Оружие: AK-47",
      "Время: 21:30",
      "```",
      "",
      "Время везде указывается по **МСК**.",
      "",
      "**/fw** — пик слотов на ФВ.",
      "**/neft** — пик слотов на нефтевышки.",
      "**/priton** — пик слотов на притон.",
      "**/redakt** — редактировать состав.",
      "**!limit число** — изменить лимит, ответив на сообщение бота.",
      "**/ch** — добавить игрока в ЧС сервера.",
      "**/unch** — убрать игрока из ЧС сервера.",
      "**/antidel** — включить/выключить автоудаление сообщений.",
    ].join("\n")
  );
}

async function handleLimitCommand(message) {
  if (!hasAdmin(message.member)) {
    return message.reply("Менять количество людей может только администратор.");
  }

  const args = message.content.split(/\s+/);
  const newLimit = Number(args[1]);

  if (!Number.isInteger(newLimit) || newLimit <= 0) {
    return message.reply("Напиши новое количество. Например: `!limit 7`");
  }

  if (!message.reference || !message.reference.messageId) {
    return message.reply(
      "Нужно ответить командой `!limit 7` на сообщение бота со слотами."
    );
  }

  const targetMessageId = message.reference.messageId;
  const eventItem = getEvent(targetMessageId);

  if (!eventItem) {
    return message.reply("Не нашёл активные слоты в этом сообщении.");
  }

  if (eventItem.mode === "decide") {
    return message.reply(
      "В режиме `!strela 2` количество выбирается кнопками 2/2, 3/3, 4/4 или 5/5."
    );
  }

  if (isSpecialEvent(eventItem)) {
    return message.reply("Для `/fw`, `/neft`, `/priton` лимита нет.");
  }

  if (newLimit < eventItem.players.length) {
    return message.reply(
      `Нельзя поставить лимит ${newLimit}, потому что уже есть ${eventItem.players.length} основных игроков.`
    );
  }

  eventItem.limit = newLimit;

  const targetMessage = await message.channel.messages.fetch(targetMessageId);
  await updateEventMessage(targetMessage, eventItem);

  await message.delete().catch(() => {});
}

function createBaseStrelaEvent(message, server, map, weapon, timeText, eventDate) {
  return {
    type: "strela",
    mode: "normal",
    server,
    limit: null,
    map,
    weapon,
    timeText,
    eventDate,
    picked: [],
    players: [],
    replacements: [],
    specialPlayers: [],
    createdById: message.author.id,
    createdByTag: message.author.tag,
    guildId: message.guild.id,
    channelId: message.channel.id,
    fullFiveNotified: false,
    creatorTwoHourNotified: false,
    tenMinuteNotified: false,
    statsCounted: false,
  };
}

async function handleCreateStrela(message) {
  if (
    !hasSlotCreatorAccess(
      message.member,
      message.guild.id,
      message.author.id
    )
  ) {
    return message.reply(
      "У тебя нет доступа к запуску слотов. Администратор должен выдать доступ командой `/adm @user`."
    );
  }

  const isDecideMode = message.content.startsWith("!strela 2");

  const server = getField(message.content, "Сервер");
  const limitText = getField(message.content, "Количество людей");
  const map = getField(message.content, "Карта");
  const weapon = getField(message.content, "Оружие");
  const timeText = getField(message.content, "Время");

  if (isDecideMode) {
    if (!server || !map || !weapon || !timeText) {
      return message.reply(
        "Неправильная форма:\n```text\n!strela 2\nСервер: Gilbert\nКарта: SF\nОружие: AK-47\nВремя: 21:30\n```"
      );
    }

    const eventDate = parseMskEventTime(timeText);

    if (!eventDate) {
      return message.reply(
        "Время должно быть в формате `21:30` и указывается по МСК."
      );
    }

    await message.delete().catch(() => {});

    const eventItem = createBaseStrelaEvent(
      message,
      server,
      map,
      weapon,
      timeText,
      eventDate
    );

    eventItem.mode = "decide";

    const sentMessage = await message.channel.send({
      embeds: [buildEmbed(eventItem)],
      components: buildButtons(eventItem),
    });

    saveEvent(sentMessage.id, eventItem);

    setAntiDelete(message.guild.id, message.channel.id, true);
    scheduleCreatorTwoHourReminder(sentMessage.id);
    scheduleTenMinuteReminder(sentMessage.id);
    scheduleStatsCount(sentMessage.id);

    return;
  }

  if (!server || !limitText || !map || !weapon || !timeText) {
    return message.reply(
      "Неправильная форма:\n```text\n!strela\nСервер: Gilbert\nКоличество людей: 5\nКарта: SF\nОружие: AK-47\nВремя: 21:30\n```"
    );
  }

  const limit = Number(limitText);
  const eventDate = parseMskEventTime(timeText);

  if (!Number.isInteger(limit) || limit <= 0) {
    return message.reply("Количество людей должно быть числом. Например: `5`");
  }

  if (!eventDate) {
    return message.reply(
      "Время должно быть в формате `21:30` и указывается по МСК."
    );
  }

  await message.delete().catch(() => {});

  const eventItem = createBaseStrelaEvent(
    message,
    server,
    map,
    weapon,
    timeText,
    eventDate
  );

  eventItem.limit = limit;

  const sentMessage = await message.channel.send({
    embeds: [buildEmbed(eventItem)],
    components: buildButtons(eventItem),
  });

  saveEvent(sentMessage.id, eventItem);

  setAntiDelete(message.guild.id, message.channel.id, true);
  scheduleTenMinuteReminder(sentMessage.id);
  scheduleStatsCount(sentMessage.id);
}

async function createSlashSlotEvent(interaction, eventItem) {
  if (!interactionHasSlotCreatorAccess(interaction)) {
    return interaction.editReply({
      content:
        "У тебя нет доступа к запуску слотов. Администратор должен выдать доступ командой `/adm @user`.",
    });
  }

  const sentMessage = await interaction.channel.send({
    embeds: [buildEmbed(eventItem)],
    components: buildButtons(eventItem),
  });

  saveEvent(sentMessage.id, eventItem);

  setAntiDelete(interaction.guild.id, interaction.channel.id, true);
  scheduleTenMinuteReminder(sentMessage.id);
  scheduleStatsCount(sentMessage.id);

  return interaction.editReply({
    content: "Слоты созданы.",
  });
}

function setSpecialPlayerStatus(eventItem, userId, status) {
  const existingPlayer = eventItem.specialPlayers.find(
    (player) => player.userId === userId
  );

  if (existingPlayer) {
    existingPlayer.status = status;
    return;
  }

  eventItem.specialPlayers.push({
    userId,
    status,
  });
}

function removeUserFromEvent(eventItem, userId) {
  eventItem.picked = eventItem.picked.filter((id) => id !== userId);
  eventItem.players = eventItem.players.filter((id) => id !== userId);
  eventItem.replacements = eventItem.replacements.filter((id) => id !== userId);
  eventItem.specialPlayers = eventItem.specialPlayers.filter(
    (player) => player.userId !== userId
  );
}

function findEditableEvent(interaction, messageId) {
  if (messageId) {
    const eventItem = getEvent(messageId);

    if (!eventItem) return null;

    return {
      messageId,
      eventItem,
    };
  }

  const events = Array.from(strely.entries()).reverse();

  const found = events.find(([, eventItem]) => {
    return (
      eventItem.channelId === interaction.channel.id &&
      eventItem.createdById === interaction.user.id
    );
  });

  if (!found) return null;

  return {
    messageId: found[0],
    eventItem: found[1],
  };
}

async function handleRedaktCommand(interaction) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  const action = interaction.options.getString("action");
  const user = interaction.options.getUser("user");
  const messageId = interaction.options.getString("message_id");

  const found = findEditableEvent(interaction, messageId);

  if (!found) {
    return interaction.editReply({
      content:
        "Не нашёл твою активную метку в этом канале. Попробуй указать `message_id` сообщения бота.",
    });
  }

  const { eventItem } = found;

  if (eventItem.createdById !== interaction.user.id && !interactionHasAdmin(interaction)) {
    return interaction.editReply({
      content:
        "Редактировать состав может только человек, который создал эти слоты, или администратор.",
    });
  }

  if (action === "remove") {
    removeUserFromEvent(eventItem, user.id);
  } else if (eventItem.mode === "decide") {
    if (action !== "add_main") {
      return interaction.editReply({
        content:
          "Для `!strela 2` до выбора формата можно использовать только `add_main` или `remove`.",
      });
    }

    if (!eventItem.picked.includes(user.id)) {
      eventItem.picked.push(user.id);
    }
  } else if (isSpecialEvent(eventItem)) {
    if (action === "add_no_set") {
      setSpecialPlayerStatus(eventItem, user.id, "без сета");
    } else if (action === "add_with_set") {
      setSpecialPlayerStatus(eventItem, user.id, "с сетом");
    } else if (action === "set_paid") {
      setSpecialPlayerStatus(eventItem, user.id, "сет оплачен");
    } else {
      return interaction.editReply({
        content:
          "Для `/fw`, `/neft`, `/priton` используй `add_no_set`, `add_with_set`, `set_paid` или `remove`.",
      });
    }
  } else {
    if (action === "add_main") {
      if (eventItem.players.includes(user.id)) {
        return interaction.editReply({
          content: "Этот игрок уже в основе.",
        });
      }

      if (eventItem.players.length >= eventItem.limit) {
        return interaction.editReply({
          content:
            "Основа уже заполнена. Сначала убери кого-то или измени лимит.",
        });
      }

      eventItem.replacements = eventItem.replacements.filter(
        (id) => id !== user.id
      );

      eventItem.players.push(user.id);
    } else if (action === "add_replace") {
      if (eventItem.replacements.includes(user.id)) {
        return interaction.editReply({
          content: "Этот игрок уже в замене.",
        });
      }

      eventItem.players = eventItem.players.filter((id) => id !== user.id);
      eventItem.replacements.push(user.id);
    } else {
      return interaction.editReply({
        content:
          "Для обычной стрелы используй `add_main`, `add_replace` или `remove`.",
      });
    }
  }

  const targetMessage = await interaction.channel.messages
    .fetch(found.messageId)
    .catch(() => null);

  if (!targetMessage) {
    saveEvent(found.messageId, eventItem);

    return interaction.editReply({
      content:
        "Состав изменён в памяти бота, но я не смог найти сообщение для обновления.",
    });
  }

  await updateEventMessage(targetMessage, eventItem);

  return interaction.editReply({
    content: `Состав обновлён для <@${user.id}>.`,
  });
}

async function handleAdmCommand(interaction) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  if (!interactionHasAdmin(interaction)) {
    return interaction.editReply({
      content: "Команда `/adm` доступна только администраторам сервера.",
    });
  }

  const user = interaction.options.getUser("user");

  addSlotAdmin(interaction.guild.id, user.id);

  return interaction.editReply({
    content:
      `<@${user.id}> теперь может запускать слоты.\n` +
      `Проверка: ID сохранён в список доступа этого сервера.`,
  });
}

async function handleUnadmCommand(interaction) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  if (!interactionHasAdmin(interaction)) {
    return interaction.editReply({
      content: "Команда `/unadm` доступна только администраторам сервера.",
    });
  }

  const user = interaction.options.getUser("user");

  removeSlotAdmin(interaction.guild.id, user.id);

  return interaction.editReply({
    content: `У <@${user.id}> забран доступ к запуску слотов.`,
  });
}

async function handleStaticCommand(interaction) {
  const deferred = await safeDeferReply(interaction, false);
  if (!deferred) return;

  const guildId = String(interaction.guild.id);
  const guildStats = normalizeStats(guildId);
  const entries = Object.entries(guildStats.mainSlots || {}).sort(
    (a, b) => b[1] - a[1]
  );

  if (entries.length === 0) {
    return interaction.editReply({
      content:
        "Статистика пока пустая. Она начнёт заполняться после завершения новых стрел.",
    });
  }

  const lines = entries.map(([userId, count], index) => {
    return `**${index + 1}.** <@${userId}> — **${count}** раз(а) в основе`;
  });

  let content = "**Статистика основы на стрелах:**\n\n" + lines.join("\n");

  if (content.length > 1900) {
    content =
      "**Статистика основы на стрелах:**\n\n" +
      lines.slice(0, 40).join("\n") +
      "\n\nПоказаны первые 40 человек.";
  }

  return interaction.editReply({
    content,
    allowedMentions: {
      users: [],
      roles: [],
      parse: [],
    },
  });
}

async function handleChCommand(interaction) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  if (!interactionHasAdmin(interaction)) {
    return interaction.editReply({
      content: "Добавлять в ЧС может только администратор.",
    });
  }

  const server = interaction.options.getString("server");
  const user = interaction.options.getUser("user");

  addToBlacklist(server, user.id);

  return interaction.editReply({
    content: `<@${user.id}> добавлен в ЧС сервера **${server}**.`,
  });
}

async function handleUnchCommand(interaction) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  if (!interactionHasAdmin(interaction)) {
    return interaction.editReply({
      content: "Убирать из ЧС может только администратор.",
    });
  }

  const server = interaction.options.getString("server");
  const user = interaction.options.getUser("user");

  removeFromBlacklist(server, user.id);

  return interaction.editReply({
    content: `<@${user.id}> убран из ЧС сервера **${server}**.`,
  });
}

async function handleAntidelCommand(interaction) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  if (!interactionHasAdmin(interaction)) {
    return interaction.editReply({
      content: "Команда `/antidel` доступна только администраторам.",
    });
  }

  const current = isAntiDeleteEnabled(
    interaction.guild.id,
    interaction.channel.id
  );

  setAntiDelete(interaction.guild.id, interaction.channel.id, !current);

  return interaction.editReply({
    content: !current
      ? "Автоудаление сообщений в этом канале включено."
      : "Автоудаление сообщений в этом канале выключено.",
  });
}

async function handleFwCommand(interaction) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  const timeText = interaction.options.getString("time");
  const against = interaction.options.getString("against");
  const eventDate = parseMskEventTime(timeText);

  if (!eventDate) {
    return interaction.editReply({
      content: "Время должно быть в формате `21:30` и указывается по МСК.",
    });
  }

  const eventItem = {
    type: "fw",
    mode: "special",
    server: null,
    limit: null,
    timeText,
    eventDate,
    against,
    organizations: null,
    picked: [],
    players: [],
    replacements: [],
    specialPlayers: [],
    createdById: interaction.user.id,
    createdByTag: interaction.user.tag,
    guildId: interaction.guild.id,
    channelId: interaction.channel.id,
    fullFiveNotified: false,
    creatorTwoHourNotified: false,
    tenMinuteNotified: false,
    statsCounted: false,
  };

  return createSlashSlotEvent(interaction, eventItem);
}

async function handleNeftCommand(interaction) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  const organizations = interaction.options.getString("organizations");
  const server = interaction.options.getString("server");

  const eventItem = {
    type: "neft",
    mode: "special",
    server,
    limit: null,
    timeText: null,
    eventDate: null,
    against: null,
    organizations,
    picked: [],
    players: [],
    replacements: [],
    specialPlayers: [],
    createdById: interaction.user.id,
    createdByTag: interaction.user.tag,
    guildId: interaction.guild.id,
    channelId: interaction.channel.id,
    fullFiveNotified: false,
    creatorTwoHourNotified: false,
    tenMinuteNotified: false,
    statsCounted: false,
  };

  return createSlashSlotEvent(interaction, eventItem);
}

async function handlePritonCommand(interaction) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  const organizations = interaction.options.getString("organizations");
  const server = interaction.options.getString("server");

  const eventItem = {
    type: "priton",
    mode: "special",
    server,
    limit: null,
    timeText: null,
    eventDate: null,
    against: null,
    organizations,
    picked: [],
    players: [],
    replacements: [],
    specialPlayers: [],
    createdById: interaction.user.id,
    createdByTag: interaction.user.tag,
    guildId: interaction.guild.id,
    channelId: interaction.channel.id,
    fullFiveNotified: false,
    creatorTwoHourNotified: false,
    tenMinuteNotified: false,
    statsCounted: false,
  };

  return createSlashSlotEvent(interaction, eventItem);
}

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;

    if (message.content === "!help") {
      return sendHelp(message);
    }

    if (message.content.startsWith("!limit")) {
      return handleLimitCommand(message);
    }

    if (message.content.startsWith("!strela")) {
      return handleCreateStrela(message);
    }

    if (isAntiDeleteEnabled(message.guild.id, message.channel.id)) {
      await message.delete().catch(() => {});
    }
  } catch (error) {
    console.error("Ошибка messageCreate:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "adm") {
        return handleAdmCommand(interaction);
      }

      if (interaction.commandName === "unadm") {
        return handleUnadmCommand(interaction);
      }

      if (interaction.commandName === "static") {
        return handleStaticCommand(interaction);
      }

      if (interaction.commandName === "redakt") {
        return handleRedaktCommand(interaction);
      }

      if (interaction.commandName === "ch") {
        return handleChCommand(interaction);
      }

      if (interaction.commandName === "unch") {
        return handleUnchCommand(interaction);
      }

      if (interaction.commandName === "antidel") {
        return handleAntidelCommand(interaction);
      }

      if (interaction.commandName === "fw") {
        return handleFwCommand(interaction);
      }

      if (interaction.commandName === "neft") {
        return handleNeftCommand(interaction);
      }

      if (interaction.commandName === "priton") {
        return handlePritonCommand(interaction);
      }

      return;
    }

    if (!interaction.isButton()) return;

    const deferred = await safeDeferReply(interaction);
    if (!deferred) return;

    const messageId = interaction.message.id;
    const eventItem = getEvent(messageId);

    if (!eventItem) {
      return interaction.editReply({
        content:
          "Эта запись не найдена. Если она была создана на старом коде — создай запись заново.",
      });
    }

    const userId = interaction.user.id;

    if (eventItem.server && isBlacklisted(eventItem.server, userId)) {
      return interaction.editReply({
        content: `Ты находишься в ЧС сервера **${eventItem.server}** и не можешь пикать эти слоты.`,
      });
    }

    if (interaction.customId === "special_no_set") {
      setSpecialPlayerStatus(eventItem, userId, "без сета");
      await updateEventMessage(interaction.message, eventItem);

      return interaction.editReply({
        content: "Ты пикнул слот без сета.",
      });
    }

    if (interaction.customId === "special_with_set") {
      setSpecialPlayerStatus(eventItem, userId, "с сетом");
      await updateEventMessage(interaction.message, eventItem);

      return interaction.editReply({
        content: "Ты пикнул слот с сетом.",
      });
    }

    if (interaction.customId === "special_set_paid") {
      setSpecialPlayerStatus(eventItem, userId, "сет оплачен");
      await updateEventMessage(interaction.message, eventItem);

      return interaction.editReply({
        content: "Отмечено: сет оплачен.",
      });
    }

    if (interaction.customId === "decide_pick") {
      if (eventItem.picked.includes(userId)) {
        return interaction.editReply({
          content: "Ты уже пикнул слот.",
        });
      }

      eventItem.picked.push(userId);

      await notifyCreatorAboutFive(messageId, eventItem);
      await updateEventMessage(interaction.message, eventItem);

      return interaction.editReply({
        content: "Ты пикнул слот.",
      });
    }

    if (interaction.customId === "decide_unpick") {
      const minutesLeft = minutesBeforeEvent(eventItem);

      if (minutesLeft < 20) {
        return interaction.editReply({
          content:
            "Нельзя отпикнуть слот, если до события осталось меньше 20 минут.",
        });
      }

      if (!eventItem.picked.includes(userId)) {
        return interaction.editReply({
          content: "Ты не пикал слот.",
        });
      }

      eventItem.picked = eventItem.picked.filter((id) => id !== userId);

      await updateEventMessage(interaction.message, eventItem);

      return interaction.editReply({
        content: "Ты отпикнул слот.",
      });
    }

    if (interaction.customId.startsWith("format_")) {
      if (interaction.user.id !== eventItem.createdById && !interactionHasAdmin(interaction)) {
        return interaction.editReply({
          content:
            "Выбрать формат может только человек, который создал эти слоты, или администратор.",
        });
      }

      const limit = Number(interaction.customId.replace("format_", ""));

      eventItem.mode = "normal";
      eventItem.limit = limit;
      eventItem.players = eventItem.picked.slice(0, limit);
      eventItem.replacements = eventItem.picked.slice(limit);

      await updateEventMessage(interaction.message, eventItem);

      return interaction.editReply({
        content: `Формат выбран: ${limit}/${limit}. Первые ${limit} игроков пошли в основу, остальные — на замену.`,
      });
    }

    if (interaction.customId === "pick_slot") {
      if (eventItem.players.includes(userId)) {
        return interaction.editReply({
          content: "Ты уже в основном слоте.",
        });
      }

      if (eventItem.replacements.includes(userId)) {
        eventItem.replacements = eventItem.replacements.filter(
          (id) => id !== userId
        );
      }

      if (eventItem.players.length >= eventItem.limit) {
        return interaction.editReply({
          content: "Основные слоты уже заполнены. Можешь стать на замену.",
        });
      }

      eventItem.players.push(userId);

      await updateEventMessage(interaction.message, eventItem);

      return interaction.editReply({
        content: "Ты занял слот.",
      });
    }

    if (interaction.customId === "unpick_slot") {
      const minutesLeft = minutesBeforeEvent(eventItem);

      if (minutesLeft < 20) {
        return interaction.editReply({
          content:
            "Нельзя отпикнуть слот, если до события осталось меньше 20 минут.",
        });
      }

      if (eventItem.players.includes(userId)) {
        eventItem.players = eventItem.players.filter((id) => id !== userId);

        await promoteFirstReplacement(messageId, eventItem);
        await updateEventMessage(interaction.message, eventItem);

        return interaction.editReply({
          content: "Ты отпикнул основной слот.",
        });
      }

      if (eventItem.replacements.includes(userId)) {
        eventItem.replacements = eventItem.replacements.filter(
          (id) => id !== userId
        );

        await updateEventMessage(interaction.message, eventItem);

        return interaction.editReply({
          content: "Ты отпикнул замену.",
        });
      }

      return interaction.editReply({
        content: "Ты не записан в эти слоты.",
      });
    }

    if (interaction.customId === "replacement_slot") {
      if (eventItem.players.includes(userId)) {
        return interaction.editReply({
          content: "Ты уже в основном слоте.",
        });
      }

      if (eventItem.replacements.includes(userId)) {
        return interaction.editReply({
          content: "Ты уже записан на замену.",
        });
      }

      eventItem.replacements.push(userId);

      await updateEventMessage(interaction.message, eventItem);

      return interaction.editReply({
        content: "Ты записан на замену.",
      });
    }

    return interaction.editReply({
      content: "Неизвестная кнопка.",
    });
  } catch (error) {
    console.error("Ошибка interactionCreate:", error);

    if (interaction.isRepliable()) {
      await safeEditReply(
        interaction,
        "Произошла ошибка, но бот не упал. Проверь консоль."
      );
    }
  }
});

client.on("error", (error) => {
  console.error("Client error:", error);
});

client.on("shardError", (error) => {
  console.error("Shard error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled Rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

client.login(process.env.DISCORD_TOKEN);