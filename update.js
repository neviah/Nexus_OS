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
          "npm --prefix apps/web install",
          "npm --prefix apps/api run provision:wan2gp",
          "npm --prefix apps/api run provision:hunyuan3d"
        ]
      }
    }
  ]
}