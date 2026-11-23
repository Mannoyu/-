export const FILMSTRIP_WIDTH = 760;
export const PREVIEW_CARD_WIDTH = 630;
export const PREVIEW_CARD_HEIGHT = PREVIEW_CARD_WIDTH * 414 / 600;
const CARD_HEIGHT = 428;
const ROW_Y = 454;
const GAP = 20;
const LIFT_START = .56;
const LIFT_END = 1.44;
const HANDOFF = .41;
const EJECT_DURATION = 1.06;
const PREVIEW_FADE_DURATION = .55;

const fullCard = {x:0, y:0, scale:1, brightness:1};
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, progress) => a + (b - a) * progress;
const progress = (time, start, end) => clamp((time - start) / (end - start));
const easeBetween = (time, start, end) => ease(progress(time, start, end));
const interpolate = (from, to, progress) => ({
  x:mix(from.x, to.x, progress),
  y:mix(from.y, to.y, progress),
  scale:mix(from.scale, to.scale, progress),
  brightness:mix(from.brightness, to.brightness, progress),
});

export function filmstripHandoff(raw) {
  const time = raw * EJECT_DURATION;
  return {background: easeBetween(time, .25, .68), reveal: easeBetween(time, .17, .41)};
}

function ejectCard(time) {
  const unit = PREVIEW_CARD_WIDTH / 498;
  const press = easeBetween(time, 0, .09);
  const launch = 1 - (1 - progress(time, .09, .28)) ** 2;
  const fall = progress(time, .28, .91);
  const retreat = progress(time, .17, .91);
  const depth = retreat * retreat * (2 - retreat);
  const turn = easeBetween(time, .22, .91);
  return {
    x: (-28 * launch - 66 * depth) * unit,
    y: (time < .28 ? 8 * press * (1 - launch) - 88 * launch : mix(-88, 310, fall ** 2)) * unit,
    z: (-112 * launch - 154 * depth) * unit,
    pitch: -13 * launch + 41 * turn,
    yaw: 8 * launch + 16 * turn,
    roll: -2 - 5 * launch - 7 * turn,
    compression: 1 - .024 * press * (1 - launch),
    opacity: 1 - easeBetween(time, .59, .91),
  };
}

export function createFilmstrip(count, {eject = false} = {}) {
  const width = eject ? PREVIEW_CARD_WIDTH : FILMSTRIP_WIDTH;
  const thumbWidth = (width - GAP * 2) / 3;
  const thumbScale = thumbWidth / width;
  const rowY = eject ? PREVIEW_CARD_HEIGHT + 30 : ROW_Y;
  const positions = Array.from({length:count}, (_, rank) => rank === 0 ? fullCard : ({
    x:(rank - 1) * (thumbWidth + GAP), y:rowY, scale:thumbScale, brightness:.96,
  }));
  const openingWidth = Math.min(thumbWidth, (width - GAP * (count - 1)) / count);
  const openingScale = openingWidth / width;
  const openingY = ROW_Y + CARD_HEIGHT * (thumbScale - openingScale) / 2;

  function rowCard(raw) {
    const time = raw * EJECT_DURATION;
    if (time < .49) {
      const leave = easeBetween(time, .31, .49);
      return {rank:1, ...positions[1], y:rowY - 15 * leave, opacity:1 - leave, layer:8, captionOpacity:1};
    }
    const join = easeBetween(time, .69, .96);
    const last = positions[count - 1];
    return {rank:0, ...last, x:last.x + 24 * (1 - join), y:rowY + 15 * (1 - join), opacity:join, layer:8, captionOpacity:1};
  }

  function cardPose(time, rank, raw, openingRank) {
    const nextRank = (rank + count - 1) % count;
    const position = positions[rank];
    let pose = position;
    let opacity = 1;
    let shape = {};
    let layer = 10 - rank;
    if (eject) {
      shape.roll = rank === 0 ? -2 : 0;
      if (count > 1 && raw > 0) {
        const seconds = raw * EJECT_DURATION;
        if (rank === 0) {
          pose = {...fullCard, ...ejectCard(seconds)};
          opacity = pose.opacity;
        } else if (rank === 1) {
          pose = fullCard;
          opacity = filmstripHandoff(raw).reveal;
          shape.roll = -2;
          layer = 11;
        } else {
          pose = interpolate(position, positions[nextRank], easeBetween(seconds, .46, .78));
        }
      }
    } else if (count > 1 && raw > 0) {
      const offset = rank === 0 ? 0 : rank === 1 ? .08 : .17;
      const progress = ease((raw - offset) / (1 - offset));
      pose = interpolate(position, positions[nextRank], progress);
      // Keep the two moving cards apart as the incoming card lifts across the outgoing one.
      if (rank === 0) pose.x += Math.sin(Math.PI * progress) * 38;
      if (raw >= HANDOFF) layer = 10 - nextRank;
    }
    if (eject && openingRank !== null) {
      opacity *= ease(time / PREVIEW_FADE_DURATION);
    } else if (!eject && openingRank !== null && time < LIFT_END) {
      if (count === 1) {
        opacity = ease((time - .12) / .4);
        pose = {...pose, y:18 * (1 - opacity)};
      } else {
        opacity = ease((time - .12 - openingRank * .065) / .23);
        const slideStart = openingRank === 0 ? LIFT_START : .76;
        const progress = ease((time - slideStart) / (LIFT_END - slideStart));
        const opening = {x:openingRank * (openingWidth + GAP), y:openingY + 16 * (1 - opacity), scale:openingScale, brightness:.94};
        const targetY = pose.y;
        pose = interpolate(opening, pose, progress);
        // Give the large card a head start vertically so the remaining row can slide in underneath.
        if (openingRank === 0) pose.y = mix(opening.y, targetY, ease((time - LIFT_START) / .65));
      }
    }
    const captionOpacity = eject ? 1 : ease((pose.scale - .48) / .42);
    return {...shape, ...pose, opacity, layer, captionOpacity};
  }

  return {cardPose, rowCard};
}
