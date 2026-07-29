module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        path: ".",
        message: [
          "node scripts/open-external.js"
        ]
      }
    }
  ]
}
