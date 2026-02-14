module.exports = {
    apps: [{
        name: "Suspeito Game",
        script: "dist/app.js",
        instances: "1", // or a number like 4
        exec_mode: "cluster",
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',
    }]
};