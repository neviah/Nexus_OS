module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        path: ".",
        message: [
          "if exist node_modules rmdir /s /q node_modules",
          "if exist apps\\api\\node_modules rmdir /s /q apps\\api\\node_modules",
          "if exist apps\\web\\node_modules rmdir /s /q apps\\web\\node_modules",
          "if exist apps\\api\\dist rmdir /s /q apps\\api\\dist",
          "if exist apps\\web\\dist rmdir /s /q apps\\web\\dist",
          "if exist data\\system-state.local.json del /f /q data\\system-state.local.json"
        ]
      }
    }
  ]
}