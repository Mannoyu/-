export const GLASS_CARD_WIDTH = 650;
export const GLASS_CARD_HEIGHT = GLASS_CARD_WIDTH * 9 / 16;
const GAP = 12;
const ROW_Y = GLASS_CARD_HEIGHT + 32;
const THUMB_WIDTH = (GLASS_CARD_WIDTH - 2 * GAP) / 3;
const THUMB_SCALE = THUMB_WIDTH / GLASS_CARD_WIDTH;
export const GLASS_DECK_HEIGHT = ROW_Y + GLASS_CARD_HEIGHT * THUMB_SCALE;

const progress = (time, start, end) => Math.max(0, Math.min(1, (time - start) / (end - start)));
const ease = x => x * x * (3 - 2 * x);
const out = x => 1 - (1 - x) ** 3;
const mix = (a, b, p) => a + (b - a) * p;
const rowX = rank => (rank - 1) * (THUMB_WIDTH + GAP);

export function glassFilmstripHandoff(raw) {
  const time = raw * .61;
  return {background:ease(progress(time, .125, .565)), reveal:out(raw)};
}

export function createGlassFilmstrip(count) {
  function cardPose(time, rank, raw, opening) {
    if (raw > 0 && count > 1) {
      const seconds = raw * .61;
      if (rank === 0) {
        const fade = ease(progress(seconds, .15, .49));
        const shrink = ease(progress(seconds, 0, .49)) * .04;
        return {x:GLASS_CARD_WIDTH * shrink / 2, y:GLASS_CARD_HEIGHT * shrink / 2,
          scale:1-shrink, opacity:1-fade, layer:9, captionOpacity:1};
      }
      if (rank === 1) {
        const peak = .73;
        const lift = out(progress(raw, 0, peak));
        const settle = ease(progress(raw, peak, 1));
        return {x:mix(0, -GLASS_CARD_WIDTH*.01, lift)*(1-settle),
          y:mix(ROW_Y, -GLASS_CARD_HEIGHT*.01, lift)*(1-settle),
          scale:mix(mix(THUMB_SCALE, 1.02, lift), 1, settle), opacity:1, layer:10,
          captionOpacity:ease(progress(raw, .42, 1))};
      }
      return {x:mix(rowX(rank), rowX(rank-1), out(progress(seconds,.10,.45))),
        y:ROW_Y, scale:THUMB_SCALE, opacity:1, layer:5-rank, captionOpacity:0};
    }
    if (rank === 0) {
      const entry = opening ? out(progress(time, 0, .58)) : 1;
      return {x:GLASS_CARD_WIDTH*.0125*(1-entry), y:22*(1-entry), scale:mix(.975,1,entry),
        opacity:entry, layer:10, captionOpacity:opening ? out(progress(time,.22,.55)) : 1};
    }
    const slot = rank-1;
    const start = .42+slot*.12;
    const slide = opening ? out(progress(time,start,start+.61-slot*.075)) : 1;
    return {x:mix(rowX(count-1)+8*rank,rowX(rank),slide), y:ROW_Y+(-6+slot*4)*(1-slide),
      scale:THUMB_SCALE, opacity:opening ? ease(progress(time,.31,.48)) : 1, layer:5-rank, captionOpacity:0};
  }

  function rowCard(raw) {
    const join = out(progress(raw*.61,.26,.51));
    return {rank:0, x:rowX(count-1), y:ROW_Y+12*(1-join), scale:THUMB_SCALE,
      opacity:join, layer:1, captionOpacity:0};
  }

  return {cardPose,rowCard};
}
