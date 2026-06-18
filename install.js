module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        path: ".",
        message: [
          "npm install",
          "npm --prefix apps/api install",
          "npm --prefix apps/web install"
        ]
      }
    }
  ]
}