module.exports = {
  daemon: true,
  run: [
    {
      method: "shell.run",
      params: {
        path: ".",
        message: [
          "npm run dev"
        ],
        on: [{
          event: "/NEXUS_WEB_URL=(http:\\/\\/localhost:[0-9]+\\/)/",
          done: true
        }]
      }
    },
    {
      method: "local.set",
      params: {
        url: "{{input.event[1]}}"
      }
    }
  ]
}