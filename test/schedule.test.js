import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEDULE, postKind, nextFreeTime, slotProblems, dayStrip, formatTime, formatDay } from '../public/rules.js';

// Local times, as the laptop sees them. 19 Nov 2026 is a Thursday.
const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

test('a post is text, image or video by its files', () => {
  assert.equal(postKind([]), 'text');
  assert.equal(postKind([{ type: 'image/jpeg' }, { type: 'image/png' }]), 'image');
  assert.equal(postKind([{ type: 'video/mp4' }]), 'video');
});

test('text posts go at once when nothing is close, in posting hours', () => {
  assert.equal(nextFreeTime([], 'text', at(19, 13, 30), ['x']), at(19, 13, 30));
  assert.equal(nextFreeTime([], 'text', at(19, 3), ['x']), at(19, 9));
  assert.equal(nextFreeTime([], 'text', at(19, 23, 30), ['x']), at(20, 9));
});

test('text posts are kept 1 hour apart', () => {
  const taken = [{ at: at(19, 13), kind: 'text', platforms: ['bluesky'] }];
  assert.equal(nextFreeTime(taken, 'text', at(19, 13, 20), ['x']), at(19, 14));
  assert.equal(nextFreeTime(taken, 'text', at(19, 12, 30), ['x']), at(19, 14));
  assert.equal(nextFreeTime(taken, 'text', at(19, 14), ['x']), at(19, 14));
});

test('twenty text posts fill the day hour by hour, the rest go the next morning', () => {
  const taken = [];
  for (let i = 0; i < 20; i++) taken.push({ at: nextFreeTime(taken, 'text', at(19, 9), ['x']), kind: 'text', platforms: ['x'] });
  assert.equal(taken[0].at, at(19, 9));
  assert.equal(taken[14].at, at(19, 23));
  assert.equal(taken[15].at, at(20, 9));
  assert.equal(taken[19].at, at(20, 13));
});

test('text and image or video posts only keep apart when they share a platform', () => {
  const video = [{ at: at(19, 13), kind: 'video', platforms: ['youtube', 'x'] }];
  assert.equal(nextFreeTime(video, 'text', at(19, 13, 10), ['x', 'bluesky']), at(19, 14));
  assert.equal(nextFreeTime(video, 'text', at(19, 13, 10), ['bluesky']), at(19, 13, 10));
  const text = [{ at: at(19, 13), kind: 'text', platforms: ['x'] }];
  assert.equal(nextFreeTime(text, 'image', at(19, 12, 30), ['x']), at(19, 14));
  assert.equal(nextFreeTime(text, 'image', at(19, 12, 30), ['instagram']), at(19, 12, 30));
});

test('media goes at once when the time is free', () => {
  assert.equal(nextFreeTime([], 'video', at(19, 10) + 15_000), at(19, 10) + 15_000);
});

test('media waits for posting hours', () => {
  assert.equal(nextFreeTime([], 'video', at(19, 6)), at(19, SCHEDULE.startHour));
  assert.equal(nextFreeTime([], 'image', at(19, 23, 30)), at(20, SCHEDULE.startHour));
  assert.equal(nextFreeTime([], 'image', at(19, 23)), at(19, 23));
});

test('image and video posts are kept 4 hours apart, whatever their kind', () => {
  const taken = [{ at: at(19, 13), kind: 'video' }];
  assert.equal(nextFreeTime(taken, 'image', at(19, 14)), at(19, 17));
  assert.equal(nextFreeTime(taken, 'video', at(19, 10)), at(19, 17));
  assert.equal(nextFreeTime(taken, 'video', at(19, 9)), at(19, 9));
  // A text post elsewhere doesn't hold a video back.
  assert.equal(nextFreeTime([{ at: at(19, 9), kind: 'text', platforms: ['x'] }], 'video', at(19, 9), ['youtube']), at(19, 9));
});

test('chained posts push the next one past all of them', () => {
  const taken = [{ at: at(19, 9), kind: 'image' }, { at: at(19, 13), kind: 'video' }];
  assert.equal(nextFreeTime(taken, 'image', at(19, 9)), at(19, 17));
});

test('a kind that has reached its daily limit moves to the next day', () => {
  const taken = [{ at: at(19, 9), kind: 'video' }, { at: at(19, 13), kind: 'video' }];
  assert.equal(nextFreeTime(taken, 'video', at(19, 9)), at(20, 9));
  // The other kind still fits that day.
  assert.equal(nextFreeTime(taken, 'image', at(19, 9)), at(19, 17));
});

test('a late post that pushes past the day\'s end rolls to the next morning', () => {
  const taken = [{ at: at(19, 21), kind: 'image' }];
  assert.equal(nextFreeTime(taken, 'video', at(19, 20)), at(20, 9));
});

test('the gap holds across midnight', () => {
  const taken = [{ at: at(19, 23), kind: 'video' }];
  assert.equal(nextFreeTime(taken, 'image', at(20, 1)), at(20, 9));
  const early = [{ at: at(20, 9), kind: 'video' }];
  assert.equal(nextFreeTime(early, 'image', at(19, 22)), at(19, 22));
});

test('a picked time in the past is refused', () => {
  const r = slotProblems([], 'text', at(19, 10), at(19, 11));
  assert.equal(r.past, true);
});

test('a picked time too close to another post warns and offers the next free time', () => {
  const taken = [{ at: at(19, 13), kind: 'video' }];
  const r = slotProblems(taken, 'image', at(19, 15, 30), at(19, 8));
  assert.equal(r.past, false);
  assert.match(r.warnings[0], /2½ hours after the video at 1:00 PM/);
  assert.match(r.warnings.at(-1), /4 hours apart/);
  assert.equal(r.nextFree, at(19, 17));
});

test('a picked time warns outside posting hours and over the daily limit', () => {
  const taken = [{ at: at(19, 9), kind: 'video' }, { at: at(19, 13), kind: 'video' }];
  const late = slotProblems([], 'video', at(19, 23, 30), at(19, 8));
  assert.match(late.warnings[0], /11:30 PM is outside posting hours \(9:00 AM to 11:00 PM\)/);
  const full = slotProblems(taken, 'video', at(19, 18), at(19, 8));
  assert.match(full.warnings[0], /Thu 19 Nov already has 2 videos/);
  assert.equal(full.nextFree, at(20, 9));
});

test('a text post warns near another text post, and near an image or video on the same platform', () => {
  const taken = [{ at: at(19, 13), kind: 'text', platforms: ['bluesky'] }, { at: at(19, 16), kind: 'video', platforms: ['youtube', 'x'] }];
  const nearText = slotProblems(taken, 'text', at(19, 13, 30), at(19, 8), ['x']);
  assert.match(nearText.warnings[0], /30 minutes after the text post at 1:00 PM/);
  assert.match(nearText.warnings.at(-1), /Text posts are kept 1 hour apart/);
  assert.equal(nearText.nextFree, at(19, 14));
  const nearVideo = slotProblems(taken, 'text', at(19, 15, 30), at(19, 8), ['x']);
  assert.match(nearVideo.warnings.at(-1), /on the same platform are kept 1 hour apart/);
  assert.deepEqual(slotProblems(taken, 'text', at(19, 15, 30), at(19, 8), ['bluesky']).warnings, []);
  assert.match(slotProblems([], 'text', at(19, 7), at(19, 6), ['x']).warnings[0], /outside posting hours/);
});

test('a free time has no warnings', () => {
  const r = slotProblems([{ at: at(19, 9), kind: 'image' }], 'video', at(19, 13), at(19, 8));
  assert.deepEqual(r.warnings, []);
  assert.equal(r.nextFree, null);
});

test('the day strip shows the day\'s posts and merged too-close ranges', () => {
  const taken = [{ at: at(19, 11), kind: 'video' }, { at: at(19, 13), kind: 'image' }, { at: at(20, 10), kind: 'video' }];
  const strip = dayStrip(taken, 'video', at(19, 15));
  assert.equal(strip.start, at(19, 9));
  assert.equal(strip.end, at(19, 23));
  assert.equal(strip.posts.length, 2);
  assert.deepEqual(strip.tooClose, [{ from: at(19, 9), to: at(19, 17) }]);
  assert.equal(strip.full, false);
  // A text post on other platforms isn't held back by them; another text post holds it 1 hour either side.
  assert.equal(dayStrip(taken.map((p) => ({ ...p, platforms: ['youtube'] })), 'text', at(19, 15), ['x']).tooClose.length, 0);
  assert.deepEqual(dayStrip([{ at: at(19, 12), kind: 'text', platforms: ['x'] }], 'text', at(19, 15), ['bluesky']).tooClose, [{ from: at(19, 11), to: at(19, 13) }]);
});

test('the day strip says when a kind is full that day', () => {
  const taken = [{ at: at(19, 9), kind: 'image' }, { at: at(19, 14), kind: 'image' }];
  assert.equal(dayStrip(taken, 'image', at(19, 12)).full, true);
  assert.equal(dayStrip(taken, 'video', at(19, 12)).full, false);
});

test('times and days are written the same everywhere', () => {
  assert.equal(formatTime(at(19, 0, 5)), '12:05 AM');
  assert.equal(formatTime(at(19, 15, 30)), '3:30 PM');
  assert.equal(formatDay(at(19, 10)), 'Thu 19 Nov');
});
