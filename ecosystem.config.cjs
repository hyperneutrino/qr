module.exports = {
    apps: [
        {
            name: "qr",
            script: "./dist/server/entry.mjs",
            env: { HOST: "0.0.0.0", PORT: 5533 },
        },
    ],
};
