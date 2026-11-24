const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/data/zalo-agent.db');
const cols = db.prepare(`PRAGMA table_info(agent_steps)`).all();
console.log(cols);
const steps = db.prepare(`SELECT * FROM agent_steps WHERE turn_id = 231`).all();
console.log(JSON.stringify(steps, null, 2));
