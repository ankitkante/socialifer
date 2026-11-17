import { request, poll, env, hasEnv, UPLOAD_TIMEOUT, ApiError } from './http.js';
import { isVideo } from '../public/rules.js';

const ENV = ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_AUTHOR_URN'];
const API = 'https://api.linkedin.com/rest';

// LinkedIn's Posts API uses "little text": reserved characters must be escaped or the
// post is silently truncated. Simple letter/number hashtags become LinkedIn's hashtag
// template; anything else (e.g. #with_underscore) is kept as escaped plain text.
export function toLittleText(text) {
  return text.replace(/(?<=^|\s)#([\p{L}\p{N}]+)(?![\p{L}\p{N}_])|[\\|{}@[\]()<>#*_~]/gu, (match, tag) =>
    tag ? `{hashtag|\\#|${tag}}` : `\\${match}`,
  );
}

function headers() {
  return {
    Authorization: `Bearer ${env('LINKEDIN_ACCESS_TOKEN')}`,
    'Content-Type': 'application/json',
    // LinkedIn retires API versions after about a year; bump this if you get a version error.
    'LinkedIn-Version': env('LINKEDIN_VERSION') || '202611',
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

async function uploadImage(m) {
  const { data } = await request(`${API}/images?action=initializeUpload`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ initializeUploadRequest: { owner: env('LINKEDIN_AUTHOR_URN') } }),
  });
  const { uploadUrl, image } = data.value;
  await request(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: headers().Authorization },
    body: await m.blob(),
    timeout: UPLOAD_TIMEOUT,
  });
  return image;
}

async function uploadVideo(m) {
  const { data } = await request(`${API}/videos?action=initializeUpload`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      initializeUploadRequest: { owner: env('LINKEDIN_AUTHOR_URN'), fileSizeBytes: m.size, uploadCaptions: false, uploadThumbnail: false },
    }),
  });
  const { video, uploadToken, uploadInstructions } = data.value;

  // LinkedIn splits large videos into byte ranges; each part's ETag confirms it arrived.
  const blob = await m.blob();
  const partIds = [];
  for (const part of uploadInstructions) {
    const { headers: res } = await request(part.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: blob.slice(part.firstByte, part.lastByte + 1),
      timeout: UPLOAD_TIMEOUT,
      retries: 3,
    });
    partIds.push(res.get('etag'));
  }

  await request(`${API}/videos?action=finalizeUpload`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ finalizeUploadRequest: { video, uploadToken: uploadToken || '', uploadedPartIds: partIds } }),
  });
  await poll(async () => {
    const { data: status } = await request(`${API}/videos/${encodeURIComponent(video)}`, { headers: headers() });
    if (status.status === 'AVAILABLE') return true;
    if (status.status === 'PROCESSING_FAILED') {
      const reason = status.processingFailureReason ? ` (${status.processingFailureReason})` : '';
      throw new ApiError(`LinkedIn could not process ${m.name}${reason}`);
    }
  }, { what: `LinkedIn to process ${m.name}` });
  return video;
}

async function buildContent(media) {
  if (media.length === 0) return null;
  if (isVideo(media[0])) return { media: { id: await uploadVideo(media[0]) } };
  const ids = [];
  for (const m of media) ids.push(await uploadImage(m));
  return ids.length === 1 ? { media: { id: ids[0] } } : { multiImage: { images: ids.map((id) => ({ id })) } };
}

export default {
  id: 'linkedin',
  name: 'LinkedIn',
  limit: 3000,
  media: {
    maxImages: 20, maxVideos: 1, maxItems: 20, mix: false, imageMB: null, videoMB: 5000, videoMinSeconds: 3, videoMaxSeconds: 30 * 60,
    // The Images API takes only these formats.
    imageTypes: ['image/jpeg', 'image/png', 'image/gif'],
    imageTypesLabel: 'LinkedIn only accepts JPEG, PNG and GIF images',
  },
  envVars: ENV,
  isConfigured: () => hasEnv(...ENV),
  async post(text, media) {
    const content = await buildContent(media);
    const { headers: res } = await request(`${API}/posts`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        author: env('LINKEDIN_AUTHOR_URN'),
        commentary: toLittleText(text),
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
        ...(content && { content }),
      }),
    });
    const urn = res.get('x-restli-id');
    return { url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : null };
  },
};
