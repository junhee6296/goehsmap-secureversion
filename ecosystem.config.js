'use strict';

const path = require('node:path');

module.exports = {
    apps: [{
        name: 'goehsschoolmap',
        cwd: __dirname,
        script: path.join(__dirname, 'deploy', 'pm2-start.sh'),
        interpreter: '/bin/bash',
        exec_mode: 'fork',
        instances: 1,
        autorestart: true,
        watch: false,
        restart_delay: 5000,
        exp_backoff_restart_delay: 100,
        max_restarts: 10,
        min_uptime: '10s',
        max_memory_restart: '300M',
        kill_timeout: 10000,
        merge_logs: true,
        time: true,
        vizion: false,
        env_production: {
            NODE_ENV: 'production'
        }
    }]
};
