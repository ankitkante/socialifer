// Starts a cloudflared quick tunnel to this server and saves its address to .env as TUNNEL_URL, since a quick
// tunnel gets a new random address on every run. The server reads .env only at startup, so restart it after.
// Stop the tunnel with Ctrl+C.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const ENV_FILE = new URL('../.env', import.meta.url);
const PORT = Number(process.env.PORT) || 3000;
// api.trycloudflare.com is the service cloudflared asks for the tunnel, not the tunnel itself.
const ADDRESS_RE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;

async function saveTunnelUrl(url) {
  let contents = '';
  try {
    contents = await readFile(ENV_FILE, 'utf8');
  } catch {}
  const line = `TUNNEL_URL=${url}`;
  contents = /^TUNNEL_URL=.*$/m.test(contents)
    ? contents.replace(/^TUNNEL_URL=.*$/m, line)
    : `${contents.replace(/\n*$/, '\n')}${line}\n`;
  await writeFile(ENV_FILE, contents);
}

const child = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let found = false;

// cloudflared writes its log, including the new address, to stderr; it's passed through as it arrives.
async function watch(chunk, out) {
  out.write(chunk);
  if (found) return;
  const match = ADDRESS_RE.exec(chunk.toString());
  if (!match) return;
  found = true;
  if (process.env.TUNNEL_URL?.trim() === match[0]) {
    console.log(`\nTunnel ready at ${match[0]}, the same address .env already has.\n`);
    return;
  }
  try {
    await saveTunnelUrl(match[0]);
    console.log(`\nSaved TUNNEL_URL=${match[0]} to .env. Restart the server (npm start) so it uses the new address.\n`);
  } catch (err) {
    console.log(`\nTunnel ready at ${match[0]}, but .env couldn't be updated (${err.message}). Set TUNNEL_URL to it by hand.\n`);
  }
}

child.stdout.on('data', (chunk) => watch(chunk, process.stdout));
child.stderr.on('data', (chunk) => watch(chunk, process.stderr));

child.on('error', (err) => {
  console.error(err.code === 'ENOENT'
    ? "cloudflared isn't installed or isn't on PATH. Install it (see \"Images and video on Threads and Instagram\" in the README), then open a new terminal."
    : `Couldn't start cloudflared: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
