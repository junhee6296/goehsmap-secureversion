'use strict';

require('dotenv').config({ quiet: true });

const app = require('./runtime');

const PORT = Number.parseInt(process.env.PORT || '3001', 10);
const HOST = '127.0.0.1';

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
}

function startServer() {
    return app.listen(PORT, HOST, () => {
        console.log(`Secure school map is listening on http://${HOST}:${PORT}`);
    });
}

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer };
