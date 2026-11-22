import fs from 'node:fs';
import path from 'node:path';

const day = 86400000;
const active = new Map();
export const storagePolicy = {videoBytes: 2 * 1024 ** 3, audioBytes: 512 * 1024 ** 2, days: 7, sceneDays: 7};

// Keep all inputs and caches alive until the complete export (including muxing) ends.
export function holdStorage(root) {
  root = path.resolve(root);
  if (storageBusy(root)) throw new Error('另一份工作台正在导出，请稍后重试');
  const lock=managedPath(root,`workspace/export-${process.pid}.lock`);
  fs.writeFileSync(lock,String(process.pid));
  active.set(root, (active.get(root) || 0) + 1);
  let released = false;
  return () => { if (!released) { released = true; active.set(root, active.get(root) - 1); removeManaged(root,lock); } };
}
function alive(pid) {try {process.kill(pid,0);return true;} catch(error) {return error.code!=='ESRCH';}}
export function storageBusy(root) {
  if ((active.get(path.resolve(root)) || 0) > 0) return true;
  const folder=managedPath(root,'workspace');
  return fs.existsSync(folder)&&fs.readdirSync(folder).some(name=>{
    const match=/^export-(\d+)\.lock$/.exec(name);
    return match&&alive(Number(match[1]));
  });
}

export function beginImport(root) {
  const file=managedPath(root,`workspace/import-${process.pid}.json`);
  const ids=[];
  return {
    track(id) {ids.push(id);fs.writeFileSync(file,JSON.stringify({pid:process.pid,ids}));return id;},
    finish() {removeManaged(root,file);},
    rollback() {for(const id of ids)removeImportedFiles(root,id);removeManaged(root,file);},
  };
}
export function recoverImports(root) {
  const folder=managedPath(root,'workspace');
  const state=JSON.parse(fs.readFileSync(path.join(folder,'state.json'),'utf8'));
  const registered=new Set(state.media.map(asset=>asset.id));
  for(const name of fs.readdirSync(folder).filter(name=>/^import-\d+\.json$/.test(name))){
    const file=managedPath(root,`workspace/${name}`);
    const receipt=JSON.parse(fs.readFileSync(file,'utf8'));
    if(alive(receipt.pid))continue;
    for(const id of receipt.ids)if(!registered.has(id))removeImportedFiles(root,id);
    removeManaged(root,file);
  }
}

export function managedPath(root, relative) {
  const base = fs.realpathSync(root);
  const target = path.resolve(base, relative);
  const inside = value => { const rel = path.relative(base, value); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); };
  if (!inside(target)) throw new Error('清理路径超出项目目录');
  let current = base;
  for (const part of path.relative(base, target).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && (fs.lstatSync(current).isSymbolicLink() || !inside(fs.realpathSync(current)))) {
      throw new Error('清理路径包含链接或超出项目目录');
    }
  }
  return target;
}

export function diskBytes(file) {
  if (!fs.existsSync(file)) return 0;
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error('不清理链接目录');
  return stat.isDirectory() ? fs.readdirSync(file).reduce((sum, name) => sum + diskBytes(path.join(file, name)), 0) : stat.size;
}

// Node's recursive rm can silently leave directories under this Windows Unicode path.
// Explicit unlink/rmdir also lets us verify the actual outcome before dropping metadata.
export function removeManaged(root, relative) {
  const target=managedPath(root,relative);
  function remove(file) {
    if(!fs.existsSync(file))return;
    const stat=fs.lstatSync(file);
    if(stat.isSymbolicLink())throw new Error('不清理链接目录');
    if(stat.isDirectory()){
      for(const name of fs.readdirSync(file))remove(path.join(file,name));
      fs.rmdirSync(file);
    }else fs.unlinkSync(file);
    if(fs.existsSync(file))throw new Error(`本地文件未能删除：${file}`);
  }
  remove(target);
}

export function removeImportedFiles(root, id) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) throw new Error('无效的导入素材编号');
  const targets = [`workspace/media/${id}`, `assets/frames/${id}`].map(relative => managedPath(root, relative));
  const bytes = targets.reduce((sum, target) => sum + diskBytes(target), 0);
  for (const target of targets) removeManaged(root,target);
  return bytes;
}

// Only generated caches are eligible. Exported videos and source assets are never candidates.
export function maintainStorage(root, {now = Date.now(), clearCaches = false, dryRun = false, policy = storagePolicy} = {}) {
  if (storageBusy(root)) return {freedBytes: 0, removed: [], busy: true};
  const removed = [];
  function prune(relative, limit, ttl, filter) {
    const folder = managedPath(root, relative);
    if (!fs.existsSync(folder)) return;
    const entries = fs.readdirSync(folder).filter(filter).map(name => {
      const file = managedPath(root, `${relative}/${name}`);
      const stat = fs.lstatSync(file);
      return {file, relative: `${relative}/${name}`, bytes: diskBytes(file), time: stat.mtimeMs};
    }).sort((a, b) => b.time - a.time);
    let kept = 0;
    for (const entry of entries) {
      if (!clearCaches && now - entry.time <= ttl && kept + entry.bytes <= limit) { kept += entry.bytes; continue; }
      if (!dryRun) removeManaged(root,entry.file);
      removed.push({path: entry.relative, bytes: entry.bytes});
    }
  }
  prune('.showreel-editor/video-cache', policy.videoBytes, policy.days * day, name => /^[a-f0-9]{64}$/.test(name));
  prune('.showreel-editor/audio', policy.audioBytes, policy.days * day, name => /^[a-f0-9]+(?:\.[a-zA-Z0-9_-]+\.tmp)?\.wav$/.test(name));
  // Recent snapshots have a grace period for open preview tabs. Never clear them on request.
  const clear = clearCaches;
  clearCaches = false;
  prune('workspace/scenes', Infinity, policy.sceneDays * day, name => /^[a-f0-9]{64}\.json$/.test(name));
  clearCaches = clear;
  return {freedBytes: removed.reduce((sum, item) => sum + item.bytes, 0), removed};
}
