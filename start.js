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
          event: "/(http:\\/\\/localhost:51[0-9]{2}\\/)/",
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