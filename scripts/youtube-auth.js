// One-time YouTube sign-in: `npm run youtube-auth`.
// Runs Google's OAuth flow for installed apps (loopback redirect + PKCE), then saves
// YOUTUBE_REFRESH_TOKEN to .env so the server can upload without signing in again.
import http from 'node:http';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

// readonly lets the server check when a new video has finished processing (see platforms/youtube.js).
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
const ENV_FILE = new URL('../.env', import.meta.url);
const TIMEOUT_MS = 5 * 60_000;

const clientId = process.env.YOUTUBE_CLIENT_ID?.trim();
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();
if (!clientId || !clientSecret) {
  console.error('Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first. The README explains where to get them.');
  process.exit(1);
}

const base64url = (buf) => buf.toString('base64url');
const verifier = base64url(crypto.randomBytes(32));
const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
const state = base64url(crypto.randomBytes(16));

function openBrowser(url) {
  const command = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(command, () => {});
}

async function saveRefreshToken(token) {
  let contents = '';
  try {
    contents = await readFile(ENV_FILE, 'utf8');
  } catch {}
  const line = `YOUTUBE_REFRESH_TOKEN=${token}`;
  contents = /^YOUTUBE_REFRESH_TOKEN=.*$/m.test(contents)
    ? contents.replace(/^YOUTUBE_REFRESH_TOKEN=.*$/m, line)
    : `${contents.replace(/\n*$/, '\n')}${line}\n`;
  await writeFile(ENV_FILE, contents);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/callback') {
    res.writeHead(404);
    return res.end();
  }
  const finish = (status, message, exitCode) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>YouTube sign-in</title><body style="font:16px system-ui;padding:40px">${message}</body>`);
    server.close();
    process.exitCode = exitCode;
  };

  if (url.searchParams.get('state') !== state) return finish(400, 'Sign-in failed: the request did not match. Run the command again.', 1);
  if (url.searchParams.get('error')) {
    console.error(`Google returned an error: ${url.searchParams.get('error')}`);
    return finish(400, 'Sign-in was cancelled or refused. You can close this tab.', 1);
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        code: url.searchParams.get('code'),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || data.error || `HTTP ${response.status}`);
    if (!data.refresh_token) throw new Error('Google did not return a refresh token. Remove this app at myaccount.google.com/permissions and try again.');
    await saveRefreshToken(data.refresh_token);
    console.log('Saved YOUTUBE_REFRESH_TOKEN to .env. Restart the server to start uploading.');
    finish(200, 'YouTube is connected. You can close this tab and restart the Social Post server.', 0);
  } catch (err) {
    console.error(`Sign-in failed: ${err.message}`);
    finish(500, 'Sign-in failed. Check the terminal for details.', 1);
  }
});

let redirectUri;
server.listen(0, '127.0.0.1', () => {
  redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    // offline + consent makes Google issue a refresh token every time.
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  console.log('Opening Google sign-in in your browser. If it does not open, visit:\n');
  console.log(`${authUrl}\n`);
  console.log('Choose the Google account or brand account that owns your YouTube channel.');
  openBrowser(authUrl.toString());
});

setTimeout(() => {
  console.error('Timed out waiting for sign-in. Run the command again.');
  process.exit(1);
}, TIMEOUT_MS).unref();
