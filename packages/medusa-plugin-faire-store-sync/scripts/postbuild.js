const fs = require("fs")
const path = require("path")

const serverDir = path.join(__dirname, "..", ".medusa", "server")
const srcDir = path.join(serverDir, "src")

if (!fs.existsSync(serverDir)) {
  process.exit(0)
}

if (!fs.existsSync(srcDir)) {
  fs.mkdirSync(srcDir, { recursive: true })
}

const dirsToMove = [
  "api",
  "jobs",
  "lib",
  "links",
  "modules",
  "workflows",
  "__tests__",
]

for (const dir of dirsToMove) {
  const from = path.join(serverDir, dir)
  const to = path.join(srcDir, dir)
  if (fs.existsSync(from)) {
    if (fs.existsSync(to)) {
      fs.rmSync(to, { recursive: true, force: true })
    }
    fs.renameSync(from, to)
  }
}

console.log("postbuild: restructured server output into src/")
