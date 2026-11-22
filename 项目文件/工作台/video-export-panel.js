const byId = id => document.getElementById(id);
const dialog = byId('video-export-dialog');
const form = byId('video-export-form');
const mode = form.elements.mode;
const value = form.elements.value;
const status = byId('video-export-status');
const progress = byId('video-export-progress');
const player = byId('video-export-player');
const download = byId('video-export-download');
const cancel = byId('video-export-cancel');
const submit = form.querySelector('button[type="submit"]');
const editor = () => window.__showreelEditor;
const projectData = fetch('/api/project').then(response => response.json());
let polling = false;

async function request(body) {
  const {token} = await projectData;
  const headers = {'x-showreel-token': token};
  const options = body ? {method: 'POST', headers: {...headers, 'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {headers};
  const response = await fetch('/api/video-export', options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

function describe() {
  const project = editor()?.project;
  if (!project) return;
  const seconds = mode.value === 'minutes' ? value.valueAsNumber * 60 : project.duration * (mode.value === 'repeat' ? value.valueAsNumber : 1);
  const valid = Number.isFinite(seconds) && seconds > 0 && seconds <= 3600;
  const formatted = valid ? new Date(Math.round(seconds) * 1000).toISOString().slice(11, 19) : '';
  status.textContent = valid ? `预计时长 ${formatted}` : '请输入有效遍数或分钟数，最长 1 小时';
  submit.disabled = !valid;
}

function updateInputs(resetValue = false) {
  const project = editor()?.project;
  if (!project) return;
  byId('video-export-value-row').hidden = mode.value === 'single';
  value.required = mode.value !== 'single';
  value.disabled = mode.value === 'single';
  value.max = mode.value === 'repeat' ? Math.floor(3600 / project.duration) : 60;
  if (resetValue) value.value = mode.value === 'repeat' ? Math.min(10, value.max) : 30;
  byId('video-export-unit').textContent = mode.value === 'repeat' ? '遍数' : '分钟';
  describe();
}

function showJob(job) {
  if (!job) return;
  const running = job.status === 'running';
  mode.disabled = running;
  value.disabled = running || mode.value === 'single';
  submit.disabled = running;
  cancel.hidden = !running;
  progress.hidden = !running;
  progress.value = job.progress;
  status.textContent = job.error || (running ? `${job.phase} · ${Math.round(job.progress * 100)}%` : job.phase);
  if (job.result) {
    download.hidden = false;
    if (player.getAttribute('src') !== job.result.url) player.src = job.result.url;
    player.hidden = false;
    status.textContent = `导出完成 · 已保存到：${job.result.file}`;
  }
}

async function watch(job) {
  if (polling) return;
  polling = true;
  try {
    showJob(job);
    while (job?.status === 'running') {
      await new Promise(resolve => setTimeout(resolve, 500));
      job = await request();
      showJob(job);
    }
  } finally {
    polling = false;
  }
}

function report(error) {
  status.textContent = error.message;
  progress.hidden = true;
  submit.disabled = false;
}

byId('export').addEventListener('click', async event => {
  event.stopImmediatePropagation();
  if (byId('play').getAttribute('aria-label') === '暂停') byId('play').click();
  dialog.showModal();
  updateInputs();
  try { await watch(await request()); } catch (error) { report(error); }
}, true);

const exact = document.createElement('button');
exact.type = 'button';
exact.textContent = '导出画质预览';
exact.title = '用导出相同的素材和时间点查看画面，实时播放速度取决于设备';
exact.setAttribute('aria-pressed', 'false');
byId('spec').after(exact);
exact.addEventListener('click', async () => {
  const workspace = editor();
  if (!workspace?.ready) return;
  const enabled = exact.getAttribute('aria-pressed') !== 'true';
  if (byId('play').getAttribute('aria-label') === '暂停') byId('play').click();
  workspace.picture.setExactPreview(enabled);
  exact.setAttribute('aria-pressed', String(enabled));
  exact.textContent = enabled ? '导出画质已开启' : '导出画质预览';
  await workspace.seek(workspace.time);
});

mode.addEventListener('change', () => updateInputs(true));
value.addEventListener('input', describe);
byId('video-export-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => player.pause());
cancel.addEventListener('click', () => request({cancel: true}).catch(report));
download.addEventListener('click',()=>request({reveal:true}).catch(report));
form.addEventListener('submit', async event => {
  event.preventDefault();
  const settings = {mode: mode.value, value: value.valueAsNumber, session: editor().session};
  submit.disabled = true;
  player.pause();
  player.hidden = true;
  download.hidden = true;
  try {
    await editor().save();
    await watch(await request(settings));
  } catch (error) { report(error); }
});
