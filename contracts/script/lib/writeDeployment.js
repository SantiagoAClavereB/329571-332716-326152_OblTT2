const fs = require("node:fs");
const path = require("node:path");

/// Archivo que lee la dApp. Es el mismo de siempre: frontend/public/deployments.json.
const DEFAULT_FILE = path.resolve(__dirname, "../../../frontend/public/deployments.json");

/// Agrega o actualiza la entrada de la red `chainId` sin pisar las de otras redes.
/// Formato: { "<chainId>": { vestingManager, mockToken, mockPermitToken, deployBlock, [implementation] } }
function writeDeployment(chainId, entry, file = process.env.DEPLOYMENTS_FILE || DEFAULT_FILE) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const current = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8") || "{}") : {};
  current[String(chainId)] = entry;
  fs.writeFileSync(target, JSON.stringify(current, null, 2) + "\n");
  return target;
}

module.exports = { writeDeployment };
