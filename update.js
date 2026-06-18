module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        path: ".",
        message: [
          "git pull",
          "npm install",
          "npm --prefix apps/api install",
          "npm --prefix apps/web install"
        ]
      }
    }
  ]
}