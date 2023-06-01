/* eslint-disable quote-props, comma-dangle */
"use strict";

module.exports = {
	// Warrior tank
	0: {
		"skills": [
			// Battle Cry is first
			{ "type": "press", "id": 320100, "delay": 0, "duration": 1, "distance": 250, "disableIfCd": 50300, "disableIfAbn": 100103 }, // Cross Parry
			{ "type": "cast", "id": 50300, "delay": 60, "distance": 250, "retry": 300, "count": 5, "disableIfAbn": 100103 }, // Battle Cry

			// Reaping Slash is second
			{ "type": "cast", "id": 310800, "delay": 100, "distance": 250, "retry": 200, "count": 10 }, // Reaping Slash

			// Backstab is third
			{ "type": "press", "id": 320100, "delay": 0, "duration": 1, "distance": 550, "enableIfCd": [50300, 310800], "disableIfCd": 220200, "disableIfAbn": 100103 }, // Cross Parry
			{ "type": "targeted", "id": 220200, "delay": 200, "distance": 550, "retry": 200, "count": 10, "enableIfCd": 310800 }, // Backstab
		]
	},

	// Lancer
	1: {
		"skills": [
			// Chained Leash is first
			{ "type": "press", "id": 20200, "delay": 0, "duration": 1, "distance": 550, "disableIfCd": 240101 }, // Stand Fast
			{ "type": "instance", "id": 240101, "delay": 700, "distance": 550, "retry": 400, "count": 5 }, // Chained Leash

			// Leash is second
			{ "type": "press", "id": 20200, "delay": 0, "duration": 1, "distance": 700, "enableIfCd": 240101, "disableIfCd": 90300 }, // Stand Fast
			{ "type": "targeted", "id": 90300, "delay": 700, "distance": 700, "retry": 400, "count": 5, "enableIfCd": 240101 }, // Leash
		]
	},

	// Brawler
	10: {
		"skills": [
			{ "type": "cast", "id": 161101, "delay": 400, "distance": 134, "retry": 25, "count": 2 }, // Flip Kick
			{ "type": "cast", "id": 130901, "delay": 100, "distance": 400, "retry": 200, "count": 5, "enableIfCd": 161101 }, // Provoke
		]
	}
};