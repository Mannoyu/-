import {SONG as original} from './song-data.js';

const snapshot = new URLSearchParams(globalThis.location?.search).get('draft');
export const SONG = snapshot && /^[a-f0-9]{64}$/.test(snapshot)
  ? await fetch(`workspace/scenes/${snapshot}.json`).then(response => {
    if (!response.ok) throw new Error('无法载入草稿画面');
    return response.json();
  }) : original;
