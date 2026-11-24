// Each platform's extra fields (YouTube's title, Instagram's Post as, X's thread...), shared by the web page
// (public/js/fields.js draws them) and the phone app (mobile/src/Fields.js). Plain data: no page code here.
import { LANGUAGES as ALL_LANGUAGES, SUBTITLE_LANGUAGES } from './rules.js';
import { SLIDE_STYLES, SLIDE_BACKGROUNDS } from './slides.js';

const YOUTUBE_CATEGORIES = [
  ['1', 'Film & Animation'], ['2', 'Autos & Vehicles'], ['10', 'Music'], ['15', 'Pets & Animals'], ['17', 'Sports'],
  ['19', 'Travel & Events'], ['20', 'Gaming'], ['22', 'People & Blogs'], ['23', 'Comedy'], ['24', 'Entertainment'],
  ['25', 'News & Politics'], ['26', 'Howto & Style'], ['27', 'Education'], ['28', 'Science & Technology'], ['29', 'Nonprofits & Activism'],
];
const LANGUAGES = [['', 'Not set'], ...ALL_LANGUAGES];
// The audio language follows "Video is in", so it offers the same languages subtitles support.
const AUDIO_LANGUAGES = [['', 'Not set'], ...SUBTITLE_LANGUAGES];
const singleVideo = ({ media, values }) => media.length === 1 && media[0].type.startsWith('video/') && values.postAs !== 'story';
const hasImage = ({ media }) => media.some((m) => !m.type.startsWith('video/'));
const hasMedia = ({ media }) => media.length > 0;
// A text-only post goes to Instagram as slides of its text (slides.js).
const textOnly = ({ media }) => media.length === 0;

// Each platform's tab is built from this list. `sticky` values are remembered between posts; `when`
// hides (and stops sending) fields that don't apply to what's attached; `beforeText` goes above the
// platform's text box; `textLabel` names that box.
export const FIELDS = {
  youtube: {
    textLabel: 'Description',
    main: [
      { key: 'title', type: 'text', label: 'Title', wide: true, beforeText: true },
      // Not remembered: every video starts private, and "Finish by hand" links to YouTube Studio to make it public.
      { key: 'privacy', type: 'select', label: 'Visibility', initial: 'private',
        choices: [['public', 'Public'], ['unlisted', 'Unlisted'], ['private', 'Private']] },
      { key: 'audioLanguage', type: 'select', label: 'Audio language', sticky: true, initial: '', choices: AUDIO_LANGUAGES,
        hint: "Set from the video's language under Subtitles." },
      { key: 'category', type: 'select', label: 'Category', initial: '', choices: [['', 'YouTube default (People & Blogs)'], ...YOUTUBE_CATEGORIES] },
      { key: 'tags', type: 'text', label: 'Tags', placeholder: 'Comma-separated, e.g. lyric video, hindi song' },
      { key: 'thumbnail', type: 'image', label: 'Custom thumbnail', wide: true,
        hint: 'JPEG or PNG, ideally 1280×720, up to 2 MB. Needs a phone-verified channel.' },
      { key: 'madeForKids', type: 'check', label: 'Made for kids', sticky: true },
      { key: 'synthetic', type: 'check', label: 'Altered or synthetic content (realistic AI-generated or edited footage)' },
    ],
    more: [
      { key: 'recordingDate', type: 'date', label: 'Recording date' },
      { key: 'language', type: 'select', label: 'Title and description language', sticky: true, initial: 'en', choices: LANGUAGES },
    ],
    info: 'Videos go up private unless you choose otherwise; after posting, "Finish by hand" links to YouTube Studio to make one public. Until your Google API project passes YouTube\'s audit, YouTube may keep uploads private whatever you choose here (see README).',
  },
  instagram: {
    textLabel: 'Caption',
    main: [
      // Hidden for text-only posts: a Story takes one image, and text becomes a carousel.
      { key: 'postAs', type: 'select', label: 'Post as', initial: 'feed', choices: [['feed', 'Post or Reel'], ['story', 'Story']], when: hasMedia },
      { key: 'slideStyle', type: 'slideStyle', label: 'Slide style', sticky: true, initial: 'centred', wide: true, when: textOnly,
        choices: SLIDE_STYLES.map((s) => [s.id, s.name]) },
      { key: 'slideBackground', type: 'slideBackground', label: 'Background', sticky: true, initial: 'paper', wide: true, when: textOnly,
        choices: SLIDE_BACKGROUNDS.map((b) => [b.id, b.name]) },
      { key: 'coverSeconds', type: 'number', label: 'Cover frame (seconds into the video)', placeholder: '0', when: singleVideo },
      { key: 'shareToFeed', type: 'check', label: 'Also share to Feed (your profile grid and followers\' home feeds)', sticky: true, initial: true, when: singleVideo },
      { key: 'cover', type: 'image', label: 'Or upload a cover image', hint: 'Replaces the frame above.', wide: true, when: singleVideo },
      { key: 'altText', type: 'text', label: 'Alt text (images)', wide: true, placeholder: 'Describe the image for people using screen readers', when: hasImage },
      { key: 'aiGenerated', type: 'check', label: 'Label as AI-generated' },
    ],
    more: [
      { key: 'audioName', type: 'text', label: 'Audio name (Reels)', placeholder: 'Original audio', when: singleVideo },
      { key: 'trial', type: 'select', label: 'Trial reel', initial: 'off', when: singleVideo, choices: [
        ['off', 'Off'], ['manual', 'Show to non-followers first; I\'ll share it later'], ['auto', 'Show to non-followers first; share it if it does well']] },
    ],
    info: '@mentions in the caption link to those accounts and notify them. Music from Instagram\'s library, filters and stickers can\'t be added through the API.',
  },
  x: {
    textLabel: 'Post',
    main: [
      { key: 'thread', type: 'check', label: 'Split long posts into a numbered thread', sticky: true, initial: true },
      { key: 'altText', type: 'text', label: 'Alt text (images)', placeholder: 'Describe the image', when: hasImage },
      { key: 'madeWithAi', type: 'check', label: 'Label as made with AI' },
    ],
  },
};

export const fieldsOf = (id) => [...(FIELDS[id]?.main ?? []), ...(FIELDS[id]?.more ?? [])];
export const initialOf = (f) => f.initial ?? (f.type === 'check' ? false : '');
// A remembered value, unless the list no longer offers it (e.g. an audio language from before the Hindi/English list).
export const savedOr = (f, saved) => saved === undefined || (f.choices && !f.choices.some(([v]) => v === saved))
  ? initialOf(f) : saved;
