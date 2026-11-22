import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {maintainStorage,diskBytes,managedPath,storageBusy,removeImportedFiles} from './workbench-storage.mjs';
import {openWorkbench} from './workbench-store.mjs';

const root=fileURLToPath(new URL('.',import.meta.url));
const apply=process.argv.includes('--apply');
if(storageBusy(root))throw new Error('请等待导出结束再清理');
const store=openWorkbench(root,{},{});
const state=JSON.parse(fs.readFileSync(path.join(root,'workspace/state.json'),'utf8'));
const previous=process.argv.includes('--retry-report')?JSON.parse(fs.readFileSync(path.join(root,'storage-maintenance-report.json'),'utf8')).deletedAssets:[];
const candidates=[...state.media.filter(asset=>asset.removedAt),...previous.filter(asset=>!state.media.some(item=>item.id===asset.id))];
const removed=candidates.map(asset=>{
  const references=[...state.drafts,...state.templates].filter(item=>item.audioId===asset.id||item.backgrounds?.some(slot=>slot.assetId===asset.id));
  return {id:asset.id,name:asset.name,references:references.map(item=>item.name),bytes:[`workspace/media/${asset.id}`,`assets/frames/${asset.id}`].reduce((sum,relative)=>sum+diskBytes(managedPath(root,relative)),0)};
});
const beforeBytes=diskBytes(root);
const caches=maintainStorage(root,{clearCaches:true,dryRun:!apply});
const deleted=[];
if(apply&&process.argv.includes('--removed'))for(const asset of removed.filter(asset=>!asset.references.length)){
  if(state.media.some(item=>item.id===asset.id))store.update({action:'asset-delete',assetId:asset.id});
  else removeImportedFiles(root,asset.id);
  deleted.push(asset);
}
const report={at:new Date().toISOString(),applied:apply,beforeBytes,afterBytes:diskBytes(root),caches,removedAssets:removed,deletedAssets:deleted};
if(apply)fs.writeFileSync(path.join(root,'storage-maintenance-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
