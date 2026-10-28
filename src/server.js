const { createApp } = require('./app');
const { openDb } = require('./db');
const port = process.env.PORT || 4500;
createApp(openDb(process.env.DB_FILE || 'analytics.db')).listen(port, () => console.log('analytics-api on :' + port));
