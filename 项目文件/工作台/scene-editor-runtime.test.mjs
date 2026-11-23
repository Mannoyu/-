import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneElements} from './scene-editor-runtime.js';
import {normalizeElements} from './scene-editor-model.mjs';

test('default editable layers leave template styles untouched, explicit edits restore on seek',t=>{
  const style={translate:'',scale:'',rotate:'',opacity:'',visibility:'',display:'',fontSize:'',color:'',backgroundImage:''};
  const writes=[];
  const node={style:new Proxy({...style},{set(target,key,value){writes.push(key);target[key]=value;return true;}}),querySelector:()=>null};
  const previous=globalThis.document;
  globalThis.document={getElementById:()=>null,querySelector:selector=>selector==='#world-title strong'?node:null,querySelectorAll:()=>[]};
  t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  const baseline=createSceneElements({elements:normalizeElements()});
  baseline.render(0);assert.deepEqual(node.style,style);
  baseline.reset();assert.deepEqual(node.style,style);
  assert.deepEqual(writes,[]);
  const edited=createSceneElements({elements:{title:{x:50,scale:1.2}}});
  edited.render(3);assert.equal(node.style.translate,'50px 0px');assert.equal(node.style.scale,'1.2');
  node.style.opacity='0.4';
  edited.reset();assert.deepEqual(node.style,{...style,opacity:'0.4'});
});
