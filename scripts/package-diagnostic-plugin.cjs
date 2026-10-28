const fs = require("node:fs");
const path = require("node:path");

const source = path.resolve(process.argv[2] ?? "resources/diagnostics/python-modules.coachdiag");
const plugin = JSON.parse(fs.readFileSync(source, "utf8"));
if (plugin.schemaVersion !== 1 || !plugin.pluginId || !plugin.version || !Array.isArray(plugin.rules) || plugin.rules.length === 0) {
  throw new Error("Invalid diagnostic plugin manifest");
}
for (const rule of plugin.rules) {
  if (!rule.id || !rule.errorPattern || !rule.category || !rule.title || !rule.summary) {
    throw new Error(`Invalid diagnostic rule: ${rule.id ?? "unknown"}`);
  }
  new RegExp(rule.errorPattern, rule.flags ?? "i");
}
const outputDirectory = path.resolve("release/plugins");
fs.mkdirSync(outputDirectory, { recursive: true });
const destination = path.join(outputDirectory, `${plugin.pluginId}-${plugin.version}.coachdiag`);
fs.writeFileSync(destination, `${JSON.stringify(plugin, null, 2)}\n`);
console.log(`Packed ${plugin.pluginId}@${plugin.version} -> ${destination}`);
