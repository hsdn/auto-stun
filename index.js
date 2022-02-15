"use strict";

const Vec3 = require("tera-vec3");

module.exports = function autoStun(mod) {
	let zonesConfig = reloadModule("./config/zones.js");
	let classesConfig = reloadModule("./config/classes.js");

	let loaded = false;
	let zoneId = null;
	let bossTemplateId = null;
	let bossGameId = null;
	let bossLocation = null;
	let playerJob = null;
	let playerAvgSpeed = null;
	let playerLastSpeed = null;
	let playerLocation = null;
	let playerDirection = null;
	let lockSkills = false;
	let attackIdBase = 0xFEFEFFEE;

	const unlockDelay = 600;
	const startedSkills = new Set();
	const castedSkills = new Set();
	const pressedSkills = new Set();
	const cooldowns = new Map();
	const retryTimers = new Map();
	const retryCounts = new Map();
	const iconsData = new Map();

	mod.game.initialize("me.abnormalities");

	mod.command.add("autostun", {
		"$none": () => {
			mod.settings.enabled = !mod.settings.enabled;
			mod.command.message(`Module ${mod.settings.enabled ? "enabled" : "disabled"}`);
		},
		"display": () => {
			mod.settings.display = !mod.settings.display;
			mod.command.message(`Display ${mod.settings.display ? "enabled" : "disabled"}`);
		},
		"debug": () => {
			mod.settings.debug = !mod.settings.debug;
			mod.command.message(`Debug ${mod.settings.debug ? "enabled" : "disabled"}`);
		},
		"reload": () => {
			zonesConfig = reloadModule("./config/zones.js");
			classesConfig = reloadModule("./config/classes.js");
			mod.command.message("Configuration reloaded");
		}
	});

	mod.game.me.on("change_zone", event => {
		zoneId = event;
		loaded = !!zonesConfig[zoneId] && !!classesConfig[playerJob];

		bossTemplateId = null;
		bossGameId = null;
		bossLocation = null;
		playerLastSpeed = null;
		lockSkills = false;

		if (mod.game.me.inDungeon) {
			sendDebugMessage(`Entered Zone: ${zoneId}`);
		}
	});

	mod.game.on("leave_game", () => {
		lockSkills = false;

		startedSkills.clear();
		castedSkills.clear();
		pressedSkills.clear();
		retryTimers.clear();
		retryCounts.clear();
	});

	mod.game.on("enter_game", () => {
		iconsData.clear();

		mod.queryData("/SkillIconData/Icon@class=?/", [mod.game.me.class], true, false, ["skillId", "iconName"]).then(res =>
			res.forEach(icon => {
				iconsData.set(icon.attributes.skillId, icon.attributes.iconName);
				iconsData.set(Math.floor(icon.attributes.skillId / 10000), icon.attributes.iconName);
			})
		);

		playerJob = (mod.game.me.templateId - 10101) % 100;
	});

	mod.hook("S_PLAYER_STAT_UPDATE", 17, { "order": Infinity }, event => {
		if (!loaded) return;

		playerAvgSpeed = Math.max((event.attackSpeed + event.attackSpeedBonus) / (playerJob >= 8 ? 100 : event.attackSpeed), 0);

		if (playerLastSpeed === null) {
			playerLastSpeed = playerAvgSpeed;
		}
	});

	mod.hook("S_SPAWN_ME", 3, { "order": Infinity }, setPlayerLocation);
	mod.hook("C_PLAYER_LOCATION", 5, { "order": Infinity }, setPlayerLocation);
	mod.hook("C_NOTIFY_LOCATION_IN_DASH", 4, { "order": Infinity }, setPlayerLocation);
	mod.hook("C_NOTIFY_LOCATION_IN_ACTION", 4, { "order": Infinity }, setPlayerLocation);

	mod.hook("C_START_SKILL", 7, { "order": -Infinity }, cStartSkill);
	mod.hook("C_START_TARGETED_SKILL", 7, { "order": -Infinity }, cStartSkill);
	mod.hook("C_START_COMBO_INSTANT_SKILL", 6, { "order": -Infinity }, cStartSkill);
	mod.hook("C_START_INSTANCE_SKILL", 8, { "order": -Infinity }, cStartSkill);
	mod.hook("C_START_INSTANCE_SKILL_EX", 5, { "order": -Infinity }, cStartSkill);

	mod.hook("C_NOTIMELINE_SKILL", 3, { "order": -Infinity }, () => {
		if (mod.settings.enabled && loaded && lockSkills) return false;
	});

	mod.hook("C_PRESS_SKILL", mod.majorPatchVersion >= 114 ? 5 : 4, { "order": -Infinity }, event => {
		if (!mod.settings.enabled || !loaded) return;

		if (!event.press) {
			pressedSkills.delete(event.skill.id);
		} else {
			if (lockSkills) return false;

			pressedSkills.add(event.skill.id);
		}
	});

	mod.hook("S_CANNOT_START_SKILL", 4, { "order": -Infinity }, event => {
		if (!mod.settings.enabled || !loaded) return;

		castedSkills.delete(event.skill.id);

		if (startedSkills.has(event.skill.id) && retryTimers.has(event.skill.id)) {
			return false;
		}
	});

	mod.hook("S_START_COOLTIME_SKILL", mod.majorPatchVersion >= 114 ? 4 : 3, { "order": Infinity }, event => {
		if (!mod.settings.enabled || !loaded) return;

		cooldowns.set(event.skill.id, {
			"start": Date.now(),
			"cooldown": event.cooldown
		});

		if (startedSkills.has(event.skill.id)) {
			sendSkillMessage(event.skill.id, "Done", "#00FF00");

			startedSkills.delete(event.skill.id);

			mod.setTimeout(() => lockSkills = false, unlockDelay);
		}

		if (retryTimers.has(event.skill.id)) {
			mod.clearTimeout(retryTimers.get(event.skill.id));
		}

		castedSkills.delete(event.skill.id);
	});

	mod.hook("S_DECREASE_COOLTIME_SKILL", 3, { "order": Infinity }, event => {
		if (!mod.settings.enabled || !loaded) return;

		cooldowns.set(event.skill.id, {
			"start": Date.now(),
			"cooldown": event.cooldown
		});
	});

	mod.hook("S_NPC_LOCATION", 3, { "order": -Infinity }, setBossLocation);

	mod.hook("S_BOSS_GAGE_INFO", 3, { "order": Infinity }, event => {
		if (!loaded) return;

		if (bossTemplateId === null) {
			sendDebugMessage(`Spawned Boss: ${event.templateId}`);
		}

		bossTemplateId = event.templateId;
		bossGameId = event.id;
	});

	mod.hook("S_DESPAWN_NPC", 3, { "order": Infinity }, event => {
		if (!loaded || event.gameId !== bossGameId) return;

		bossTemplateId = null;
		bossGameId = null;
		bossLocation = null;
	});

	mod.hook("S_ACTION_STAGE", 9, { "order": -Infinity, "filter": { "fake": null } }, event => {
		if (!mod.settings.enabled || !loaded) return;

		if (mod.game.me.is(event.gameId)) {
			setPlayerLocation(event);
		}

		if (event.gameId === bossGameId) {
			setBossLocation(event);

			if (!zonesConfig[zoneId].bosses[bossTemplateId] || !zonesConfig[zoneId].bosses[bossTemplateId].skills) return;

			const skillid = event.skill.id > 3000 ? event.skill.id : event.skill.id % 1000;
			const action = zonesConfig[zoneId].bosses[bossTemplateId].skills[skillid];

			if (action) {
				mod.setTimeout(startSkillChain, action.delay || 0, action.profile);
			}

			sendDebugMessage(`Boss Skill: ${skillid}`);
		}
	});

	mod.hook("S_ACTION_END", 5, { "order": -Infinity }, event => {
		if (!mod.settings.enabled || !loaded) return;

		if (mod.game.me.is(event.gameId)) {
			setPlayerLocation(event);
		}

		if (event.gameId === bossGameId) {
			setBossLocation(event);
		}
	});

	mod.hook("S_QUEST_BALLOON", 1, { "order": -Infinity }, event => {
		if (!mod.settings.enabled || !loaded) return;

		if (event.source === bossGameId) {
			if (!zonesConfig[zoneId].bosses[bossTemplateId] || !zonesConfig[zoneId].bosses[bossTemplateId].questBalloons) return;

			const messageId = Number(/@(monsterBehavior|dungeon):(\d+)/g.exec(event.message));
			const action = zonesConfig[zoneId].bosses[bossTemplateId].questBalloons[messageId];

			if (action) {
				mod.setTimeout(startSkillChain, action.delay || 0, action.profile);
			}

			sendDebugMessage(`Quest Balloon: ${messageId}`);
		}
	});

	mod.hook("S_DUNGEON_EVENT_MESSAGE", 2, { "order": -Infinity }, event => {
		if (!mod.settings.enabled || !loaded) return;

		if (zonesConfig[zoneId].dungeonEvents) {
			const messageId = Number(/@dungeon:(\d+)/g.exec(event.message));
			const action = zonesConfig[zoneId].dungeonEvents[messageId];

			if (action) {
				mod.setTimeout(startSkillChain, action.delay || 0, action.profile);
			}

			sendDebugMessage(`Dungeon Event: ${messageId}`);
		}
	});

	function setPlayerLocation(event) {
		if (!loaded) return;

		playerLocation = event.loc;
		playerDirection = event.w;
	}

	function setBossLocation(event) {
		if (!loaded) return;

		if (event.gameId === bossGameId) {
			bossLocation = event.loc;
		}
	}

	function cStartSkill(event) {
		if (mod.settings.enabled && loaded && lockSkills) return false;

		castedSkills.add(event.skill.id);
	}

	function startSkillChain(profile) {
		if (!classesConfig[playerJob].skills) return;

		playerLastSpeed = playerAvgSpeed;

		startedSkills.clear();

		Object.values(classesConfig[playerJob].skills).forEach(skill => {
			if (!skill.id || (skill.profile && profile && skill.profile !== profile)) return;

			if (isSkillCooldown(skill.id)) {
				return;
			}

			if (skill.distance && !isNearBoss(skill.distance)) {
				return;
			}

			if (skill.enableIfCd) {
				const skillIds = (Array.isArray(skill.enableIfCd) ? skill.enableIfCd : [skill.enableIfCd]).map(x => parseInt(x)).filter(x => !isNaN(x));

				for (const skillId of skillIds) {
					if (!isSkillCooldown(skillId)) return;
				}
			}

			if (skill.disableIfCd) {
				const skillIds = (Array.isArray(skill.disableIfCd) ? skill.disableIfCd : [skill.disableIfCd]).map(x => parseInt(x)).filter(x => !isNaN(x));

				for (const skillId of skillIds) {
					if (isSkillCooldown(skillId)) return;
				}
			}

			if (skill.enableIfAbn) {
				const abnormalities = (Array.isArray(skill.enableIfAbn) ? skill.enableIfAbn : [skill.enableIfAbn]).map(x => parseInt(x)).filter(x => !isNaN(x));

				for (const abnormalityId of abnormalities) {
					if (!mod.game.me.abnormalities[abnormalityId]) return;
				}
			}

			if (skill.disableIfAbn) {
				const abnormalities = (Array.isArray(skill.disableIfAbn) ? skill.disableIfAbn : [skill.disableIfAbn]).map(x => parseInt(x)).filter(x => !isNaN(x));

				for (const abnormalityId of abnormalities) {
					if (mod.game.me.abnormalities[abnormalityId]) return;
				}
			}

			if (!skill.type || ["cast", "instance", "targeted"].includes(skill.type)) {
				lockSkills = true;

				startSkill(
					skill.id,
					skill.delay || 0,
					skill.type || null,
					skill.retry || 0,
					skill.count || 0
				);
			} else if (skill.type === "press" && skill.duration) {
				lockSkills = true;

				pressSkill(
					skill.id,
					skill.delay || 0,
					skill.duration
				);
			}
		});

		mod.setTimeout(() => lockSkills = false, 3600);
	}

	function isNearBoss(d) {
		return (
			bossLocation && playerLocation &&
			bossLocation.x - d < playerLocation.x && bossLocation.x + d > playerLocation.x &&
			bossLocation.y - d < playerLocation.y && bossLocation.y + d > playerLocation.y
		);
	}

	function isSkillCooldown(skillId) {
		return cooldowns.has(skillId) && Date.now() - cooldowns.get(skillId).start < cooldowns.get(skillId).cooldown;
	}

	function startSkill(skillId, delay, type = null, retry = null, count = null) {
		startedSkills.add(skillId);

		cancelSkills();

		mod.setTimeout(() => {
			retrySkill(retry, count, skillId, () => {
				const skill = {
					"reserved": 0,
					"npc": false,
					"type": 1,
					"huntingZoneId": 0,
					"id": skillId
				};

				if (!retryCounts.get(skillId)) {
					sendSkillMessage(skillId, "Cast", "#FFFF00");
				}

				switch (type) {
					case "instance":
						mod.send("C_START_INSTANCE_SKILL", 8, {
							"skill": skill,
							"loc": playerLocation,
							"w": playerDirection,
							"continue": false,
							"unkn1": new Vec3(0, 0, 0),
							"unkn2": true,
							"targets": [{
								"arrowId": 0,
								"gameId": bossGameId,
								"hitCylinderId": 0
							}],
							"endpoints": [bossLocation]
						});
						break;
					case "targeted":
						mod.send("C_START_TARGETED_SKILL", 7, {
							"skill": skill,
							"loc": playerLocation,
							"w": playerDirection,
							"dest": { "x": 0, "y": 0, "z": 0 },
							"targets": [{
								"gameId": bossGameId,
								"hitCylinderId": 0
							}]
						});
						break;
					default:
						mod.send("C_START_SKILL", 7, {
							"skill": skill,
							"w": playerDirection,
							"loc": playerLocation,
							"dest": { "x": 0, "y": 0, "z": 0 },
							"unk": true,
							"moving": false,
							"continue": false,
							"target": bossGameId,
							"unk2": false
						});
				}
			});
		}, delay / playerLastSpeed);
	}

	function pressSkill(skillId, delay, duration, press = true) {
		if (press) {
			cancelSkills(false);
		}

		mod.setTimeout(() => {
			if (press && pressedSkills.has(skillId)) return;

			if (press) {
				sendSkillMessage(skillId, "Press", "#FFFF00");
			} else {
				sendSkillMessage(skillId, "Release", "#00FF00");
			}

			mod.send("C_PRESS_SKILL", 5, {
				"skill": {
					"reserved": 0,
					"npc": false,
					"type": 1,
					"huntingZoneId": 0,
					"id": skillId
				},
				"press": press,
				"loc": playerLocation,
				"w": playerDirection,
				"unkn1": new Vec3(0, 0, 0),
				"unkn2": true,
				"unkn3": false
			});

			if (press) {
				if (duration) {
					mod.setTimeout(pressSkill, duration / playerLastSpeed, skillId, 0, 0, false);
				}
			} else {
				const attackId = attackIdBase--;

				mod.send("S_ACTION_STAGE", 9, {
					"gameId": mod.game.me.gameId,
					"loc": playerLocation,
					"w": playerDirection,
					"templateId": mod.game.me.templateId,
					"skill": skillId,
					"stage": 0,
					"speed": 1,
					"projectileSpeed": 1,
					"id": attackId,
					"effectScale": 1.0,
					"moving": false,
					"dest": { "x": 0, "y": 0, "z": 0 },
					"target": 0n,
					"animSeq": []
				});

				mod.setTimeout(() => mod.send("S_ACTION_END", 5, {
					"gameId": mod.game.me.gameId,
					"loc": playerLocation,
					"w": playerDirection,
					"templateId": mod.game.me.templateId,
					"skill": skillId,
					"type": 10,
					"id": attackId
				}), duration / playerLastSpeed);
			}
		}, delay / playerLastSpeed);
	}

	function retrySkill(retry, count, skillId, callback, ...args) {
		retryCounts.set(skillId, 0);

		if (retryTimers.has(skillId)) {
			mod.clearTimeout(retryTimers.get(skillId));
		}

		function retryIterator() {
			callback(...args);

			let retryCount = retryCounts.get(skillId);

			retryTimers.set(skillId, mod.setTimeout(retryIterator, retry, ...arguments));
			retryCounts.set(skillId, ++retryCount);

			if (retryCount >= count) {
				mod.clearTimeout(retryTimers.get(skillId));

				retryCounts.delete(skillId);
			}
		}

		retryIterator();
	}

	function cancelSkills(cancelPressed = true) {
		if (cancelPressed) {
			pressedSkills.forEach(skillId => {
				mod.send("C_PRESS_SKILL", 5, {
					"skill": {
						"reserved": 0,
						"npc": false,
						"type": 1,
						"huntingZoneId": 0,
						"id": skillId
					},
					"press": false,
					"loc": playerLocation,
					"w": playerDirection,
					"unkn1": new Vec3(0, 0, 0),
					"unkn2": true,
					"unkn3": false
				});
			});
		}

		castedSkills.forEach(skillId => {
			if (startedSkills.has(skillId)) return;

			mod.send("C_CANCEL_SKILL", 3, {
				"skill": {
					"reserved": 0,
					"npc": false,
					"type": 1,
					"huntingZoneId": 0,
					"id": skillId
				},
				"type": 2
			});
		});
	}

	function sendSkillMessage(skillId, message, color = "#00FF00") {
		if (mod.settings.display) {
			const icon = iconsData.get(skillId) || iconsData.get(Math.floor(skillId / 10000));

			mod.send("S_CUSTOM_STYLE_SYSTEM_MESSAGE", 1, {
				"message": `<font color="${color}" size="24"><img src="img://__${icon}" width="32" height="32" vspace="-10"/> ${message}</font>`,
				"style": 51
			});
		}

		sendDebugMessage(`Character Skill (${skillId}): ${message}`);
	}

	function sendDebugMessage(message) {
		if (!mod.settings.debug) return;

		const logString = `[${Date.now() % 100000}] ${message}`;

		mod.command.message(logString);
		console.log(logString);
	}

	function reloadModule(modToReload) {
		delete require.cache[require.resolve(modToReload)];
		return require(modToReload);
	}
};