// Import Module
const { Telegraf } = require("telegraf");
const CONFIG = require("./config.json");
const BOT = new Telegraf(CONFIG.BOT_TOKEN);
const mongoose = require("mongoose");
const cron = require("cron");
const axios = require("axios");
const cherio = require("cherio");

const dbschema = mongoose.Schema({
	_id: {
		type: String,
		required: true,
	},
	userId: {
		type: String,
		required: true,
	},
});

const daftarClient = mongoose.model("daftar-client", dbschema);
let subscriber = [];
let cmc = {
	ongoing: [],
	upcoming: [],
	ended: [],
};
let slugCache = [];

async function mongo() {
	return await mongoose.connect(CONFIG.SRV, {
		useNewUrlParser: true,
		useUnifiedTopology: true,
	});
}

async function fetchHTML(url) {
	try {
		const { data } = await axios.get(url);
		return cherio.load(data, null, false);
	} catch (error) {
		console.log(error.message);
	}
}

async function getData() {
	try {
		const $ = await fetchHTML("https://coinmarketcap.com/airdrop/");

		let raw = {
			ongoing: $("table.cmc-table")["0"],
			upcoming: $("table.cmc-table")["1"],
			ended: $("table.cmc-table")["2"],
		};

		function analyze(type) {
			return raw[type].children[2].children.map((el) =>
				el.children.map((er, id) =>
					id == 0
						? [
								"https://coinmarketcap.com/airdrop" +
									$(er.children[0]).attr("href"),
								...er.children[0].children[1].children[0].children.map(
									(et) => $(et).text()
								),
						  ]
						: $(er).text()
				)
			);
		}

		cmc.ongoing = analyze("ongoing").map((el) => {
			return {
				link: el[0][0],
				status: "ongoing",
				project: el[0][1],
				coinName: el[0][2],
				participated: el[1],
				winner: el[2],
				totalPrize: el[3],
				endDate: el[4].split("left")[1],
				endLeft: el[4].split("left")[0] + "left",
			};
		});

		cmc.upcoming = analyze("upcoming").map((el) => {
			return {
				link: el[0][0],
				project: el[0][1],
				status: "upcoming",
				coinName: el[0][2],
				winner: el[1],
				totalPrize: el[2],
				startDate: el[3].slice(el[3].search(/[A-Z]+/)),
				startLeft: el[3].slice(0, el[3].search(/[A-Z]+/)),
			};
		});

		cmc.ended = analyze("ended").map((el) => {
			return {
				link: el[0][0],
				project: el[0][1],
				coinName: el[0][2],
				participated: el[1],
				status: "ended",
				winner: el[2],
				totalPrize: el[3],
				startDate: el[4],
				endDate: el[5],
			};
		});

		checkNearestDrop();
		console.log("MATSUMOTO done update CMC data");
	} catch (error) {
		console.log(error.message);
	}
}

async function searchDrop(key, ctx, cmd) {
	try {
		let keyword = key.toLowerCase();

		if (keyword.length <= 3) {
			ctx.reply(`Masukkan minimal 4 huruf
Contoh: (/${cmd} Moonpot)`);
			return 0;
		}

		let alldrop = [...cmc.ongoing, ...cmc.upcoming, ...cmc.ended];

		let result = alldrop.filter((el) =>
			el.project.toLowerCase().includes(keyword)
		);

		return result;
	} catch (error) {
		console.log(error);
		console.log(error.message);
	}
}

async function alertSubscriber(content) {
	for (let i = 0; i < subscriber.length; i++) {
		try {
			BOT.telegram.sendMessage(subscriber[i], content, {
				parse_mode: "Markdown",
			});
		} catch (error) {
			console.log(error.message);
		}
	}
}

async function checkNearestDrop() {
	try {
		let filteredOngoing = cmc.ongoing
			.filter((el) => el.endLeft.includes("minute"))
			.filter((er) => er.endLeft.split(" ")[0] <= 30);

		let filteredUpcoming = cmc.upcoming
			.filter((el) => el.startLeft.includes("minute"))
			.filter((er) => er.startLeft.split(" ")[1] <= 30);

		if (!filteredOngoing) {
			filteredOngoing.forEach((el) => {
				let content = `⚠️⚠️ *Pengingat* ⚠️⚠️
Airdrop ${el.project} akan *berakhir* dalam ${
					el.endLeft.split(" ")[0]
				} menit lagi.

Detail Airdrop ${el.project}
——————————————
💴 ${el.coinName}
👨‍👨‍👧‍👧 ${el.participated} sudah bergabung
🏆 ${el.winner} pemenang
⭐️ ${el.totalPrize} total
📅 ${el.endDate}
🕐 ${el.endLeft}
——— [JOIN AIRDROP](${el.link}) ———`;
				alertSubscriber(content);
			});
		}

		if (!filteredUpcoming) {
			filteredUpcoming.forEach((el) => {
				let content = `⚠️⚠️ *Pengingat* ⚠️⚠️
Airdrop ${el.project} akan *dimulai* dalam ${
					el.startLeft.split(" ")[1]
				} menit lagi.

Bersiap-siap di entry awal! 🎉🎉

Detail Airdrop ${el.project}
——————————————
💴 ${el.coinName}
🏆 ${el.winner} pemenang
⭐️ ${el.totalPrize} total
📅 ${el.startDate}
🕐 ${el.startLeft}
——— [JOIN AIRDROP](${el.link}) ———`;

				alertSubscriber(content);
			});
		}
	} catch (error) {
		console.log(error.message);
	}
}

async function dailyCMC() {
	try {
		if (cmc.ongoing.length == 0 || cmc.upcoming.length == 0)
			return getData();
		let og = cmc.ongoing[0];
		let up = cmc.upcoming[0];

		let content = `Selamat Pagi! 🌤
Airdrop yang mendekati deadline hari ini!

Airdrop yang sedang berlangsung
🚀 *${og.project}* 🚀
——————————————
💴 ${og.coinName}
👨‍👨‍👧‍👧 ${og.participated} sudah bergabung
🏆 ${og.winner} pemenang
⭐️ ${og.totalPrize} total
📅 ${og.endDate}
🕐 ${og.endLeft}
——— [JOIN AIRDROP](${og.link}) ———

Airdrop yang akan datang
🚀 *${up.project}* 🚀
——————————————
💴 ${up.coinName}
🏆 ${up.winner} pemenang
⭐️ ${up.totalPrize} total
📅 ${up.startDate}
🕐 ${up.startLeft}
——— [JOIN AIRDROP](${up.link}) ———

_Selamat beraktifitas~_
	`;

		alertSubscriber(content);
	} catch (error) {
		console.log(error.message);
	}
}

BOT.start(async (ctx) => {
	let id = ctx.update.message.chat.id;
	if (!subscriber.includes(id.toString())) {
		await mongo().then(async (mon) => {
			try {
				await daftarClient.findOneAndUpdate(
					{
						_id: id,
					},
					{
						_id: id,
						userId: id,
					},
					{
						upsert: true,
					}
				);
				subscriber.push(id);
				console.log("Matsumoto registered user");
			} catch (e) {
				console.log(e.message);
			} finally {
				mon.connection.close();
			}
		});
		BOT.telegram.sendMessage(
			ctx.chat.id,
			`Berhasil melakukan registrasi.
Lihat bantuan dengan menu /bantuan`
		);
		return;
	}

	BOT.telegram.sendMessage(ctx.chat.id, `Sudah teregistrasi. Lihat /bantuan`);
	return;
});

BOT.command("bantuan", async (ctx) => {
	ctx.replyWithMarkdown(
		`
*Menu Bantuan*

/bantuan \- menampilkan menu bantuan
/start \- registrasi grup/akun untuk pengingat airdrop coinmarketcap
/gacha \- mengambil garapan airdrop random dari coinmarketcap
/ongoing \- menampilkan 10 garapan airdrop ongoing
/ended \- menampilkan 10 garapan airdrop ended
/upcoming \- menampilkan garapan airdrop upcoming
/cari \- /cari <nama project> mencari garapan airdrop
/lihat \- /lihat <nama project> melihat detail persyaratan airdrop
/donasi \- donasi untuk 10 menyemangati pengembang

*Pengingat*

Matsumoto akan menampilkan pengingat Airdrop upcoming maupun ongoing yang waktunya kurang dari 30 menit.

Matsumoto juga akan menampilkan Airdrop ongoing dan upcoming setiap hari jam 07.00 WIB

*Pengembang*
@snowfluke
`
	);
	return;
});

BOT.command("donasi", async (ctx) => {
	ctx.replyWithMarkdown(`
*Sedekah seikhlasnya*

💠 BSC/ETH/POLY:
\`0x39Bce682DBFe79a0b940c8E833aaf2ab08098816\`

💠DANA/OVO:
\`083863434232\`
    `);
});

BOT.command("ongoing", async (ctx) => {
	try {
		if (cmc.ongoing.length == 0) {
			return getData();
		}

		let content = `*Daftar 10 Airdrop Ongoing Coinmarketcap*`;

		for (let i = 0; i < cmc.ongoing.length; i++) {
			content += `
		
🚀 *${cmc.ongoing[i].project}* 🚀
Sedang berlangsung
——————————————
💴 ${cmc.ongoing[i].coinName}
👨‍👨‍👧‍👧 ${cmc.ongoing[i].participated} sudah bergabung
🏆 ${cmc.ongoing[i].winner} pemenang
⭐️ ${cmc.ongoing[i].totalPrize} total
📅 ${cmc.ongoing[i].endDate}
🕐 ${cmc.ongoing[i].endLeft}
——— [JOIN AIRDROP](${cmc.ongoing[i].link}) ———`;
		}

		content += `

_Data Diperbarui 10 menit sekali_`;

		ctx.replyWithMarkdown(content);
		return;
	} catch (error) {
		console.log(error.message);
	}
});

BOT.command("ended", async (ctx) => {
	try {
		if (cmc.ended.length == 0) {
			return getData();
		}

		let content = `*Daftar 10 Airdrop Ended Coinmarketcap*`;

		for (let i = 0; i < cmc.ongoing.length; i++) {
			content += `
		
🚀 *${cmc.ended[i].project}* 🚀
Sudah Berakhir
—————————————
🏳️ ${cmc.ended[i].coinName}
🏳️ ${cmc.ended[i].participated} sudah bergabung
🏳️ ${cmc.ended[i].winner} pemenang
🏳️ ${cmc.ended[i].totalPrize} total
🏳️ ${cmc.ended[i].startDate}
🏳️ ${cmc.ended[i].endDate}
——— [CARI WINLIST](${cmc.ended[i].link}) ———`;
		}

		content += `

	_Data Diperbarui 10 menit sekali_`;

		ctx.replyWithMarkdown(content);
		return;
	} catch (error) {
		console.log(error.message);
	}
});

BOT.command("gacha", async (ctx) => {
	if (cmc.ongoing.length == 0 || cmc.upcoming.length == 0) return getData();
	try {
		let gachaType =
			Math.floor(Math.random() * 2) == 0 ? "ongoing" : "upcoming";
		let gachaAirdrop =
			cmc[gachaType][Math.floor(Math.random() * cmc[gachaType].length)];

		let content = `Menurut Matsumoto, ini adalah garapan terbaik untuk kamu`;

		if (gachaType == "ongoing") {
			content += `
		
🚀 *${gachaAirdrop.project}* 🚀
Sedang berlangsung
——————————————
💴 ${gachaAirdrop.coinName}
👨‍👨‍👧‍👧 ${gachaAirdrop.participated} sudah bergabung
🏆 ${gachaAirdrop.winner} pemenang
⭐️ ${gachaAirdrop.totalPrize} total
📅 ${gachaAirdrop.endDate}
🕐 ${gachaAirdrop.endLeft}
——— [JOIN AIRDROP](${gachaAirdrop.link}) ———

*Selamat mengerjakan~*`;
		} else {
			content += `
		
🚀 *${gachaAirdrop.project}* 🚀
Akan datang
——————————————
💴 ${gachaAirdrop.coinName}
🏆 ${gachaAirdrop.winner} pemenang
⭐️ ${gachaAirdrop.totalPrize} total
📅 ${gachaAirdrop.startDate}
🕐 ${gachaAirdrop.startLeft}
——— [JOIN AIRDROP](${gachaAirdrop.link}) ———

*Tunggu sampai jadwalnya datang ya~*`;
		}

		ctx.replyWithMarkdown(content);
		return;
	} catch (error) {
		console.log(error.message);
	}
});

BOT.command("upcoming", async (ctx) => {
	if (cmc.upcoming.length == 0) {
		return getData();
	}

	try {
		let content = `*Daftar 10 Airdrop Upcoming Coinmarketcap*`;

		for (let i = 0; i < cmc.upcoming.length; i++) {
			content += `
		
🚀 *${cmc.upcoming[i].project}* 🚀
Akan datang
——————————————
💴 ${cmc.upcoming[i].coinName}
🏆 ${cmc.upcoming[i].winner} pemenang
⭐️ ${cmc.upcoming[i].totalPrize} total
📅 ${cmc.upcoming[i].startDate}
🕐 ${cmc.upcoming[i].startLeft}
——— [JOIN AIRDROP](${cmc.upcoming[i].link}) ———`;
		}

		content += `

_Data Diperbarui 10 menit sekali_`;
		ctx.replyWithMarkdown(content);
		return;
	} catch (error) {
		console.log(error.message);
	}
});

BOT.command("broadcast", async (ctx) => {
	if (ctx.from.id !== 1115895870) {
		BOT.telegram.sendMessage(
			ctx.chat.id,
			"Kamu tidak diperbolehkan menggunakan perintah ini!"
		);

		return;
	}

	try {
		if (subscriber.length == 0) return;
		let broadcastMsg = ctx.update.message.text
			.split(" ")
			.slice(1)
			.join(" ");
		for (let i = 0; i < subscriber.length; i++) {
			try {
				BOT.telegram.sendMessage(subscriber[i], broadcastMsg, {
					parse_mode: "Markdown",
				});
			} catch (error) {
				console.log(error.message);
			}
		}

		ctx.reply(
			`Berhasil melakukan broadcast ke ${subscriber.length} subscriber`
		);
		return;
	} catch (error) {
		console.log(error.message);
	}
});

BOT.command("count", async (ctx) => {
	if (ctx.from.id !== 1115895870) {
		BOT.telegram.sendMessage(
			ctx.chat.id,
			"Kamu tidak diperbolehkan menggunakan perintah ini!"
		);

		return;
	}
	try {
		ctx.reply(
			`Jumlah subscriber Matsumoto: ${subscriber.length} subscriber`
		);
	} catch (error) {
		console.log(error.message);
	}
});

BOT.command("lihat", async (ctx) => {
	if (cmc.ongoing.length == 0 || cmc.upcoming.length == 0) return getData();
	try {
		let rawKeyword = ctx.update.message.text.split(" ").slice(1).join(" ");
		let result = await searchDrop(rawKeyword, ctx, "lihat");

		if (result === 0) return;
		if (result.length == 0)
			return ctx.reply(
				`Maaf, pencarian Airdrop ${rawKeyword} tidak ditemukan`
			);

		let slug = result[0].project
			.toLowerCase()
			.split(" ")
			.filter((el) => el[0] != "(")
			.join("-");

		let slugFiltered = slugCache.filter((el) => el.slug == slug)[0];
		let response;
		let raw;

		if (!slugFiltered) {
			response = await axios.post(
				"https://api.coinmarketcap.com/data-api/v3/airdrop/detail",
				{
					slug: slug,
				}
			);
			raw =
				response.data.data.cryptoAirdropDetailList[0].airdropInfo
					.participateContent;

			slugCache.push({
				slug: slug,
				data: raw,
			});
		} else {
			raw = slugFiltered.data;
		}

		let content = `*Menampilkan detail informasi*

🚀 *${result[0].project}* 🚀`;
		if (result[0].status == "ongoing") {
			content += `
Sedang berlangsung
——————————————
💴 ${result[0].coinName}
👨‍👨‍👧‍👧 ${result[0].participated} sudah bergabung
🏆 ${result[0].winner} pemenang
⭐️ ${result[0].totalPrize} total
📅 ${result[0].endDate}
🕐 ${result[0].endLeft}
——— [JOIN AIRDROP](${result[0].link}) ———`;
		} else if (result[0].status == "upcoming") {
			content += `Akan datang
——————————————
💴 ${result[0].coinName}
🏆 ${result[0].winner} pemenang
⭐️ ${result[0].totalPrize} total
📅 ${result[0].startDate}
🕐 ${result[0].startLeft}
——— [JOIN AIRDROP](${result[0].link}) ———`;
		} else {
			content += `
Sudah Berakhir
—————————————
🏳️ ${cmc.ended[0].coinName}
🏳️ ${cmc.ended[0].participated} sudah bergabung
🏳️ ${cmc.ended[0].winner} pemenang
🏳️ ${cmc.ended[0].totalPrize} total
🏳️ ${cmc.ended[0].startDate}
🏳️ ${cmc.ended[0].endDate}
——— [CARI WINLIST](${cmc.ended[0].link}) ———`;
		}

		content += `

${raw}

_diambil dari coinmarketcap.com_
`;
		ctx.replyWithMarkdown(content);
	} catch (error) {
		console.log(error.message);
	}
});

BOT.command("cari", async (ctx) => {
	if (cmc.ongoing.length == 0 || cmc.upcoming.length == 0) return getData();
	try {
		let rawKeyword = ctx.update.message.text.split(" ").slice(1).join(" ");
		let result = await searchDrop(rawKeyword, ctx, "cari");

		if (result === 0) return;
		if (result.length == 0)
			return ctx.reply(
				`Maaf, pencarian Airdrop ${rawKeyword} tidak ditemukan`
			);

		let content = `*Menampilkan hasil pencarian*
🔍 ${rawKeyword}`;

		for (let i = 0; i < result.length; i++) {
			if (result[i].status == "ongoing") {
				content += `
		
🚀 *${result[i].project}* 🚀
Sedang berlangsung
——————————————
💴 ${result[i].coinName}
👨‍👨‍👧‍👧 ${result[i].participated} sudah bergabung
🏆 ${result[i].winner} pemenang
⭐️ ${result[i].totalPrize} total
📅 ${result[i].endDate}
🕐 ${result[i].endLeft}
——— [JOIN AIRDROP](${result[i].link}) ———`;
			} else if (result[i].status == "upcoming") {
				content += `
		
🚀 *${result[i].project}* 🚀
Akan datang
——————————————
💴 ${result[i].coinName}
🏆 ${result[i].winner} pemenang
⭐️ ${result[i].totalPrize} total
📅 ${result[i].startDate}
🕐 ${result[i].startLeft}
——— [JOIN AIRDROP](${result[i].link}) ———`;
			} else {
				content += `
		
🚀 *${cmc.ended[i].project}* 🚀
Sudah Berakhir
—————————————
🏳️ ${cmc.ended[i].coinName}
🏳️ ${cmc.ended[i].participated} sudah bergabung
🏳️ ${cmc.ended[i].winner} pemenang
🏳️ ${cmc.ended[i].totalPrize} total
🏳️ ${cmc.ended[i].startDate}
🏳️ ${cmc.ended[i].endDate}
——— [CARI WINLIST](${cmc.ended[i].link}) ———`;
			}
		}

		content += `

_Data diperbarui setiap 10 menit_`;
		ctx.replyWithMarkdown(content);
		return;
	} catch (error) {
		console.log(error.message);
	}
});

(async function () {
	if (subscriber.length == 0) {
		await mongo().then(async (mon) => {
			try {
				let result = await daftarClient.find({});
				subscriber = result.map((el) => el._id);
				console.log("Matsumoto fetched all user");
				getData();
			} catch (e) {
				console.log(e.message);
			} finally {
				mon.connection.close();
			}
		});
	}
})();

process.once("SIGINT", () => BOT.stop("SIGINT"));
process.once("SIGTERM", () => BOT.stop("SIGTERM"));

console.log("MATSUMOTO is running");

const cmcUpdate = new cron.CronJob(
	"*/10 * * * *",
	async () => {
		try {
			getData();
		} catch (error) {
			console.log(error.message);
		}
	},
	null,
	true,
	"Asia/Jakarta"
);

const cmcDaily = new cron.CronJob(
	"* 7 * * *",
	async () => {
		try {
			dailyCMC();
		} catch (error) {
			console.log(error.message);
		}
	},
	null,
	true,
	"Asia/Jakarta"
);

BOT.launch();
