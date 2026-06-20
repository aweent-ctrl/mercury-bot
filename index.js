require("dotenv").config();

const fs = require("fs");

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  ApplicationCommandOptionType,
  ChannelType,
} = require("discord.js");

const DATA_FILE = "./data.json";
const LOCAL_TIMEZONE = process.env.TIMEZONE || "Europe/Moscow";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const events = new Map();

let data = {
  blacklist: {},
  antiDeleteChannels: {},
  privateRooms: {},
};

if (fs.existsSync(DATA_FILE)) {
  data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

  if (!data.blacklist) data.blacklist = {};
  if (!data.antiDeleteChannels) data.antiDeleteChannels = {};
  if (!data.privateRooms) data.privateRooms = {};
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

client.once("clientReady", async () => {
  console.log(`Бот запущен как ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    await guild.commands.set([
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
        name: "rooms",
        description: "Создать панель приватных голосовых комнат",
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
              {
                name: "Добавить в основу",
                value: "add_main",
              },
              {
                name: "Добавить в замену",
                value: "add_replace",
              },
              {
                name: "Добавить без сета",
                value: "add_no_set",
              },
              {
                name: "Добавить с сетом",
                value: "add_with_set",
              },
              {
                name: "Сет оплачен",
                value: "set_paid",
              },
              {
                name: "Убрать из состава",
                value: "remove",
              },
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
            description: "Время ФВ, например 21:30",
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

  console.log("Slash-команды зарегистрированы");
});

function hasAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function hasDeputyOrHigher(member) {
  if (hasAdmin(member)) return true;

  const deputyRole = member.guild.roles.cache.find(
    (role) => role.name.toLowerCase() === "deputy"
  );

  if (!deputyRole) return false;

  return member.roles.cache.some((role) => role.position >= deputyRole.position);
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

function getZonedDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const result = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      result[part.type] = Number(part.value);
    }
  }

  return result;
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = getZonedDateParts(date, timeZone);

  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return asUtc - date.getTime();
}

function makeDateInTimeZone(year, month, day, hour, minute, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  let offset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  let result = new Date(utcGuess - offset);

  const secondOffset = getTimeZoneOffsetMs(result, timeZone);

  if (secondOffset !== offset) {
    result = new Date(utcGuess - secondOffset);
  }

  return result;
}

function parseEventTime(timeText) {
  const match = String(timeText).trim().match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  const now = new Date();
  const nowParts = getZonedDateParts(now, LOCAL_TIMEZONE);

  let eventDate = makeDateInTimeZone(
    nowParts.year,
    nowParts.month,
    nowParts.day,
    hours,
    minutes,
    LOCAL_TIMEZONE
  );

  if (eventDate.getTime() <= Date.now()) {
    eventDate = makeDateInTimeZone(
      nowParts.year,
      nowParts.month,
      nowParts.day + 1,
      hours,
      minutes,
      LOCAL_TIMEZONE
    );
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
      {
        name: "Сервер",
        value: eventItem.server,
        inline: true,
      },
      {
        name: "Карта",
        value: eventItem.map,
        inline: true,
      },
      {
        name: "Оружие",
        value: eventItem.weapon,
        inline: true,
      },
      {
        name: "Время",
        value: eventItem.timeText,
        inline: true,
      },
      {
        name: "Пикнувшие люди",
        value: picked,
      },
      {
        name: "Статус",
        value: "Создатель слотов должен выбрать формат: 2/2, 3/3, 4/4 или 5/5.",
      }
    )
    .setFooter({
      text: `Создал: ${eventItem.createdByTag}`,
    });
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
      {
        name: "Сервер",
        value: eventItem.server,
        inline: true,
      },
      {
        name: "Количество людей",
        value: `${eventItem.limit}`,
        inline: true,
      },
      {
        name: "Карта",
        value: eventItem.map,
        inline: true,
      },
      {
        name: "Оружие",
        value: eventItem.weapon,
        inline: true,
      },
      {
        name: "Время",
        value: eventItem.timeText,
        inline: true,
      },
      {
        name: "Основные слоты",
        value: mainPlayers,
      },
      {
        name: "Замена",
        value: replaces,
      }
    )
    .setFooter({
      text: `Создал: ${eventItem.createdByTag}`,
    });
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
    .setFooter({
      text: `Создал: ${eventItem.createdByTag}`,
    });

  if (eventItem.type === "fw") {
    embed.addFields(
      {
        name: "Время",
        value: eventItem.timeText,
        inline: true,
      },
      {
        name: "Против кого",
        value: eventItem.against,
        inline: true,
      },
      {
        name: "Пикнувшие слоты",
        value: players,
      }
    );

    return embed;
  }

  if (eventItem.type === "neft" || eventItem.type === "priton") {
    embed.addFields(
      {
        name: "Организации",
        value: eventItem.organizations,
        inline: true,
      },
      {
        name: "Сервер",
        value: eventItem.server,
        inline: true,
      },
      {
        name: "Пикнувшие слоты",
        value: players,
      }
    );

    return embed;
  }

  return embed;
}

function buildEmbed(eventItem) {
  if (eventItem.mode === "decide") {
    return buildDecideEmbed(eventItem);
  }

  if (isSpecialEvent(eventItem)) {
    return buildSpecialEmbed(eventItem);
  }

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
  if (eventItem.mode === "decide") {
    return buildDecideButtons();
  }

  if (isSpecialEvent(eventItem)) {
    return buildSpecialButtons();
  }

  return buildStrelaButtons(eventItem);
}

async function updateEventMessage(message, eventItem) {
  await message.edit({
    embeds: [buildEmbed(eventItem)],
    components: buildButtons(eventItem),
  });
}

async function promoteFirstReplacement(eventItem) {
  if (eventItem.replacements.length === 0) return null;

  const promotedUserId = eventItem.replacements.shift();
  eventItem.players.push(promotedUserId);

  try {
    const user = await client.users.fetch(promotedUserId);

    await user.send("ОСНОВНОЙ ИГРОК НЕ СМОЖЕТ - ТЫ ИДЕШЬ НА МЕТКУ");
  } catch (error) {
    console.log(`Не удалось отправить ЛС пользователю ${promotedUserId}`);
  }

  return promotedUserId;
}

async function notifyCreatorAboutFive(eventItem) {
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
}

function scheduleCreatorTwoHourReminder(eventItem) {
  if (eventItem.type !== "strela") return;
  if (eventItem.mode !== "decide") return;
  if (!eventItem.eventDate) return;

  const remindTime = eventItem.eventDate.getTime() - 2 * 60 * 60 * 1000;
  const delay = remindTime - Date.now();

  if (delay <= 0) return;

  setTimeout(async () => {
    if (eventItem.mode !== "decide") return;

    try {
      const user = await client.users.fetch(eventItem.createdById);

      await user.send(
        `До стрелы на сервере **${eventItem.server}** осталось 2 часа.\nПикнувших людей: **${eventItem.picked.length}**.\nЗайди и выбери формат 2/2, 3/3, 4/4 или 5/5.`
      );
    } catch (error) {
      console.log(`Не удалось отправить ЛС создателю ${eventItem.createdById}`);
    }
  }, delay);
}

function cleanChannelName(name) {
  return (
    String(name)
      .replace(/[\\/#]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90) || "временный канал"
  );
}

async function createTemporaryVoiceChannel(eventItem) {
  if (!eventItem.guildId) return;
  if (!eventItem.channelId) return;
  if (eventItem.voiceCreated) return;

  if (!eventItem.limit || eventItem.limit <= 0) {
    console.log("Временный канал не создан: не указан лимит участников.");
    return;
  }

  const msLeft = eventItem.eventDate.getTime() - Date.now();

  if (msLeft > 11 * 60 * 1000) {
    console.log("Временный канал не создан: до события больше 11 минут.");
    return;
  }

  if (msLeft < 0) {
    console.log("Временный канал не создан: событие уже прошло.");
    return;
  }

  eventItem.voiceCreated = true;

  try {
    const guild = await client.guilds.fetch(eventItem.guildId);

    const textChannel = await guild.channels
      .fetch(eventItem.channelId)
      .catch(() => null);

    const channelName = cleanChannelName(
      `${eventItem.timeText || "время"} ${eventItem.server || "стрела"}`
    );

    const parentId = textChannel && textChannel.parentId ? textChannel.parentId : null;

    const existingChannel = guild.channels.cache.find((channel) => {
      return (
        channel.type === ChannelType.GuildVoice &&
        channel.name === channelName &&
        channel.parentId === parentId
      );
    });

    if (existingChannel) {
      eventItem.tempVoiceChannelId = existingChannel.id;
      console.log(`Временный канал уже существует: ${existingChannel.name}`);
      return;
    }

    const voiceChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      userLimit: eventItem.limit,
      parent: parentId,
      reason: "Временный голосовой канал за 10 минут до стрелы",
    });

    eventItem.tempVoiceChannelId = voiceChannel.id;

    setTimeout(async () => {
      try {
        await voiceChannel.delete("Удаление временного канала после стрелы");
      } catch (error) {
        console.log("Не удалось удалить временный голосовой канал.");
      }
    }, 2 * 60 * 60 * 1000);
  } catch (error) {
    console.log("Не удалось создать временный голосовой канал:", error.message);
  }
}

function getAllUsersForReminder(eventItem) {
  if (isSpecialEvent(eventItem)) {
    return [...new Set(eventItem.specialPlayers.map((player) => player.userId))];
  }

  return [
    ...new Set([
      ...eventItem.players,
      ...eventItem.replacements,
      ...eventItem.picked,
    ]),
  ];
}

function scheduleTenMinuteActions(eventItem) {
  if (!eventItem.eventDate) return;

  const remindTime = eventItem.eventDate.getTime() - 10 * 60 * 1000;
  const delay = remindTime - Date.now();

  console.log(
    `Событие ${getEventTitle(eventItem)} на ${eventItem.timeText}. Напоминание через ${Math.round(
      delay / 1000
    )} секунд.`
  );

  if (delay <= 0) {
    console.log(
      "Напоминание не создано: до события меньше 10 минут или событие уже прошло."
    );
    return;
  }

  setTimeout(async () => {
    const msLeft = eventItem.eventDate.getTime() - Date.now();

    if (msLeft > 11 * 60 * 1000) {
      console.log("Напоминание отменено: до события больше 11 минут.");
      return;
    }

    if (msLeft < 0) {
      console.log("Напоминание отменено: событие уже прошло.");
      return;
    }

    const allUsers = getAllUsersForReminder(eventItem);

    for (const userId of allUsers) {
      try {
        const user = await client.users.fetch(userId);

        await user.send(
          `Напоминание: через 10 минут событие.\n\n${getEventTitle(
            eventItem
          )}\nВремя: ${eventItem.timeText || "не указано"}`
        );
      } catch (error) {
        console.log(`Не удалось отправить ЛС пользователю ${userId}`);
      }
    }

    await createTemporaryVoiceChannel(eventItem);
  }, delay);
}

function getPrivateRoom(channelId) {
  return data.privateRooms[channelId] || null;
}

function setPrivateRoom(channel, ownerId) {
  data.privateRooms[channel.id] = {
    ownerId,
    guildId: channel.guild.id,
    createdAt: Date.now(),
  };

  saveData();
}

function deletePrivateRoomData(channelId) {
  if (data.privateRooms[channelId]) {
    delete data.privateRooms[channelId];
    saveData();
  }
}

function findUserPrivateRoom(guild, userId) {
  const entry = Object.entries(data.privateRooms).find(([, room]) => {
    return room.guildId === guild.id && room.ownerId === userId;
  });

  if (!entry) return null;

  return guild.channels.cache.get(entry[0]) || null;
}

function getUserCurrentPrivateRoom(member) {
  const channel = member.voice.channel;

  if (!channel) return null;

  const room = getPrivateRoom(channel.id);

  if (!room) return null;

  return {
    channel,
    room,
  };
}

function isPrivateRoomOwner(member) {
  const current = getUserCurrentPrivateRoom(member);

  if (!current) return false;

  return current.room.ownerId === member.id || hasAdmin(member);
}

function buildPrivateRoomsEmbed() {
  return new EmbedBuilder()
    .setTitle("⚙️ Приватные комнаты")
    .setColor(0x00b7ff)
    .setDescription(
      [
        "Измените конфигурацию вашей комнаты с помощью панели управления.",
        "",
        "👑 — назначить нового создателя комнаты",
        "🔒 — ограничить / выдать доступ к комнате",
        "👥 — задать новый лимит участников",
        "🔐 — закрыть / открыть комнату",
        "✏️ — изменить название комнаты",
        "👁️ — скрыть / открыть комнату",
        "➡️ — выгнать участника из комнаты",
        "🎙️ — ограничить / выдать право говорить",
      ].join("\n")
    )
    .setFooter({
      text: "Приватные комнаты",
    })
    .setTimestamp();
}

function buildPrivateRoomsComponents() {
  const select = new StringSelectMenuBuilder()
    .setCustomId("private_action")
    .setPlaceholder("Выбрать активность")
    .addOptions(
      {
        label: "Создать приватную комнату",
        value: "create",
        emoji: "➕",
      },
      {
        label: "Назначить нового создателя",
        value: "transfer",
        emoji: "👑",
      },
      {
        label: "Ограничить / выдать доступ",
        value: "lock",
        emoji: "🔒",
      },
      {
        label: "Задать лимит участников",
        value: "limit",
        emoji: "👥",
      },
      {
        label: "Закрыть / открыть комнату",
        value: "close",
        emoji: "🔐",
      },
      {
        label: "Изменить название",
        value: "rename",
        emoji: "✏️",
      },
      {
        label: "Скрыть / открыть комнату",
        value: "hide",
        emoji: "👁️",
      },
      {
        label: "Выгнать участника",
        value: "kick",
        emoji: "➡️",
      },
      {
        label: "Ограничить / выдать право говорить",
        value: "speak",
        emoji: "🎙️",
      }
    );

  return [
    new ActionRowBuilder().addComponents(select),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("private_transfer")
        .setEmoji("👑")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("private_lock")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("private_limit")
        .setEmoji("👥")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("private_close")
        .setEmoji("🔐")
        .setStyle(ButtonStyle.Secondary)
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("private_rename")
        .setEmoji("✏️")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("private_hide")
        .setEmoji("👁️")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("private_kick")
        .setEmoji("➡️")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("private_speak")
        .setEmoji("🎙️")
        .setStyle(ButtonStyle.Secondary)
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("private_create")
        .setLabel("Создать канал")
        .setStyle(ButtonStyle.Success)
    ),
  ];
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
      {
        name: "Сервер",
        value: eventItem.server,
        inline: true,
      },
      {
        name: "Количество людей",
        value: `${eventItem.limit}`,
        inline: true,
      },
      {
        name: "Карта",
        value: eventItem.map,
        inline: true,
      },
      {
        name: "Оружие",
        value: eventItem.weapon,
        inline: true,
      },
      {
        name: "Время",
        value: eventItem.timeText,
        inline: true,
      },
      {
        name: "Основные слоты",
        value: mainPlayers,
      },
      {
        name: "Замена",
        value: replaces,
      }
    )
    .setFooter({
      text: `Создал: ${eventItem.createdByTag}`,
    });
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
    .setFooter({
      text: `Создал: ${eventItem.createdByTag}`,
    });

  if (eventItem.type === "fw") {
    embed.addFields(
      {
        name: "Время",
        value: eventItem.timeText,
        inline: true,
      },
      {
        name: "Против кого",
        value: eventItem.against,
        inline: true,
      },
      {
        name: "Пикнувшие слоты",
        value: players,
      }
    );

    return embed;
  }

  if (eventItem.type === "neft" || eventItem.type === "priton") {
    embed.addFields(
      {
        name: "Организации",
        value: eventItem.organizations,
        inline: true,
      },
      {
        name: "Сервер",
        value: eventItem.server,
        inline: true,
      },
      {
        name: "Пикнувшие слоты",
        value: players,
      }
    );

    return embed;
  }

  return embed;
}

function buildEmbed(eventItem) {
  if (eventItem.mode === "decide") {
    return buildDecideEmbed(eventItem);
  }

  if (isSpecialEvent(eventItem)) {
    return buildSpecialEmbed(eventItem);
  }

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
  if (eventItem.mode === "decide") {
    return buildDecideButtons();
  }

  if (isSpecialEvent(eventItem)) {
    return buildSpecialButtons();
  }

  return buildStrelaButtons(eventItem);
}

async function updateEventMessage(message, eventItem) {
  await message.edit({
    embeds: [buildEmbed(eventItem)],
    components: buildButtons(eventItem),
  });
}

async function promoteFirstReplacement(eventItem) {
  if (eventItem.replacements.length === 0) return null;

  const promotedUserId = eventItem.replacements.shift();
  eventItem.players.push(promotedUserId);

  try {
    const user = await client.users.fetch(promotedUserId);

    await user.send("ОСНОВНОЙ ИГРОК НЕ СМОЖЕТ - ТЫ ИДЕШЬ НА МЕТКУ");
  } catch (error) {
    console.log(`Не удалось отправить ЛС пользователю ${promotedUserId}`);
  }

  return promotedUserId;
}

async function notifyCreatorAboutFive(eventItem) {
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
}

function scheduleCreatorTwoHourReminder(eventItem) {
  if (eventItem.type !== "strela") return;
  if (eventItem.mode !== "decide") return;
  if (!eventItem.eventDate) return;

  const remindTime = eventItem.eventDate.getTime() - 2 * 60 * 60 * 1000;
  const delay = remindTime - Date.now();

  if (delay <= 0) return;

  setTimeout(async () => {
    if (eventItem.mode !== "decide") return;

    try {
      const user = await client.users.fetch(eventItem.createdById);

      await user.send(
        `До стрелы на сервере **${eventItem.server}** осталось 2 часа.\nПикнувших людей: **${eventItem.picked.length}**.\nЗайди и выбери формат 2/2, 3/3, 4/4 или 5/5.`
      );
    } catch (error) {
      console.log(`Не удалось отправить ЛС создателю ${eventItem.createdById}`);
    }
  }, delay);
}

function cleanChannelName(name) {
  return (
    String(name)
      .replace(/[\\/#]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90) || "временный канал"
  );
}

async function createTemporaryVoiceChannel(eventItem) {
  if (!eventItem.guildId) return;
  if (!eventItem.channelId) return;
  if (eventItem.voiceCreated) return;

  if (!eventItem.limit || eventItem.limit <= 0) {
    console.log("Временный канал не создан: не указан лимит участников.");
    return;
  }

  const msLeft = eventItem.eventDate.getTime() - Date.now();

  if (msLeft > 11 * 60 * 1000) {
    console.log("Временный канал не создан: до события больше 11 минут.");
    return;
  }

  if (msLeft < 0) {
    console.log("Временный канал не создан: событие уже прошло.");
    return;
  }

  eventItem.voiceCreated = true;

  try {
    const guild = await client.guilds.fetch(eventItem.guildId);

    const textChannel = await guild.channels
      .fetch(eventItem.channelId)
      .catch(() => null);

    const channelName = cleanChannelName(
      `${eventItem.timeText || "время"} ${eventItem.server || "стрела"}`
    );

    const parentId = textChannel && textChannel.parentId ? textChannel.parentId : null;

    const existingChannel = guild.channels.cache.find((channel) => {
      return (
        channel.type === ChannelType.GuildVoice &&
        channel.name === channelName &&
        channel.parentId === parentId
      );
    });

    if (existingChannel) {
      eventItem.tempVoiceChannelId = existingChannel.id;
      console.log(`Временный канал уже существует: ${existingChannel.name}`);
      return;
    }

    const voiceChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      userLimit: eventItem.limit,
      parent: parentId,
      reason: "Временный голосовой канал за 10 минут до стрелы",
    });

    eventItem.tempVoiceChannelId = voiceChannel.id;

    setTimeout(async () => {
      try {
        await voiceChannel.delete("Удаление временного канала после стрелы");
      } catch (error) {
        console.log("Не удалось удалить временный голосовой канал.");
      }
    }, 2 * 60 * 60 * 1000);
  } catch (error) {
    console.log("Не удалось создать временный голосовой канал:", error.message);
  }
}

function getAllUsersForReminder(eventItem) {
  if (isSpecialEvent(eventItem)) {
    return [...new Set(eventItem.specialPlayers.map((player) => player.userId))];
  }

  return [
    ...new Set([
      ...eventItem.players,
      ...eventItem.replacements,
      ...eventItem.picked,
    ]),
  ];
}

function scheduleTenMinuteActions(eventItem) {
  if (!eventItem.eventDate) return;

  const remindTime = eventItem.eventDate.getTime() - 10 * 60 * 1000;
  const delay = remindTime - Date.now();

  console.log(
    `Событие ${getEventTitle(eventItem)} на ${eventItem.timeText}. Напоминание через ${Math.round(
      delay / 1000
    )} секунд.`
  );

  if (delay <= 0) {
    console.log(
      "Напоминание не создано: до события меньше 10 минут или событие уже прошло."
    );
    return;
  }

  setTimeout(async () => {
    const msLeft = eventItem.eventDate.getTime() - Date.now();

    if (msLeft > 11 * 60 * 1000) {
      console.log("Напоминание отменено: до события больше 11 минут.");
      return;
    }

    if (msLeft < 0) {
      console.log("Напоминание отменено: событие уже прошло.");
      return;
    }

    const allUsers = getAllUsersForReminder(eventItem);

    for (const userId of allUsers) {
      try {
        const user = await client.users.fetch(userId);

        await user.send(
          `Напоминание: через 10 минут событие.\n\n${getEventTitle(
            eventItem
          )}\nВремя: ${eventItem.timeText || "не указано"}`
        );
      } catch (error) {
        console.log(`Не удалось отправить ЛС пользователю ${userId}`);
      }
    }

    await createTemporaryVoiceChannel(eventItem);
  }, delay);
}

function getPrivateRoom(channelId) {
  return data.privateRooms[channelId] || null;
}

function setPrivateRoom(channel, ownerId) {
  data.privateRooms[channel.id] = {
    ownerId,
    guildId: channel.guild.id,
    createdAt: Date.now(),
  };

  saveData();
}

function deletePrivateRoomData(channelId) {
  if (data.privateRooms[channelId]) {
    delete data.privateRooms[channelId];
    saveData();
  }
}

function findUserPrivateRoom(guild, userId) {
  const entry = Object.entries(data.privateRooms).find(([, room]) => {
    return room.guildId === guild.id && room.ownerId === userId;
  });

  if (!entry) return null;

  return guild.channels.cache.get(entry[0]) || null;
}

function getUserCurrentPrivateRoom(member) {
  const channel = member.voice.channel;

  if (!channel) return null;

  const room = getPrivateRoom(channel.id);

  if (!room) return null;

  return {
    channel,
    room,
  };
}

function isPrivateRoomOwner(member) {
  const current = getUserCurrentPrivateRoom(member);

  if (!current) return false;

  return current.room.ownerId === member.id || hasAdmin(member);
}

function buildPrivateRoomsEmbed() {
  return new EmbedBuilder()
    .setTitle("⚙️ Приватные комнаты")
    .setColor(0x00b7ff)
    .setDescription(
      [
        "Измените конфигурацию вашей комнаты с помощью панели управления.",
        "",
        "👑 — назначить нового создателя комнаты",
        "🔒 — ограничить / выдать доступ к комнате",
        "👥 — задать новый лимит участников",
        "🔐 — закрыть / открыть комнату",
        "✏️ — изменить название комнаты",
        "👁️ — скрыть / открыть комнату",
        "➡️ — выгнать участника из комнаты",
        "🎙️ — ограничить / выдать право говорить",
      ].join("\n")
    )
    .setFooter({
      text: "Приватные комнаты",
    })
    .setTimestamp();
}

function buildPrivateRoomsComponents() {
  const select = new StringSelectMenuBuilder()
    .setCustomId("private_action")
    .setPlaceholder("Выбрать активность")
    .addOptions(
      {
        label: "Создать приватную комнату",
        value: "create",
        emoji: "➕",
      },
      {
        label: "Назначить нового создателя",
        value: "transfer",
        emoji: "👑",
      },
      {
        label: "Ограничить / выдать доступ",
        value: "lock",
        emoji: "🔒",
      },
      {
        label: "Задать лимит участников",
        value: "limit",
        emoji: "👥",
      },
      {
        label: "Закрыть / открыть комнату",
        value: "close",
        emoji: "🔐",
      },
      {
        label: "Изменить название",
        value: "rename",
        emoji: "✏️",
      },
      {
        label: "Скрыть / открыть комнату",
        value: "hide",
        emoji: "👁️",
      },
      {
        label: "Выгнать участника",
        value: "kick",
        emoji: "➡️",
      },
      {
        label: "Ограничить / выдать право говорить",
        value: "speak",
        emoji: "🎙️",
      }
    );

  return [
    new ActionRowBuilder().addComponents(select),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("private_transfer")
        .setEmoji("👑")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("private_lock")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("private_limit")
        .setEmoji("👥")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("private_close")
        .setEmoji("🔐")
        .setStyle(ButtonStyle.Secondary)
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("private_rename")
        .setEmoji("✏️")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("private_hide")
        .setEmoji("👁️")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("private_kick")
        .setEmoji("➡️")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("private_speak")
        .setEmoji("🎙️")
        .setStyle(ButtonStyle.Secondary)
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("private_create")
        .setLabel("Создать канал")
        .setStyle(ButtonStyle.Success)
    ),
  ];
}