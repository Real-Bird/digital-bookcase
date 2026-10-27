'use strict';
const $ = id => document.getElementById(id);
const fieldNames = ['title','author','publisher','year','quantity','location','memo'];
let token='', revision='new', books=[], config={}, current={}, pending=null;
let cameraRunning=false, scanLatched=false, scanBusy=false, busy=false, lastLookup='', lookupPage=1;
let lookupGeneration=0;
let cameraEpoch=0, cameraStarting=false, scanTimer=null, cameraDecoder=null, decodePass=0, decodeCount=0;
let photoWorking=false, advancedUnavailable=false;
let libraryPage=1, libraryPageSize=20, libraryPageCount=1;
try { const size=Number(localStorage.getItem('book-list-page-size')); if([20,30,40,50].includes(size))libraryPageSize=size; } catch {}
try { pending=JSON.parse(sessionStorage.getItem('pending-save') || 'null'); } catch { sessionStorage.removeItem('pending-save'); }

class ApiError extends Error {
  constructor(message,status,details){super(message);this.status=status;this.details=details;}
}
async function api(path,body){
  let response;
  try { response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Session-Token':token},body:body===undefined?undefined:JSON.stringify(body)}); }
  catch { throw new ApiError('서버에 연결할 수 없습니다. 실행 창을 확인하고 다시 시도하세요.',0); }
  let data;
  try { data=await response.json(); } catch { throw new ApiError('서버 응답을 확인할 수 없습니다. 다시 시도하세요.',0); }
  if(!response.ok){
    let message=typeof data.detail==='string'?data.detail:'입력 내용을 확인하세요.';
    if(Array.isArray(data.detail)) message=data.detail.map(x=>`${x.loc.at(-1)}: ${x.msg}`).join(' / ');
    throw new ApiError(message,response.status,data.details);
  }
  return data;
}
function notice(message,type=''){ $('notice').textContent=message; $('notice').className='notice '+type; }
function setBusy(value){busy=value; document.body.setAttribute('aria-busy',String(value)); for(const id of ['lookup-button','save-book','next-book','manual','more-results']) $(id).disabled=value;}
function pendingState(value){pending=value; if(value) sessionStorage.setItem('pending-save',JSON.stringify(value)); else sessionStorage.removeItem('pending-save'); $('recovery').hidden=!value; $('book-fields').disabled=!!value; $('isbn-input').disabled=!!value;}
function make(tag,txt,cls){const el=document.createElement(tag); if(txt!==undefined)el.textContent=txt; if(cls)el.className=cls;return el;}
function fill(book={}){
  current={...book};
  for(const key of fieldNames) $(key).value=book[key] ?? (key==='quantity'?1:'');
  $('current-isbn').textContent=book.isbn?'ISBN '+book.isbn:'ISBN 없이 수동 등록';
  $('source-badge').textContent=book.source || '수동 등록';
  $('detail-heading').textContent=book.id?'등록 정보 수정':'도서 정보 확인';
  $('save-book').textContent=book.id?'수정 내용 저장':'서가에 저장 ↗';
  const link=$('detail-link');let safeLink='';
  try{const url=new URL(book.detail_link);if(url.protocol==='https:'&&url.hostname==='www.nl.go.kr')safeLink=url.href;}catch{}
  link.hidden=!safeLink;if(safeLink)link.href=safeLink;else link.removeAttribute('href');
}
function reset(){
  if(pending){notice('이전 저장 요청부터 확인해주세요.','error');return;}
  lookupGeneration++; lastLookup=''; lookupPage=1;
  $('isbn-input').value='';$('candidates').replaceChildren();$('candidates').hidden=true;$('more-results').hidden=true;
  fill();scanLatched=false;notice(cameraRunning?'다음 책의 바코드를 비춰주세요.':'ISBN을 조회하거나 도서 정보를 직접 입력하세요.');
}
function render(){
  $('total-books').textContent=books.length;
  $('total-copies').textContent=books.reduce((sum,b)=>sum+Number(b.quantity),0);
  $('list-count').textContent=books.length+'종';
  const query=$('search').value.toLowerCase().trim();
  const filtered=books.filter(b=>[b.title,b.author,b.isbn,b.location,b.memo].join(' ').toLowerCase().includes(query)).slice().reverse();
  libraryPageCount=Math.max(1,Math.ceil(filtered.length/libraryPageSize));
  libraryPage=Math.max(1,Math.min(libraryPage,libraryPageCount));
  const offset=(libraryPage-1)*libraryPageSize;
  $('page-size').value=String(libraryPageSize);
  $('page-summary').textContent=filtered.length?`${filtered.length}종 중 ${offset+1}–${Math.min(offset+libraryPageSize,filtered.length)}종 · ${libraryPage} / ${libraryPageCount}페이지`:'0종';
  $('page-first').disabled=$('page-prev').disabled=libraryPage===1;
  $('page-last').disabled=$('page-next').disabled=libraryPage===libraryPageCount;
  $('page-numbers').replaceChildren();
  const firstPage=Math.max(1,Math.min(libraryPage-2,libraryPageCount-4));
  for(let page=firstPage;page<=Math.min(libraryPageCount,firstPage+4);page++){
    const button=make('button',String(page),'quiet');button.type='button';button.setAttribute('aria-label',`${page}페이지`);
    if(page===libraryPage)button.setAttribute('aria-current','page');
    button.onclick=()=>{libraryPage=page;render();};$('page-numbers').append(button);
  }
  $('book-list').replaceChildren();$('empty').hidden=!!filtered.length;
  if(!filtered.length){$('empty').querySelector('strong').textContent=query?'검색 결과가 없습니다':'첫 번째 책을 기다리고 있어요';}
  for(const book of filtered.slice(offset,offset+libraryPageSize)){
    const row=make('tr'),info=make('td');info.append(make('strong',book.title),make('small',book.author || '저자 미입력'),make('small',book.isbn || 'ISBN 없음'));
    const pub=make('td');pub.append(make('span',book.publisher || '—'),make('small',book.year || ''));
    const actions=make('td'),edit=make('button','수정','quiet'),remove=make('button','취소','quiet');
    edit.onclick=()=>{if(busy||pending)return notice('진행 중인 작업을 먼저 마쳐주세요.','error');lookupGeneration++;fill(book);$('isbn-input').value=book.isbn;scanLatched=true;$('candidates').hidden=true;$('more-results').hidden=true;notice('등록된 도서를 수정하고 있습니다.');$('book-form').scrollIntoView({behavior:'smooth',block:'center'});};
    remove.onclick=async()=>{
      if(busy||pending)return;
      if(!confirm(`‘${book.title}’의 등록을 취소할까요? 전체 ${book.quantity}권이 목록에서 제거됩니다.`))return;
      await commit('delete',{op_id:crypto.randomUUID(),revision,id:book.id});
    };
    actions.append(edit,remove);row.append(info,pub,make('td',book.location || '—'),make('td',String(book.quantity)),actions);$('book-list').append(row);
  }
}
async function refresh(){
  const data=await api('books');books=data.books;revision=data.revision;$('file-path').textContent='저장 파일 · '+data.path;render();
}
function showConfig(){
  $('workbook-path').value=config.workbook;$('retention').value=config.retention;
  $('key-status').textContent=config.key_from_env?'환경변수의 키를 사용 중입니다.':config.key_configured?'키가 설정되어 있습니다. 비워두면 유지합니다.':'API 키를 입력하면 서지정보를 조회할 수 있습니다.';
}
async function lookup(isbn,{more=false,refreshCache=false}={}){
  if(busy||pending)return;
  if(!photoWorking)$('photo-status').textContent='JPG·PNG·WebP 사진을 선택하세요. 파일은 이 브라우저에서만 읽으며 서버에 전송하거나 저장하지 않습니다.';
  const generation=++lookupGeneration;setBusy(true);scanLatched=true;
  notice('국립중앙도서관에서 책 정보를 찾고 있습니다…');
  if(!more){fill({raw_input:isbn,lookup_status:'조회실패'});$('candidates').replaceChildren();$('candidates').hidden=true;$('more-results').hidden=true;}
  try{
    const page=more?lookupPage+1:1;
    const data=await api('lookup',{isbn,page,refresh:refreshCache});
    if(generation!==lookupGeneration)return;
    lastLookup=data.isbn;lookupPage=data.page;
    current.isbn=data.isbn;current.raw_input=isbn;
    $('current-isbn').textContent='ISBN '+data.isbn;
    $('more-results').hidden=!data.has_more;
    if(!more&&data.items.length===1&&!data.has_more){fill({...data.items[0],raw_input:isbn});notice('책을 찾았습니다. 정보를 확인하고 저장하세요.','success');}
    else if(data.items.length){
      $('candidates').hidden=false;
      for(const item of data.items){const btn=make('button',item.title,'candidate');btn.type='button';btn.append(make('small',[item.author,item.publisher,item.year].filter(Boolean).join(' · ')));btn.onclick=()=>{if(busy||pending)return;fill({...item,raw_input:isbn});notice('선택한 책의 정보를 확인하고 저장하세요.');};$('candidates').append(btn);}
      notice('조회 후보를 확인하고 해당하는 책을 선택하세요.');
    } else {current.lookup_status='미조회';notice(data.rejected?'응답 ISBN이 일치하지 않아 제외했습니다. 다음 후보를 확인하거나 직접 등록하세요.':'일치하는 도서를 찾지 못했습니다. 정보를 직접 입력해 등록할 수 있습니다.');}
  }catch(err){if(generation===lookupGeneration)notice(err.message,'error');}
  finally{setBusy(false);}
}
async function commit(path,payload){
  setBusy(true);pendingState({path,payload});notice('Excel 파일에 저장하고 있습니다…');
  try{
    const result=await api(path,payload);pendingState(null);revision=result.revision;
    if(path==='books'){fill({...result.book});scanLatched=true;}
    else if(path==='delete'||path==='restore'){reset();}
    try{await refresh();}catch{notice('저장은 완료됐습니다. 목록을 불러오려면 새로고침하세요.','success');return;}
    notice(result.message+(result.replayed?' · 이전 작업의 저장 결과를 확인했습니다.':''),'success');
  }catch(err){
    if(err.status===0||err.status>=500){notice(err.message+' 저장 요청을 보관했습니다. 다시 확인을 눌러주세요.','error');}
    else{
      pendingState(null);
      if(path==='books'&&err.details?.duplicate){
        const duplicate=err.details.duplicate;
        if(confirm(`‘${duplicate.title}’이(가) ${duplicate.quantity}권 등록되어 있습니다. 입력한 ${payload.book.quantity}권을 추가할까요?`)){
          setBusy(false);return commit(path,{...payload,duplicate:'increment',op_id:crypto.randomUUID()});
        }
        notice('중복 등록을 취소했습니다. 기존 도서는 그대로 유지됩니다.');
      }else notice(err.message,'error');
    }
  }finally{setBusy(false);}
}
$('lookup-form').onsubmit=e=>{e.preventDefault();const value=$('isbn-input').value.trim();if(!value)return notice('ISBN을 입력하세요.','error');lookup(value,{refreshCache:true});};
$('more-results').onclick=()=>lookup(lastLookup,{more:true});
$('book-form').onsubmit=e=>{
  e.preventDefault();if(busy)return;if(pending)return commit(pending.path,pending.payload);
  // Manual ISBN edits are reflected even when the user does not run a lookup.
  const raw=$('isbn-input').value.trim();
  const changed=raw.replace(/[\s-]/g,'')!==(current.raw_input || current.isbn || '').replace(/[\s-]/g,'');
  const book={...current};
  if(changed){for(const k of ['response_isbn','control_no','nl_id','call_no','kdc_code','kdc_name','detail_link','looked_up_at'])book[k]='';book.source='수동입력';book.lookup_status='수동등록';}
  book.isbn=changed?raw:(current.isbn || raw);book.raw_input=raw;
  for(const key of fieldNames)book[key]=key==='quantity'?Number($(key).value):$(key).value.trim();
  commit('books',{op_id:crypto.randomUUID(),revision,book,duplicate:'cancel'});
};
$('next-book').onclick=reset;
$('manual').onclick=()=>{reset();$('title').focus();};
$('search').oninput=()=>{libraryPage=1;render();};
$('page-size').onchange=()=>{
  const size=Number($('page-size').value);if(![20,30,40,50].includes(size))return;
  libraryPageSize=size;libraryPage=1;
  try{localStorage.setItem('book-list-page-size',String(size));}catch{}
  render();
};
$('page-first').onclick=()=>{libraryPage=1;render();};
$('page-prev').onclick=()=>{libraryPage--;render();};
$('page-next').onclick=()=>{libraryPage++;render();};
$('page-last').onclick=()=>{libraryPage=libraryPageCount;render();};
$('reload').onclick=async()=>{try{await refresh();notice('Excel 목록을 다시 읽었습니다. 입력 중인 내용은 유지됩니다.');}catch(err){notice(err.message,'error');}};
$('retry-save').onclick=()=>{if(!busy&&pending)commit(pending.path,pending.payload);};
$('discard-request').onclick=async()=>{if(busy)return;if(confirm('저장됐을 가능성이 있습니다. 요청 기록을 정리한 뒤 목록에서 결과를 확인하세요. 계속할까요?')){pendingState(null);try{await refresh();}catch(err){notice(err.message,'error');}}};
async function launchFolder(){
  const button=$('folder-launch');button.disabled=true;$('folder-message').textContent='파일 탐색기에 열기를 요청하고 있습니다…';
  try{const result=await api('open-folder',{});$('folder-path').value=result.path;$('folder-message').textContent='Windows에 열기 요청을 전달했습니다. 창이 나타나지 않으면 아래 안내대로 앱을 직접 실행하거나 경로 복사를 이용하세요.';}
  catch(err){$('folder-message').textContent=err.message;}
  finally{button.disabled=false;}
}
$('folder-open').onclick=()=>{
  $('folder-path').value=config.workbook.replace(/[\\/][^\\/]+$/,'');$('folder-dialog').showModal();launchFolder();
};
$('folder-launch').onclick=launchFolder;
$('folder-close').onclick=()=>$('folder-dialog').close();
$('folder-copy').onclick=async()=>{
  try{await navigator.clipboard.writeText($('folder-path').value);$('folder-message').textContent='폴더 경로를 복사했습니다. 파일 탐색기 주소창에 붙여넣으세요.';}
  catch{$('folder-path').focus();$('folder-path').select();$('folder-message').textContent='선택된 경로를 Ctrl+C로 복사하세요.';}
};
$('shutdown').onclick=async()=>{
  if(busy||pending)return notice('진행 중인 저장 요청을 먼저 확인하세요.','error');
  if(!confirm('로컬 서버를 종료할까요? 저장하지 않은 입력은 보관되지 않습니다.'))return;
  try{await api('shutdown',{});await stopCamera();notice('서버를 종료했습니다. 다시 사용하려면 start.cmd를 실행하세요.');setBusy(true);}
  catch(err){notice(err.message,'error');}
};
$('settings-open').onclick=()=>{showConfig();$('settings-dialog').showModal();};
$('settings-close').onclick=()=>$('settings-dialog').close();
$('settings-form').onsubmit=async e=>{
  e.preventDefault();if(pending||busy){$('settings-message').textContent='진행 중인 저장 작업부터 마쳐주세요.';return;}
  const input=$('api-key').value.trim();
  try{config=await api('settings',{key:input||null,workbook:$('workbook-path').value.trim(),retention:Number($('retention').value)});$('api-key').value='';showConfig();await refresh();$('settings-message').textContent='설정을 저장했습니다.';notice('설정이 저장되었습니다.');}catch(err){$('settings-message').textContent=err.message;}
};
$('connection-check').onclick=async()=>{
  $('settings-message').textContent='저장된 키로 연결을 확인하고 있습니다…';
  try{const result=await api('lookup',{isbn:'9788936434267',refresh:true});$('settings-message').textContent=result.items.length?'연결 성공 · 아몬드 정보를 조회했습니다.':'연결은 성공했으나 일치 도서가 없습니다.';}catch(err){$('settings-message').textContent=err.message;}
};
$('backups-load').onclick=async()=>{
  try{const data=await api('backups');$('backup-list').replaceChildren();if(!data.items.length)$('backup-list').textContent='아직 백업이 없습니다. 기존 파일을 변경할 때 자동 생성됩니다.';
    for(const item of data.items){const btn=make('button',item.name+' 복원','quiet');btn.onclick=async()=>{if(busy||pending)return;if(confirm(item.name+' 시점으로 서가 전체를 복원할까요?')){await commit('restore',{op_id:crypto.randomUUID(),revision,name:item.name});$('settings-dialog').close();}};$('backup-list').append(btn);}
  }catch(err){$('settings-message').textContent=err.message;}
};

async function listCameras(){
  const devices=await navigator.mediaDevices.enumerateDevices();let selected=$('camera-select').value;
  try{selected=selected||localStorage.getItem('book-camera')||'';}catch{}
  $('camera-select').replaceChildren();
  for(const [i,device] of devices.filter(x=>x.kind==='videoinput').entries()){const option=make('option',device.label || `카메라 ${i+1}`);option.value=device.deviceId;$('camera-select').append(option);}
  if(selected&&[...$('camera-select').options].some(o=>o.value===selected))$('camera-select').value=selected;
}
async function stopCamera(){
  cameraEpoch++;cameraStarting=false;cameraRunning=false;clearTimeout(scanTimer);scanTimer=null;
  cameraDecoder?.close();cameraDecoder=null;
  const stream=$('video').srcObject;$('video').srcObject=null;
  if(stream)stream.getTracks().forEach(track=>track.stop());
  $('camera-state').textContent='카메라 꺼짐';$('camera-placeholder').hidden=false;$('camera-start').disabled=false;$('camera-stop').disabled=true;$('camera-select').disabled=false;
  $('scan-status').textContent='카메라 대기';$('scan-again').disabled=true;$('scan-once').disabled=true;
}
function acceptScan(code){
  if(scanLatched||scanBusy||busy||pending)return;
  scanLatched=true;scanBusy=true;$('isbn-input').value=code;
  $('scan-status').textContent='인식 완료 · '+code;
  lookup(code).finally(()=>scanBusy=false);
}
function updateScanStatus(){
  if(!cameraRunning)return;
  const video=$('video');
  $('scan-status').textContent=scanLatched?'인식 일시정지 · 다음 책 또는 인식 재시작을 누르세요':
    `인식 중 · ${video.videoWidth}×${video.videoHeight} · ${$('scan-mode').value==='small'?'작은 바코드 · ':''}${decodeCount}회 검사`;
}
async function scanLoop(epoch){
  if(epoch!==cameraEpoch||!cameraRunning)return;
  if(!photoWorking&&!scanBusy&&!scanLatched&&!busy&&!pending&&$('video').readyState>=2){
    scanBusy=true;
    try{
      const result=await cameraDecoder.read($('video'),decodePass++,{small:$('scan-mode').value==='small'});
      if(epoch!==cameraEpoch)return;
      const code=result.code;decodeCount++;
      scanBusy=false;if(epoch===cameraEpoch&&cameraRunning&&!photoWorking&&code)acceptScan(code);
    }
    catch(error){if(epoch===cameraEpoch){scanLatched=true;notice(error.message,'error');}}
    finally{if(epoch===cameraEpoch)scanBusy=false;}
  }
  if(epoch!==cameraEpoch||!cameraRunning)return;
  updateScanStatus();
  scanTimer=setTimeout(()=>scanLoop(epoch),250);
}
async function startCamera(){
  if(cameraRunning||cameraStarting)return;
  if(!navigator.mediaDevices?.getUserMedia)return notice('이 브라우저에서 카메라를 사용할 수 없습니다. 로컬 주소를 Chrome 또는 Edge에서 여세요.','error');
  if(!window.ZXingBrowser||!window.BookCamera)return notice('바코드 모듈을 불러오지 못했습니다. 화면을 새로고침하세요.','error');
  const epoch=++cameraEpoch;cameraStarting=true;
  $('camera-start').disabled=true;$('camera-stop').disabled=false;$('camera-state').textContent='연결 중';
  try{
    const device=$('camera-select').value;
    try{if(device)localStorage.setItem('book-camera',device);}catch{}
    const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{...(device?{deviceId:{exact:device}}:{facingMode:'environment'}),width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:30}}});
    if(epoch!==cameraEpoch){stream.getTracks().forEach(track=>track.stop());return;}
    const track=stream.getVideoTracks()[0];
    try{const caps=track.getCapabilities?.()||{};if(caps.focusMode?.includes('continuous'))await track.applyConstraints({advanced:[{focusMode:'continuous'}]});}catch{}
    $('video').srcObject=stream;await $('video').play();
    if(epoch!==cameraEpoch){stream.getTracks().forEach(track=>track.stop());return;}
    cameraDecoder=new CameraWorkerClient();decodePass=0;decodeCount=0;scanBusy=false;
    cameraRunning=true;cameraStarting=false;$('camera-placeholder').hidden=true;$('camera-stop').disabled=false;$('camera-select').disabled=true;$('camera-state').textContent='카메라 켜짐';
    $('scan-again').disabled=false;$('scan-once').disabled=false;
    track.addEventListener('ended',()=>{if(epoch===cameraEpoch){stopCamera();notice('카메라 연결이 끊겼습니다. 다시 켜주세요.','error');}});
    try{await listCameras();const actual=track.getSettings().deviceId;if(actual)$('camera-select').value=actual;}catch{}
    scanLoop(epoch);
    notice(scanLatched?'카메라가 켜졌습니다. ‘다음 책’을 누르면 인식을 재개합니다.':'책의 ISBN 바코드를 비춰주세요.');
  }catch(err){await stopCamera();const messages={NotAllowedError:'카메라 권한이 차단되어 있습니다. 브라우저의 사이트 권한을 확인하세요.',NotFoundError:'연결된 카메라를 찾지 못했습니다.',NotReadableError:'카메라를 사용할 수 없습니다. 다른 프로그램이 사용 중인지 확인하세요.',OverconstrainedError:'선택한 카메라 설정을 사용할 수 없습니다. 기본 카메라로 다시 시도하세요.'};notice(messages[err.name] || '카메라 실행 실패: '+err.message,'error');}
}
$('scan-again').onclick=()=>{if(pending||busy)return;scanLatched=false;decodePass=0;decodeCount=0;updateScanStatus();notice('인식을 다시 시작했습니다. 책의 바코드를 비춰주세요.');};
$('scan-mode').onchange=()=>{
  const small=$('scan-mode').value==='small';$('video').classList.toggle('magnified',small);
  $('scan-mode-help').textContent=small?'중앙을 2배로 표시합니다. 바코드 전체와 좌우 여백을 프레임 안에 넣으세요. Facecam MK.2는 너무 가까우면 흐려지므로 약 30cm 이상 거리를 유지하세요.':'작은 바코드는 확대 모드로 바꿔 중앙에 맞추세요. 확대는 촬영되지 않은 세부를 복원하지는 못합니다.';
  if(!busy&&!pending){scanLatched=false;decodePass=0;decodeCount=0;}updateScanStatus();
};
$('scan-once').onclick=async()=>{
  if(!cameraRunning||busy||pending||scanBusy)return;
  scanBusy=true;const epoch=cameraEpoch;const capture=document.createElement('canvas');capture.width=$('video').videoWidth;capture.height=$('video').videoHeight;
  if(!capture.width){scanBusy=false;return;}
  capture.getContext('2d').drawImage($('video'),0,0);scanLatched=false;$('scan-once').disabled=true;
  try{
    $('scan-status').textContent='현재 화면 정밀 인식 중…';
    const result=await cameraDecoder.read(capture,0,{small:$('scan-mode').value==='small',precise:true});
    if(epoch!==cameraEpoch)return;
    if(result.code){scanBusy=false;acceptScan(result.code);return;}
    notice('현재 화면에서 ISBN을 읽지 못했습니다. 바코드를 가로로 놓고 좌우 여백까지 보이게 한 뒤 다시 시도하세요.');
  }catch{if(epoch===cameraEpoch)notice('정밀 인식에 실패했습니다. 카메라를 다시 켜주세요.','error');}
  finally{if(epoch===cameraEpoch){scanBusy=false;$('scan-once').disabled=!cameraRunning;}}
};
$('camera-start').onclick=startCamera;$('camera-stop').onclick=stopCamera;
$('camera-select').onchange=()=>{try{localStorage.setItem('book-camera',$('camera-select').value);}catch{}};
$('barcode-photo').onchange=async()=>{
  const input=$('barcode-photo'),file=input.files?.[0];if(!file)return;
  if(busy||pending||photoWorking){notice('진행 중인 작업을 먼저 마쳐주세요.','error');input.value='';return;}
  if(file.size>25*1024*1024){$('photo-status').textContent='25MB 이하의 사진을 선택하세요.';input.value='';return;}
  photoWorking=true;input.disabled=true;$('photo-status').textContent='사진을 이 브라우저에서 해독하고 있습니다…';
  let bitmap;
  try{
    bitmap=await createImageBitmap(file);
    if(bitmap.width*bitmap.height>32000000)throw new Error('사진이 너무 큽니다. 바코드 주변을 잘라 3200만 화소 이하로 선택하세요.');
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);
    let code=await AdvancedBarcode.read(ctx.getImageData(0,0,canvas.width,canvas.height));
    if(!code){const decoder=new BookCamera.CameraDecoder();for(let pass=0;pass<15&&!code;pass++){code=decoder.read(canvas,pass,{small:true});await new Promise(resolve=>setTimeout(resolve,0));}}
    if(code){$('isbn-input').value=code;$('photo-status').textContent='사진 인식 성공 · ISBN '+code;scanLatched=true;await lookup(code);}
    else $('photo-status').textContent='사진에서도 ISBN을 찾지 못했습니다. 가는 선과 좌우 여백이 또렷한 사진으로 다시 시도하거나 ISBN 숫자를 입력하세요.';
  }catch(error){$('photo-status').textContent='사진 인식 실패 · '+(error?.message || 'JPG·PNG·WebP 사진을 사용하세요.');}
  finally{bitmap?.close();input.disabled=false;input.value='';photoWorking=false;}
};
window.addEventListener('beforeunload',()=>{clearTimeout(scanTimer);cameraDecoder?.close();const stream=$('video').srcObject;if(stream)stream.getTracks().forEach(track=>track.stop());});
(async()=>{
  try{const data=await api('bootstrap');token=data.token;config=data.settings;showConfig();fill();await refresh();notice(config.key_configured?'준비됐습니다. 카메라를 켜거나 ISBN을 입력하세요.':'설정에서 API 키를 입력하세요. 수동 등록도 가능합니다.');}
  catch(err){notice(err.message,'error');}
  if(pending?.path==='books'){
    fill(pending.payload.book);$('isbn-input').value=pending.payload.book.raw_input || pending.payload.book.isbn || '';
  }
  pendingState(pending);
  if(navigator.mediaDevices?.enumerateDevices){try{await listCameras();}catch{}}
})();
