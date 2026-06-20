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

// Время стрелы считается по UTC+3.
// Если нужно поменять, добавь в .env:
// EVENT_TIMEZONE_OFFSET_MINUTES=180
const EVENT_TIMEZONE_OFFSET_MINUTES = Number(
  process.env.EVENT_TIMEZONE_OFFSET_MINUTES || 180
);

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

client.once("ready", async () => {
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
  return data.antiDeleteChannels[getChannelKey(guildId, channelId)] === true;
}

function setAntiDelete(guildId, channelId, value) {
  data.antiDeleteChannels[getChannelKey(guildId, channelId)] = value;
  saveData();
}

function getField(text, fieldName) {
  const regex = new RegExp(`${fieldName}\\s*:\\s*(.+)`, "i");
  const match = text.match(regex);

  if (!match) return null;

  return match[1].trim();
}

function parseEventTime(timeText) {
  const match = String(timeText).match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  const nowUtc = new Date();

  const nowInEventTimezone = new Date(
    nowUtc.getTime() + EVENT_TIMEZONE_OFFSET_MINUTES * 60 * 1000
  );

  const year = nowInEventTimezone.getUTCFullYear();
  const month = nowInEventTimezone.getUTCMonth();
  const day = nowInEventTimezone.getUTCDate();

  let eventUtcMs =
    Date.UTC(year, month, day, hours, minutes, 0, 0) -
    EVENT_TIMEZONE_OFFSET_MINUTES * 60 * 1000;

  if (eventUtcMs <= Date.now()) {
    eventUtcMs += 24 * 60 * 60 * 1000;
  }

  return new Date(eventUtcMs);
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
        value:
          "Создатель слотов должен выбрать формат: 2/2, 3/3, 4/4 или 5/5.",
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

  const replacements =
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
        value: replacements,
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
  if (eventItem.replacements.length === 0) {
    return null;
  }

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
        `До стрелы на сервере **${eventItem.server}** осталось 2 часа.\nПикнувших людей: **${eventItem.picked.length}**.\nЗайди и выбери формат 2/2, 3/3, 4/4 или 5/5, чтобы закрыть пик слотов.`
      );
    } catch (error) {
      console.log(`Не удалось отправить ЛС создателю ${eventItem.createdById}`);
    }
  }, delay);
}

async function createTemporaryVoiceChannel(eventItem) {
  if (eventItem.type !== "strela") return;
  if (!eventItem.guildId) return;
  if (!eventItem.channelId) return;
  if (!eventItem.limit) return;
  if (eventItem.voiceCreated) return;

  eventItem.voiceCreated = true;

  try {
    const guild = await client.guilds.fetch(eventItem.guildId);
    const textChannel = await guild.channels
      .fetch(eventItem.channelId)
      .catch(() => null);

    const serverPart = eventItem.server || "server";
    const timePart = eventItem.timeText || "time";

    const channelName = `${timePart} ${serverPart}`.slice(0, 90);

    const voiceChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      userLimit: eventItem.limit,
      parent: textChannel && textChannel.parentId ? textChannel.parentId : null,
      reason: "Временный голосовой канал за 10 минут до стрелы",
    });

    console.log(
      `Создан временный голосовой канал ${channelName} с лимитом ${eventItem.limit}`
    );

    setTimeout(async () => {
      try {
        await voiceChannel.delete("Удаление временного канала после стрелы");
      } catch (error) {
        console.log("Не удалось удалить временный голосовой канал");
      }
    }, 2 * 60 * 60 * 1000);
  } catch (error) {
    console.log("Не удалось создать временный голосовой канал:", error);
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

  let delay = remindTime - Date.now();

  if (eventItem.eventDate.getTime() <= Date.now()) {
    return;
  }

  if (delay < 0) {
    delay = 1000;
  }

  setTimeout(async () => {
    const allUsers = getAllUsersForReminder(eventItem);

    for (const userId of allUsers) {
      try {
        const user = await client.users.fetch(userId);

        await user.send(
          `Напоминание: через 10 минут событие.\n\n${getEventTitle(eventItem)}\nВремя: ${eventItem.timeText || "не указано"}`
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
  if (!data.privateRooms[channelId]) return;

  delete data.privateRooms[channelId];
  saveData();
}

function findUserPrivateRoom(guild, userId) {
  const found = Object.entries(data.privateRooms).find(([, room]) => {
    return room.guildId === guild.id && room.ownerId === userId;
  });

  if (!found) return null;

  return guild.channels.cache.get(found[0]) || null;
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

  const rowSelect = new ActionRowBuilder().addComponents(select);

  const row1 = new ActionRowBuilder().addComponents(
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
  );

  const row2 = new ActionRowBuilder().addComponents(
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
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("private_create")
      .setLabel("Создать канал")
      .setStyle(ButtonStyle.Success)
  );

  return [rowSelect, row1, row2, row3];
}

async function sendPrivateRoomsPanel(interaction) {
  await interaction.channel.send({
    embeds: [buildPrivateRoomsEmbed()],
    components: buildPrivateRoomsComponents(),
  });

  return interaction.reply({
    content: "Панель приватных комнат создана.",
    ephemeral: true,
  });
}

async function createPrivateVoiceRoom(interaction) {
  const member = interaction.member;

  const existingRoom = findUserPrivateRoom(interaction.guild, member.id);

  if (existingRoom) {
    return interaction.reply({
      content: `У тебя уже есть приватная комната: <#${existingRoom.id}>.`,
      ephemeral: true,
    });
  }

  const parentId = interaction.channel.parentId || null;

  const safeName =
    member.displayName.replace(/[\\/#]/g, "").slice(0, 20) || "user";

  const voiceChannel = await interaction.guild.channels.create({
    name: `🔊・${safeName}`,
    type: ChannelType.GuildVoice,
    parent: parentId,
    userLimit: 0,
    permissionOverwrites: [
      {
        id: interaction.guild.roles.everyone.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.Speak,
        ],
      },
      {
        id: member.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.Speak,
          PermissionsBitField.Flags.MoveMembers,
          PermissionsBitField.Flags.ManageChannels,
        ],
      },
    ],
    reason: "Создание приватной комнаты",
  });

  setPrivateRoom(voiceChannel, member.id);

  if (member.voice.channel) {
    await member.voice.setChannel(voiceChannel).catch(() => null);
  }

  return interaction.reply({
    content: `Приватная комната создана: <#${voiceChannel.id}>.`,
    ephemeral: true,
  });
}

async function ensureRoomOwnerReply(interaction) {
  if (isPrivateRoomOwner(interaction.member)) return true;

  await interaction.reply({
    content:
      "Ты должен находиться в своей приватной комнате. Управлять комнатой может только её создатель или администратор.",
    ephemeral: true,
  });

  return false;
}

function createTextModal(customId, title, inputId, label, placeholder) {
  const input = new TextInputBuilder()
    .setCustomId(inputId)
    .setLabel(label)
    .setPlaceholder(placeholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function toggleRoomConnect(interaction) {
  if (!(await ensureRoomOwnerReply(interaction))) return;

  const { channel } = getUserCurrentPrivateRoom(interaction.member);
  const everyoneId = interaction.guild.roles.everyone.id;
  const overwrite = channel.permissionOverwrites.cache.get(everyoneId);

  const isClosed =
    overwrite && overwrite.deny.has(PermissionsBitField.Flags.Connect);

  await channel.permissionOverwrites.edit(everyoneId, {
    Connect: isClosed ? null : false,
  });

  return interaction.reply({
    content: isClosed
      ? "Комната открыта для входа."
      : "Комната закрыта для входа.",
    ephemeral: true,
  });
}

async function toggleRoomView(interaction) {
  if (!(await ensureRoomOwnerReply(interaction))) return;

  const { channel } = getUserCurrentPrivateRoom(interaction.member);
  const everyoneId = interaction.guild.roles.everyone.id;
  const overwrite = channel.permissionOverwrites.cache.get(everyoneId);

  const isHidden =
    overwrite && overwrite.deny.has(PermissionsBitField.Flags.ViewChannel);

  await channel.permissionOverwrites.edit(everyoneId, {
    ViewChannel: isHidden ? null : false,
  });

  return interaction.reply({
    content: isHidden ? "Комната снова видна." : "Комната скрыта.",
    ephemeral: true,
  });
}

async function toggleRoomSpeak(interaction) {
  if (!(await ensureRoomOwnerReply(interaction))) return;

  const { channel } = getUserCurrentPrivateRoom(interaction.member);
  const everyoneId = interaction.guild.roles.everyone.id;
  const overwrite = channel.permissionOverwrites.cache.get(everyoneId);

  const isMuted =
    overwrite && overwrite.deny.has(PermissionsBitField.Flags.Speak);

  await channel.permissionOverwrites.edit(everyoneId, {
    Speak: isMuted ? null : false,
  });

  return interaction.reply({
    content: isMuted
      ? "Право говорить выдано обратно."
      : "Право говорить ограничено.",
    ephemeral: true,
  });
}

async function handlePrivateAction(interaction, action) {
  if (action === "create") {
    return createPrivateVoiceRoom(interaction);
  }

  if (action === "lock" || action === "close") {
    return toggleRoomConnect(interaction);
  }

  if (action === "hide") {
    return toggleRoomView(interaction);
  }

  if (action === "speak") {
    return toggleRoomSpeak(interaction);
  }

  if (!(await ensureRoomOwnerReply(interaction))) return;

  if (action === "limit") {
    return interaction.showModal(
      createTextModal(
        "private_limit_modal",
        "Лимит участников",
        "limit",
        "Новый лимит",
        "Например: 5. Для безлимита: 0"
      )
    );
  }

  if (action === "rename") {
    return interaction.showModal(
      createTextModal(
        "private_rename_modal",
        "Название комнаты",
        "name",
        "Новое название",
        "Например: Комната мафии"
      )
    );
  }

  if (action === "transfer") {
    return interaction.showModal(
      createTextModal(
        "private_transfer_modal",
        "Новый создатель",
        "user",
        "ID или упоминание пользователя",
        "Например: 123456789012345678"
      )
    );
  }

  if (action === "kick") {
    return interaction.showModal(
      createTextModal(
        "private_kick_modal",
        "Выгнать участника",
        "user",
        "ID или упоминание пользователя",
        "Например: 123456789012345678"
      )
    );
  }
}

function parseUserId(text) {
  const match = String(text).match(/\d{15,25}/);
  return match ? match[0] : null;
}

async function handlePrivateRoomModal(interaction) {
  if (!(await ensureRoomOwnerReply(interaction))) return;

  const { channel } = getUserCurrentPrivateRoom(interaction.member);

  if (interaction.customId === "private_limit_modal") {
    const limit = Number(interaction.fields.getTextInputValue("limit"));

    if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
      return interaction.reply({
        content: "Лимит должен быть числом от 0 до 99. 0 = без лимита.",
        ephemeral: true,
      });
    }

    await channel.setUserLimit(limit);

    return interaction.reply({
      content:
        limit === 0
          ? "Лимит комнаты убран."
          : `Лимит комнаты установлен: ${limit}.`,
      ephemeral: true,
    });
  }

  if (interaction.customId === "private_rename_modal") {
    const name = interaction.fields
      .getTextInputValue("name")
      .trim()
      .slice(0, 90);

    if (!name) {
      return interaction.reply({
        content: "Название не может быть пустым.",
        ephemeral: true,
      });
    }

    await channel.setName(name, "Изменение названия приватной комнаты");

    return interaction.reply({
      content: `Название изменено на **${name}**.`,
      ephemeral: true,
    });
  }

  if (interaction.customId === "private_transfer_modal") {
    const userId = parseUserId(interaction.fields.getTextInputValue("user"));

    if (!userId) {
      return interaction.reply({
        content: "Я не смог найти ID пользователя.",
        ephemeral: true,
      });
    }

    const member = await interaction.guild.members
      .fetch(userId)
      .catch(() => null);

    if (!member) {
      return interaction.reply({
        content: "Такого пользователя нет на сервере.",
        ephemeral: true,
      });
    }

    data.privateRooms[channel.id].ownerId = member.id;
    saveData();

    await channel.permissionOverwrites.edit(member.id, {
      ViewChannel: true,
      Connect: true,
      Speak: true,
      MoveMembers: true,
      ManageChannels: true,
    });

    return interaction.reply({
      content: `<@${member.id}> теперь создатель комнаты.`,
      ephemeral: true,
    });
  }

  if (interaction.customId === "private_kick_modal") {
    const userId = parseUserId(interaction.fields.getTextInputValue("user"));

    if (!userId) {
      return interaction.reply({
        content: "Я не смог найти ID пользователя.",
        ephemeral: true,
      });
    }

    const member = await interaction.guild.members
      .fetch(userId)
      .catch(() => null);

    if (!member || !member.voice.channel || member.voice.channel.id !== channel.id) {
      return interaction.reply({
        content: "Этот пользователь сейчас не находится в твоей комнате.",
        ephemeral: true,
      });
    }

    await member.voice
      .disconnect("Выгнан создателем приватной комнаты")
      .catch(() => null);

    return interaction.reply({
      content: `<@${member.id}> выгнан из комнаты.`,
      ephemeral: true,
    });
  }
}

async function sendHelp(message) {
  return message.reply(
    [
      "**Команды бота:**",
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
      "Создатель выбирает формат 2/2, 3/3, 4/4 или 5/5.",
      "```text",
      "!strela 2",
      "Сервер: Gilbert",
      "Карта: SF",
      "Оружие: AK-47",
      "Время: 21:30",
      "```",
      "",
      "**/fw** — пик слотов на ФВ. Поля: `time`, `against`.",
      "**/neft** — пик слотов на нефтевышки. Поля: `organizations`, `server`.",
      "**/priton** — пик слотов на притон. Поля: `organizations`, `server`.",
      "**/rooms** — создать панель приватных голосовых комнат.",
      "",
      "Для `/fw`, `/neft`, `/priton` кнопки:",
      "`ПИКНУТЬ СЛОТ (БЕЗ СЕТА)`",
      "`ПИКНУТЬ СЛОТ (С СЕТОМ)`",
      "`СЕТ ОПЛАЧЕН`",
      "",
      "**/redakt** — редактировать состав созданной тобой метки/вышки/ФВ/притона.",
      "Действия: `add_main`, `add_replace`, `add_no_set`, `add_with_set`, `set_paid`, `remove`.",
      "",
      "**!limit число** — изменить лимит в обычной стреле. Нужно ответить на сообщение бота.",
      "**/ch** — добавить игрока в ЧС сервера.",
      "**/unch** — убрать игрока из ЧС сервера.",
      "**/antidel** — включить/выключить автоудаление сообщений в канале.",
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
  const eventItem = events.get(targetMessageId);

  if (!eventItem) {
    return message.reply("Не нашёл активные слоты в этом сообщении.");
  }

  if (eventItem.mode === "decide") {
    return message.reply(
      "В режиме `!strela 2` количество выбирается кнопками 2/2, 3/3, 4/4 или 5/5."
    );
  }

  if (isSpecialEvent(eventItem)) {
    return message.reply(
      "Для `/fw`, `/neft`, `/priton` лимита нет, там не нужна команда `!limit`."
    );
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

async function handleCreateStrela(message) {
  if (!hasDeputyOrHigher(message.member)) {
    return message.reply("Запускать слоты может только роль deputy или выше.");
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
        "Неправильная форма. Используй так:\n\n```text\n!strela 2\nСервер: Gilbert\nКарта: SF\nОружие: AK-47\nВремя: 21:30\n```"
      );
    }

    const eventDate = parseEventTime(timeText);

    if (!eventDate) {
      return message.reply("Время должно быть в формате `21:30`.");
    }

    await message.delete().catch(() => {});

    const eventItem = {
      type: "strela",
      mode: "decide",
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
      voiceCreated: false,
    };

    const sentMessage = await message.channel.send({
      embeds: [buildEmbed(eventItem)],
      components: buildButtons(eventItem),
    });

    events.set(sentMessage.id, eventItem);

    setAntiDelete(message.guild.id, message.channel.id, true);
    scheduleCreatorTwoHourReminder(eventItem);
    scheduleTenMinuteActions(eventItem);

    return;
  }

  if (!server || !limitText || !map || !weapon || !timeText) {
    return message.reply(
      "Неправильная форма. Используй так:\n\n```text\n!strela\nСервер: Gilbert\nКоличество людей: 5\nКарта: SF\nОружие: AK-47\nВремя: 21:30\n```"
    );
  }

  const limit = Number(limitText);
  const eventDate = parseEventTime(timeText);

  if (!Number.isInteger(limit) || limit <= 0) {
    return message.reply("Количество людей должно быть числом. Например: `5`");
  }

  if (!eventDate) {
    return message.reply("Время должно быть в формате `21:30`.");
  }

  await message.delete().catch(() => {});

  const eventItem = {
    type: "strela",
    mode: "normal",
    server,
    limit,
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
    voiceCreated: false,
  };

  const sentMessage = await message.channel.send({
    embeds: [buildEmbed(eventItem)],
    components: buildButtons(eventItem),
  });

  events.set(sentMessage.id, eventItem);

  setAntiDelete(message.guild.id, message.channel.id, true);
  scheduleTenMinuteActions(eventItem);
}

async function createSlashSlotEvent(interaction, eventItem) {
  if (!hasDeputyOrHigher(interaction.member)) {
    return interaction.reply({
      content: "Создавать слоты может только роль deputy или выше.",
      ephemeral: true,
    });
  }

  const sentMessage = await interaction.channel.send({
    embeds: [buildEmbed(eventItem)],
    components: buildButtons(eventItem),
  });

  events.set(sentMessage.id, eventItem);

  setAntiDelete(interaction.guild.id, interaction.channel.id, true);
  scheduleTenMinuteActions(eventItem);

  return interaction.reply({
    content: "Слоты созданы.",
    ephemeral: true,
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
    const eventItem = events.get(messageId);

    if (!eventItem) return null;

    return {
      messageId,
      eventItem,
    };
  }

  const allEvents = Array.from(events.entries()).reverse();

  const found = allEvents.find(([, eventItem]) => {
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
  const action = interaction.options.getString("action");
  const user = interaction.options.getUser("user");
  const messageId = interaction.options.getString("message_id");

  const found = findEditableEvent(interaction, messageId);

  if (!found) {
    return interaction.reply({
      content:
        "Не нашёл твою активную метку в этом канале. Попробуй указать `message_id` сообщения бота.",
      ephemeral: true,
    });
  }

  const { eventItem } = found;

  if (eventItem.createdById !== interaction.user.id) {
    return interaction.reply({
      content:
        "Редактировать состав может только человек, который создал эти слоты.",
      ephemeral: true,
    });
  }

  if (action === "remove") {
    removeUserFromEvent(eventItem, user.id);
  } else if (eventItem.mode === "decide") {
    if (action !== "add_main") {
      return interaction.reply({
        content:
          "Для `!strela 2` до выбора формата можно использовать только `add_main` или `remove`.",
        ephemeral: true,
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
      return interaction.reply({
        content:
          "Для `/fw`, `/neft`, `/priton` используй `add_no_set`, `add_with_set`, `set_paid` или `remove`.",
        ephemeral: true,
      });
    }
  } else {
    if (action === "add_main") {
      if (eventItem.players.includes(user.id)) {
        return interaction.reply({
          content: "Этот игрок уже в основе.",
          ephemeral: true,
        });
      }

      if (eventItem.players.length >= eventItem.limit) {
        return interaction.reply({
          content: "Основа уже заполнена. Сначала убери кого-то или измени лимит.",
          ephemeral: true,
        });
      }

      eventItem.replacements = eventItem.replacements.filter(
        (id) => id !== user.id
      );

      eventItem.players.push(user.id);
    } else if (action === "add_replace") {
      if (eventItem.replacements.includes(user.id)) {
        return interaction.reply({
          content: "Этот игрок уже в замене.",
          ephemeral: true,
        });
      }

      eventItem.players = eventItem.players.filter((id) => id !== user.id);
      eventItem.replacements.push(user.id);
    } else {
      return interaction.reply({
        content:
          "Для обычной стрелы используй `add_main`, `add_replace` или `remove`.",
        ephemeral: true,
      });
    }
  }

  const targetMessage = await interaction.channel.messages
    .fetch(found.messageId)
    .catch(() => null);

  if (!targetMessage) {
    return interaction.reply({
      content:
        "Состав изменён в памяти бота, но я не смог найти сообщение для обновления.",
      ephemeral: true,
    });
  }

  await updateEventMessage(targetMessage, eventItem);

  return interaction.reply({
    content: `Состав обновлён для <@${user.id}>.`,
    ephemeral: true,
  });
}

client.on("messageCreate", async (message) => {
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
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "rooms") {
      if (!hasDeputyOrHigher(interaction.member)) {
        return interaction.reply({
          content: "Создать панель приватных комнат может только роль deputy или выше.",
          ephemeral: true,
        });
      }

      return sendPrivateRoomsPanel(interaction);
    }

    if (interaction.commandName === "redakt") {
      return handleRedaktCommand(interaction);
    }

    if (interaction.commandName === "ch") {
      if (
        !interaction.memberPermissions.has(
          PermissionsBitField.Flags.Administrator
        )
      ) {
        return interaction.reply({
          content: "Добавлять в ЧС может только администратор.",
          ephemeral: true,
        });
      }

      const server = interaction.options.getString("server");
      const user = interaction.options.getUser("user");

      addToBlacklist(server, user.id);

      return interaction.reply({
        content: `<@${user.id}> добавлен в ЧС сервера **${server}**.`,
        ephemeral: true,
      });
    }

    if (interaction.commandName === "unch") {
      if (
        !interaction.memberPermissions.has(
          PermissionsBitField.Flags.Administrator
        )
      ) {
        return interaction.reply({
          content: "Убирать из ЧС может только администратор.",
          ephemeral: true,
        });
      }

      const server = interaction.options.getString("server");
      const user = interaction.options.getUser("user");

      removeFromBlacklist(server, user.id);

      return interaction.reply({
        content: `<@${user.id}> убран из ЧС сервера **${server}**.`,
        ephemeral: true,
      });
    }

    if (interaction.commandName === "antidel") {
      if (
        !interaction.memberPermissions.has(
          PermissionsBitField.Flags.Administrator
        )
      ) {
        return interaction.reply({
          content: "Команда /antidel доступна только администраторам.",
          ephemeral: true,
        });
      }

      const current = isAntiDeleteEnabled(
        interaction.guild.id,
        interaction.channel.id
      );

      setAntiDelete(interaction.guild.id, interaction.channel.id, !current);

      return interaction.reply({
        content: !current
          ? "Автоудаление сообщений в этом канале включено."
          : "Автоудаление сообщений в этом канале выключено.",
        ephemeral: true,
      });
    }

    if (interaction.commandName === "fw") {
      const timeText = interaction.options.getString("time");
      const against = interaction.options.getString("against");
      const eventDate = parseEventTime(timeText);

      if (!eventDate) {
        return interaction.reply({
          content: "Время должно быть в формате `21:30`.",
          ephemeral: true,
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
        voiceCreated: false,
      };

      return createSlashSlotEvent(interaction, eventItem);
    }

    if (interaction.commandName === "neft") {
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
        voiceCreated: false,
      };

      return createSlashSlotEvent(interaction, eventItem);
    }

    if (interaction.commandName === "priton") {
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
        voiceCreated: false,
      };

      return createSlashSlotEvent(interaction, eventItem);
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("private_")) {
      return handlePrivateRoomModal(interaction);
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "private_action") {
      return handlePrivateAction(interaction, interaction.values[0]);
    }
  }

  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith("private_")) {
    const action = interaction.customId.replace("private_", "");
    return handlePrivateAction(interaction, action);
  }

  const eventItem = events.get(interaction.message.id);

  if (!eventItem) {
    return interaction.reply({
      content: "Эта запись уже неактивна.",
      ephemeral: true,
    });
  }

  const userId = interaction.user.id;

  if (eventItem.server && isBlacklisted(eventItem.server, userId)) {
    return interaction.reply({
      content: `Ты находишься в ЧС сервера **${eventItem.server}** и не можешь пикать эти слоты.`,
      ephemeral: true,
    });
  }

  if (interaction.customId === "special_no_set") {
    setSpecialPlayerStatus(eventItem, userId, "без сета");

    await updateEventMessage(interaction.message, eventItem);

    return interaction.reply({
      content: "Ты пикнул слот без сета.",
      ephemeral: true,
    });
  }

  if (interaction.customId === "special_with_set") {
    setSpecialPlayerStatus(eventItem, userId, "с сетом");

    await updateEventMessage(interaction.message, eventItem);

    return interaction.reply({
      content: "Ты пикнул слот с сетом.",
      ephemeral: true,
    });
  }

  if (interaction.customId === "special_set_paid") {
    setSpecialPlayerStatus(eventItem, userId, "сет оплачен");

    await updateEventMessage(interaction.message, eventItem);

    return interaction.reply({
      content: "Отмечено: сет оплачен.",
      ephemeral: true,
    });
  }

  if (interaction.customId === "decide_pick") {
    if (eventItem.picked.includes(userId)) {
      return interaction.reply({
        content: "Ты уже пикнул слот.",
        ephemeral: true,
      });
    }

    eventItem.picked.push(userId);

    await notifyCreatorAboutFive(eventItem);
    await updateEventMessage(interaction.message, eventItem);

    return interaction.reply({
      content: "Ты пикнул слот.",
      ephemeral: true,
    });
  }

  if (interaction.customId === "decide_unpick") {
    const minutesLeft = minutesBeforeEvent(eventItem);

    if (minutesLeft < 20) {
      return interaction.reply({
        content:
          "Нельзя отпикнуть слот, если до события осталось меньше 20 минут.",
        ephemeral: true,
      });
    }

    if (!eventItem.picked.includes(userId)) {
      return interaction.reply({
        content: "Ты не пикал слот.",
        ephemeral: true,
      });
    }

    eventItem.picked = eventItem.picked.filter((id) => id !== userId);

    await updateEventMessage(interaction.message, eventItem);

    return interaction.reply({
      content: "Ты отпикнул слот.",
      ephemeral: true,
    });
  }

  if (interaction.customId.startsWith("format_")) {
    if (interaction.user.id !== eventItem.createdById) {
      return interaction.reply({
        content: "Выбрать формат может только человек, который создал эти слоты.",
        ephemeral: true,
      });
    }

    const limit = Number(interaction.customId.replace("format_", ""));

    eventItem.mode = "normal";
    eventItem.limit = limit;
    eventItem.players = eventItem.picked.slice(0, limit);
    eventItem.replacements = eventItem.picked.slice(limit);

    await updateEventMessage(interaction.message, eventItem);

    return interaction.reply({
      content: `Формат выбран: ${limit}/${limit}. Первые ${limit} игроков пошли в основу, остальные — на замену.`,
      ephemeral: true,
    });
  }

  if (interaction.customId === "pick_slot") {
    if (eventItem.players.includes(userId)) {
      return interaction.reply({
        content: "Ты уже в основном слоте.",
        ephemeral: true,
      });
    }

    if (eventItem.replacements.includes(userId)) {
      eventItem.replacements = eventItem.replacements.filter(
        (id) => id !== userId
      );
    }

    if (eventItem.players.length >= eventItem.limit) {
      return interaction.reply({
        content: "Основные слоты уже заполнены. Можешь стать на замену.",
        ephemeral: true,
      });
    }

    eventItem.players.push(userId);

    await updateEventMessage(interaction.message, eventItem);

    return interaction.reply({
      content: "Ты занял слот.",
      ephemeral: true,
    });
  }

  if (interaction.customId === "unpick_slot") {
    const minutesLeft = minutesBeforeEvent(eventItem);

    if (minutesLeft < 20) {
      return interaction.reply({
        content:
          "Нельзя отпикнуть слот, если до события осталось меньше 20 минут.",
        ephemeral: true,
      });
    }

    if (eventItem.players.includes(userId)) {
      eventItem.players = eventItem.players.filter((id) => id !== userId);

      await promoteFirstReplacement(eventItem);
      await updateEventMessage(interaction.message, eventItem);

      return interaction.reply({
        content: "Ты отпикнул основной слот.",
        ephemeral: true,
      });
    }

    if (eventItem.replacements.includes(userId)) {
      eventItem.replacements = eventItem.replacements.filter(
        (id) => id !== userId
      );

      await updateEventMessage(interaction.message, eventItem);

      return interaction.reply({
        content: "Ты отпикнул замену.",
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: "Ты не записан в эти слоты.",
      ephemeral: true,
    });
  }

  if (interaction.customId === "replacement_slot") {
    if (eventItem.players.includes(userId)) {
      return interaction.reply({
        content: "Ты уже в основном слоте.",
        ephemeral: true,
      });
    }

    if (eventItem.replacements.includes(userId)) {
      return interaction.reply({
        content: "Ты уже записан на замену.",
        ephemeral: true,
      });
    }

    eventItem.replacements.push(userId);

    await updateEventMessage(interaction.message, eventItem);

    return interaction.reply({
      content: "Ты записан на замену.",
      ephemeral: true,
    });
  }
});

client.on("voiceStateUpdate", async (oldState) => {
  const oldChannel = oldState.channel;

  if (!oldChannel) return;

  const room = getPrivateRoom(oldChannel.id);

  if (!room) return;

  if (oldChannel.members.size === 0) {
    deletePrivateRoomData(oldChannel.id);

    await oldChannel.delete("Приватная комната пуста").catch(() => null);
  }
});

client.login(process.env.DISCORD_TOKEN);